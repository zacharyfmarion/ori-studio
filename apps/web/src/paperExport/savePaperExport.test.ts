import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_EXPORT_SETTINGS } from '../lib/paperExportSettings';
import { paperPresetRows } from '../lib/paperPresetRows';
import type { FileService } from '../platform/fileService';
import { paperExportedEvent, savePaperExport } from './savePaperExport';

const { paperSvgToPng } = vi.hoisted(() => ({
  paperSvgToPng: vi.fn(async () => new Uint8Array([1, 2, 3])),
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

describe('paperExportedEvent', () => {
  const rows = paperPresetRows([{ version: 1, name: 'Mine', style: {} as never }]);
  const details = { keepsHiddenFaces: true, style: 'export-style', rows, changed: false };

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
});
