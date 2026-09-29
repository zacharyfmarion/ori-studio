import { strFromU8, strToU8, unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperSvgResult } from '../lib/paper/paperSvg';
import { DEFAULT_PAPER_EXPORT_SETTINGS } from '../lib/paperExportSettings';
import { paperPresetRows } from '../lib/paperPresetRows';
import type { FileService, SaveBinaryFileOptions } from '../platform/fileService';
import { paperExportedEvent, savePaperExport, savePaperExportZip } from './savePaperExport';

const { paperSvgToPng } = vi.hoisted(() => ({
  paperSvgToPng: vi.fn(async (_page: PaperSvgResult, _dpi: number) => new Uint8Array([1, 2, 3])),
}));
vi.mock('../lib/paper/paperPng', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/paper/paperPng')>()),
  paperSvgToPng,
}));

const PAGE = { svg: '<svg/>', widthPt: 72, heightPt: 36 };

function fileService(overrides: Partial<FileService> = {}): FileService {
  return {
    surface: 'web',
    supportsNativeDialogs: false,
    openTextFile: async () => null,
    openBinaryFile: async () => null,
    saveTextFile: vi.fn(async () => ({ name: 'Crane step 3.svg', path: null })),
    saveBinaryFile: vi.fn(async () => ({ name: 'Crane step 3.png', path: null })),
    ...overrides,
  } as FileService;
}

