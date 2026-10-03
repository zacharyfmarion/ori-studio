import { unzipSync } from 'fflate';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiagram, createStep, insertSteps, type DiagramDocument } from '../../diagram/document/diagramDocument';
import { cpStep } from '../../diagram/document/diagramSteps.fixtures';
import { DEFAULT_DIAGRAM_EXPORT_SETTINGS } from '../../diagram/export/diagramExportSettings';
import type { PdfWriter } from '../../diagram/export/diagramPdf';
import type { DiagramExportDependencies } from '../../diagram/export/useDiagramExport';
import { FIXTURE_FONTS, fixtureSubsetter } from '../../diagram/fonts/diagramFonts.fixtures';
import type { FontSubsetter } from '../../diagram/fonts/fontSubset';
import type { FileService } from '../../platform/fileService';
import { useSettingsStore } from '../../store/settingsStore';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramExportDialog } from './DiagramExportModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { track, toastSuccess } = vi.hoisted(() => ({ track: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('../../analytics/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics/runtime')>()),
  track,
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

let subsetter: FontSubsetter;
beforeAll(async () => {
  subsetter = await fixtureSubsetter();
});

function diagram(text = 'Fold in half.'): DiagramDocument {
  return insertSteps(
    createDiagram({ title: 'Crane' }),
    [{ ...cpStep('step-a'), text }, { ...createStep(() => 'step-empty'), text: 'Nothing yet.' }, cpStep('step-b')],
    0
  );
}

let host: HTMLDivElement;
let root: Root;
let saveBinaryFile: ReturnType<typeof vi.fn>;
let writePdf: ReturnType<typeof vi.fn<PdfWriter>>;
let dependencies: DiagramExportDependencies;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  useSettingsStore.setState({ diagramExport: DEFAULT_DIAGRAM_EXPORT_SETTINGS });
  saveBinaryFile = vi.fn(async (options: { suggestedName: string }) => ({ name: options.suggestedName, path: null }));
  writePdf = vi.fn<PdfWriter>(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  dependencies = {
    load: async () => ({ fonts: FIXTURE_FONTS, subsetter }),
    writePdf,
    fileService: () => ({ saveBinaryFile }) as unknown as FileService,
  };
  track.mockClear();
  toastSuccess.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function open(document: DiagramDocument = diagram()) {
  act(() =>
    root.render(
      <TooltipProvider>
        <DiagramExportDialog request={{ id: 1, returnFocus: null }} diagram={document} dependencies={dependencies} />
      </TooltipProvider>
    )
  );
  // The fonts load, then the pages lay out.
  await act(async () => {});
  await act(async () => {});
}

const button = (name: string) =>
  [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === name)!;
const exportButton = () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const caption = () => host.querySelector('p[aria-live="polite"]')!.textContent;
const notice = () => host.querySelector('[role="status"]')?.textContent ?? '';
const radio = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((card) => card.textContent?.includes(name))!;

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
  await act(async () => {});
}

describe('DiagramExportDialog', () => {
  it('opens on a PDF of the pages: one shown, its size, and the steps that print blank', async () => {
    await open();
    expect(host.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(caption()).toBe('210 × 297 mm · 1 page');
    expect(notice()).toContain('Step 2 has no picture and will print as blank space.');
    expect(exportButton().textContent).toBe('Export PDF');
    expect(exportButton().disabled).toBe(false);
  });

  it('writes the PDF, saves it under the title, remembers how, and says so', async () => {
    await open();
    await click(exportButton());
    expect(writePdf).toHaveBeenCalledOnce();
    const [pages, fonts, options] = writePdf.mock.calls[0]!;
    expect(pages).toHaveLength(1);
    expect(fonts.length).toBeGreaterThan(0);
    expect(options).toMatchObject({ trimWidthMm: 210, trimHeightMm: 297, artBleedMm: 0, title: 'Crane' });
    expect(saveBinaryFile).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'Crane.pdf', extensions: ['pdf'], mimeType: 'application/pdf' })
    );
    expect(toastSuccess).toHaveBeenCalledWith('Exported Crane.pdf');
    expect(track).toHaveBeenCalledWith('diagram exported', {
      format: 'pdf',
      preset: 'home',
      file_count_bucket: '<=1',
      step_count_bucket: '<=5',
      empty_step_bucket: '<=1',
    });
  });

  it('sends a print shop its bleed', async () => {
    await open();
    await click(radio('Print shop'));
    expect(caption()).toBe('210 × 297 mm · 1 page · with 3 mm bleed');
    await click(exportButton());
    expect(writePdf.mock.calls[0]![2]).toMatchObject({ artBleedMm: 3, printShop: { bleedMm: 3, slugMm: 5 } });
    expect(useSettingsStore.getState().diagramExport.pdf).toBe('print-shop');
  });

  it('writes a file for each step with a picture, one at a time in the pager, into one ZIP', async () => {
    await open();
    await click(radio('Step files (ZIP)'));
    expect(caption()).toBe('80 × 100 mm · 2 files · ZIP');
    expect(notice()).toContain('Step 2 has no picture and will be skipped.');
    expect(host.textContent).toContain('Step 1 · 1 of 2');
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="Next step"]')!);
    expect(host.textContent).toContain('Step 3 · 2 of 2');
    expect(exportButton().textContent).toBe('Export SVGs as ZIP');

    await click(exportButton());
    const saved = saveBinaryFile.mock.calls[0]![0] as { bytes: Uint8Array; suggestedName: string };
    expect(saved.suggestedName).toBe('Crane.zip');
    expect(Object.keys(unzipSync(saved.bytes))).toEqual(['Crane-step-1.svg', 'Crane-step-3.svg']);
    expect(track).toHaveBeenCalledWith(
      'diagram exported',
      expect.objectContaining({ format: 'zip', file_type: 'svg', resolution: 'none', size: 'same', number: 'shown' })
    );
  });

  it('refuses a PDF with a character the fonts lack, and lets the step files draw a box for it', async () => {
    await open(diagram('Fold 𠀀'));
    expect(notice()).toContain('so a PDF can’t be made');
    expect(exportButton().disabled).toBe(true);
    await click(radio('Step files (ZIP)'));
    expect(notice()).toContain('the files draw a box for each');
    expect(exportButton().disabled).toBe(false);
  });

  it('stops a PDF being written when the dialog closes, and saves nothing', async () => {
    let signal: AbortSignal | undefined;
    writePdf.mockImplementation((_pages, _fonts, _options, given) => {
      signal = given;
      return new Promise(() => {});
    });
    await open();
    await click(exportButton());
    expect(exportButton().textContent).toBe('Writing PDF…');
    expect(button('Stop')).toBeTruthy();
    act(() => root.unmount());
    root = createRoot(host);
    expect(signal?.aborted).toBe(true);
    expect(saveBinaryFile).not.toHaveBeenCalled();
  });
});