describe('savePaperExport', () => {
  it('writes the painted SVG as it is, named from the stem', async () => {
    const service = fileService();
    await expect(
      savePaperExport({ page: PAGE, format: 'svg', pngDpi: 192, fileStem: 'Crane step 3', fileService: service })
    ).resolves.toBe('Crane step 3.svg');
    expect(service.saveTextFile).toHaveBeenCalledWith(
      expect.objectContaining({ contents: '<svg/>', suggestedName: 'Crane-step-3.svg', extensions: ['svg'] })
    );
  });

  it('rasterises that same page at the chosen density for a PNG', async () => {
    const service = fileService();
    await savePaperExport({ page: PAGE, format: 'png', pngDpi: 300, fileStem: 'Crane', fileService: service });
    expect(paperSvgToPng).toHaveBeenCalledWith(PAGE, 300);
    expect(service.saveBinaryFile).toHaveBeenCalledWith(
      expect.objectContaining({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png', extensions: ['png'] })
    );
  });

  it('offers nothing to the save dialog once aborted while a PNG encodes', async () => {
    const service = fileService();
    const controller = new AbortController();
    paperSvgToPng.mockImplementationOnce(async () => {
      controller.abort();
      return new Uint8Array([1]);
    });
    await expect(
      savePaperExport({
        page: PAGE,
        format: 'png',
        pngDpi: 96,
        fileStem: 'x',
        fileService: service,
        signal: controller.signal,
      })
    ).resolves.toBeNull();
    expect(service.saveBinaryFile).not.toHaveBeenCalled();
  });

  it('answers null when the save dialog is dismissed', async () => {
    const service = fileService({ saveTextFile: vi.fn(async () => null) });
    await expect(
      savePaperExport({ page: PAGE, format: 'svg', pngDpi: 192, fileStem: 'x', fileService: service })
    ).resolves.toBeNull();
  });
});

const STEPS = [
  { page: { svg: '<svg>one</svg>', widthPt: 72, heightPt: 36 }, fileStem: '01 step 1' },
  { page: { svg: '<svg>two</svg>', widthPt: 72, heightPt: 36 }, fileStem: '02 turn over after step 1' },
  { page: { svg: '<svg>three</svg>', widthPt: 72, heightPt: 36 }, fileStem: '03 step 2' },
];
const STEP_NAMES = ['01-step-1', '02-turn-over-after-step-1', '03-step-2'];

/** The archive handed to the save dialog, each entry's bytes and how it was stored. */
function savedArchive(service: FileService) {
  const [options] = vi.mocked(service.saveBinaryFile).mock.calls[0] as [SaveBinaryFileOptions];
  const compression: Record<string, number> = {};
  const files = unzipSync(options.bytes, {
    filter: (file) => {
      compression[file.name] = file.compression;
      return true;
    },
  });
  return { options, files, compression };
}

describe('savePaperExportZip', () => {
  beforeEach(() => {
    paperSvgToPng.mockClear();
  });

  it('packs every SVG as painted, in order, deflated, and saves the archive once', async () => {
    const service = fileService({ saveBinaryFile: vi.fn(async () => ({ name: 'Crane steps.zip', path: null })) });
    await expect(
      savePaperExportZip({ pages: STEPS, format: 'svg', pngDpi: 192, zipStem: 'Crane steps', fileService: service })
    ).resolves.toBe('Crane steps.zip');

    expect(service.saveBinaryFile).toHaveBeenCalledTimes(1);
    expect(service.saveTextFile).not.toHaveBeenCalled();
    expect(paperSvgToPng).not.toHaveBeenCalled();
    const { options, files, compression } = savedArchive(service);
    expect(options).toMatchObject({
      suggestedName: 'Crane-steps.zip',
      extensions: ['zip'],
      mimeType: 'application/zip',
    });
    const names = STEP_NAMES.map((name) => `${name}.svg`);
    expect(Object.keys(files)).toEqual(names);
    expect(names.map((name) => strFromU8(files[name]!))).toEqual(STEPS.map(({ page }) => page.svg));
    // 8 is deflate, in PKZIP's numbering.
    expect(names.map((name) => compression[name])).toEqual([8, 8, 8]);
  });

  it('rasterises each PNG page at the density and stores it as encoded', async () => {
    const encoded = (page: PaperSvgResult) => new Uint8Array([137, 80, 78, 71, ...strToU8(page.svg)]);
    for (const _ of STEPS) paperSvgToPng.mockImplementationOnce(async (page) => encoded(page));
    const service = fileService();
    await savePaperExportZip({
      pages: STEPS,
      format: 'png',
      pngDpi: 300,
      zipStem: 'Crane steps',
      fileService: service,
    });

    expect(paperSvgToPng.mock.calls).toEqual(STEPS.map(({ page }) => [page, 300]));
    const { files, compression } = savedArchive(service);
    const names = STEP_NAMES.map((name) => `${name}.png`);
    expect(Object.keys(files)).toEqual(names);
    expect(names.map((name) => [...files[name]!])).toEqual(STEPS.map(({ page }) => [...encoded(page)]));
    // 0 is stored: a PNG is compressed already.
    expect(names.map((name) => compression[name])).toEqual([0, 0, 0]);
  });

  it('reports each page as it is ready, of how many', async () => {
    const onProgress = vi.fn();
    await savePaperExportZip({
      pages: STEPS,
      format: 'png',
      pngDpi: 96,
      zipStem: 'x',
      fileService: fileService(),
      onProgress,
    });
    expect(onProgress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('stops before the next page once aborted, and offers nothing to the save dialog', async () => {
    const service = fileService();
    const controller = new AbortController();
    const onProgress = vi.fn((done: number) => {
      if (done === 1) controller.abort();
    });
    await expect(
      savePaperExportZip({
        pages: STEPS,
        format: 'png',
        pngDpi: 96,
        zipStem: 'x',
        fileService: service,
        signal: controller.signal,
        onProgress,
      })
    ).resolves.toBeNull();
    expect(paperSvgToPng).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(service.saveBinaryFile).not.toHaveBeenCalled();
  });

  it('offers nothing to the save dialog when aborted after the last page', async () => {
    const service = fileService();
    const controller = new AbortController();
    await expect(
      savePaperExportZip({
        pages: STEPS,
        format: 'svg',
        pngDpi: 96,
        zipStem: 'x',
        fileService: service,
        signal: controller.signal,
        onProgress: (done, total) => {
          if (done === total) controller.abort();
        },
      })
    ).resolves.toBeNull();
    expect(service.saveBinaryFile).not.toHaveBeenCalled();
  });

  it('answers null when the save dialog is dismissed', async () => {
    const service = fileService({ saveBinaryFile: vi.fn(async () => null) });
    await expect(
      savePaperExportZip({ pages: STEPS, format: 'svg', pngDpi: 192, zipStem: 'x', fileService: service })
    ).resolves.toBeNull();
    expect(service.saveBinaryFile).toHaveBeenCalledTimes(1);
  });
});

describe('paperExportedEvent', () => {
  const rows = paperPresetRows([{ version: 1, name: 'Mine', style: {} as never }]);
  const details = {
    keepsHiddenFaces: true,
    style: 'export-style',
    rows,
    changed: false,
    scope: 'this' as const,
    pageCount: 1,
    marks: [] as const,
  };

  it('names the style by kind: the slot, a built-in by id, anything else as custom', () => {
    expect(paperExportedEvent('references', DEFAULT_PAPER_EXPORT_SETTINGS, details)).toEqual({
      surface: 'references',
      format: 'svg',
      hiddenFaces: 'kept',
      style: 'export-style',
      sheet: 'as-shown',
      background: 'transparent',
      pngDpi: DEFAULT_PAPER_EXPORT_SETTINGS.pngDpi,
      optionsChanged: false,
      scope: 'this',
      pageCount: 1,
    });
    expect(
      paperExportedEvent('references', DEFAULT_PAPER_EXPORT_SETTINGS, { ...details, style: 'builtin:diagram' })
        .style
    ).toBe('diagram');
    expect(
      paperExportedEvent('references', DEFAULT_PAPER_EXPORT_SETTINGS, { ...details, style: 'user:Mine' }).style
    ).toBe('custom');
  });

  it('says what kind of sheet and background, and whether anything was changed', () => {
    const png = {
      ...DEFAULT_PAPER_EXPORT_SETTINGS,
      format: 'png' as const,
      pngDpi: 288,
      sheet: { mm: 150 },
      background: '#ffffff',
    };
    expect(
      paperExportedEvent('simulator', png, { ...details, keepsHiddenFaces: false, changed: true })
    ).toMatchObject({
      format: 'png',
      hiddenFaces: 'dropped',
      sheet: 'custom',
      background: 'colour',
      pngDpi: 288,
      optionsChanged: true,
    });
  });

  it('reports the diagram’s marks only for a target that offers them', () => {
    const bare = { ...DEFAULT_PAPER_EXPORT_SETTINGS, marks: { letters: false, highlights: true } };
    const offered = { ...details, marks: ['letters', 'highlights'] as const };
    expect(paperExportedEvent('references', bare, offered)).toMatchObject({
      letters: 'hidden',
      highlights: 'shown',
    });
    const event = paperExportedEvent('folded-3d', bare, details);
    expect(event).not.toHaveProperty('letters');
    expect(event).not.toHaveProperty('highlights');
  });
});
