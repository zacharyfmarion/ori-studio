import { unzipSync } from 'fflate';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDiagram,
  createStep,
  insertSteps,
  type DiagramDocument,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../../diagram/document/diagramDocument';
import { cpStep } from '../../diagram/document/diagramSteps.fixtures';
import { DEFAULT_DIAGRAM_EXPORT_SETTINGS } from '../../diagram/export/diagramExportSettings';
import type { PdfWriter } from '../../diagram/export/diagramPdf';
import type { DiagramExportDependencies } from '../../diagram/export/useDiagramExport';
import { FIXTURE_FONTS, fixtureSubsetter } from '../../diagram/fonts/diagramFonts.fixtures';
import type { FontSubsetter } from '../../diagram/fonts/fontSubset';
import type { FileService } from '../../platform/fileService';
import { useSettingsStore } from '../../store/settingsStore';
import { TooltipProvider } from '../ui/Tooltip';
import { useDiagramExportUiStore } from '../../store/diagramExportUiStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { DiagramExportDialog, DiagramExportModal } from './DiagramExportModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { track, toastSuccess, reportError, appleMobile } = vi.hoisted(() => ({
  track: vi.fn(),
  toastSuccess: vi.fn(),
  reportError: vi.fn(),
  appleMobile: { value: false },
}));
vi.mock('../../monitoring', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../monitoring')>()),
  reportError,
}));
// An iPad's canvas: 4,096² px in all.
vi.mock('../../platform/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/runtime')>()),
  isAppleMobilePlatform: () => appleMobile.value,
}));
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
let saveTextFile: ReturnType<typeof vi.fn>;
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
  saveTextFile = vi.fn(async (options: { suggestedName: string }) => ({ name: options.suggestedName, path: null }));
  writePdf = vi.fn<PdfWriter>(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  dependencies = {
    load: async () => ({ fonts: FIXTURE_FONTS, subsetter }),
    writePdf,
    fileService: () => ({ saveBinaryFile, saveTextFile }) as unknown as FileService,
  };
  track.mockClear();
  toastSuccess.mockClear();
  reportError.mockClear();
  appleMobile.value = false;
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
        <DiagramExportDialog
          request={{ id: 1, returnFocus: null, loadId: 0 }}
          diagram={document}
          dependencies={dependencies}
        />
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
    // The setup it lays out, and the name the save is offered.
    expect(host.textContent).toContain('Page setupA4 Portrait · Flow, 3 × 3');
    expect(host.textContent).toContain('Crane.pdf');
    await click(radio('Step files (ZIP)'));
    expect(host.textContent).toContain('Crane.zip');
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
      enlarged_step_bucket: '<=0',
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

  it('lays the pages out as spreads on one SVG: a spread in the preview, the sheet in the caption', async () => {
    // Twelve steps with pictures: two pages, which face each other from a left first page.
    const document = insertSteps(
      createDiagram({ title: 'Crane' }),
      Array.from({ length: 12 }, (_, index) => cpStep(`step-${index}`)),
      0
    );
    await open(document);
    await click(radio('SVG'));
    expect(host.textContent).toContain('Every page on one sheet, as spreads.');
    expect(host.textContent).toContain('First page: Left');
    expect(host.textContent).toContain('Crane.svg');
    expect(exportButton().textContent).toBe('Export SVG');
    // No print shop: that is the PDF's.
    expect(host.textContent).not.toContain('Print shop');
    expect(caption()).toBe('420 × 297 mm · 2 pages · 1 spread');
    expect(host.querySelectorAll('img')).toHaveLength(2);
    expect(host.querySelector('button[aria-label="Next spread"]')).toBeNull();

    await click(exportButton());
    expect(writePdf).not.toHaveBeenCalled();
    const saved = saveTextFile.mock.calls[0]![0] as { contents: string; suggestedName: string; extensions: string[] };
    expect(saved.suggestedName).toBe('Crane.svg');
    expect(saved.extensions).toEqual(['svg']);
    expect(saved.contents).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm"');
    expect(saved.contents.match(/<g id="page-\d+">/g)).toHaveLength(2);
    expect(toastSuccess).toHaveBeenCalledWith('Exported Crane.svg');
    expect(track).toHaveBeenCalledWith('diagram exported', {
      format: 'svg',
      file_count_bucket: '<=2',
      step_count_bucket: '<=20',
      empty_step_bucket: '<=0',
      enlarged_step_bucket: '<=0',
    });
    expect(useSettingsStore.getState().diagramExport.kind).toBe('svg');
  });

  it('walks the spreads of a right first page, page 1 alone on the right', async () => {
    const document = insertSteps(
      createDiagram({ title: 'Crane' }),
      Array.from({ length: 12 }, (_, index) => cpStep(`step-${index}`)),
      0
    );
    await open({ ...document, page: { ...document.page, firstPageSide: 'right' } });
    await click(radio('SVG'));
    expect(host.textContent).toContain('First page: Right');
    expect(caption()).toBe('420 × 604 mm · 2 pages · 2 spreads');
    expect(host.textContent).toContain('Page 1 · 1 of 2');
    // The left of the first spread is empty: one page on show.
    expect(host.querySelectorAll('img')).toHaveLength(1);
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="Next spread"]')!);
    expect(host.textContent).toContain('Page 2 · 2 of 2');
  });

  it('says which enlarged step prints on the page after its area, and that step files leave its arrow out (Revision 2)', async () => {
    // Nine steps to a page: step 9 holds the area, step 10 is enlarged from it on page 2.
    const area: KnownDiagramAnnotation = { id: 'area-1', kind: 'zoom', from: [0.5, 0.4], to: [0.5, 0.4], radius: 0.2 };
    const steps = Array.from({ length: 10 }, (_, index): DiagramStep => {
      const step = cpStep(`step-${index}`);
      if (index === 8) return { ...step, annotations: [area] };
      if (index === 9) return { ...step, zoom: { from: 'area-1', shape: 'circle', frame: { centre: [0.5, 0.4], radius: 0.2 } } };
      return step;
    });
    await open(insertSteps(createDiagram({ title: 'Crane' }), steps, 0));
    expect(notice()).toContain(
      'Step 10 is on the page after the area it enlarges, on step 9. Start a New Page Here on step 9 keeps them together.'
    );
    await click(exportButton());
    expect(track).toHaveBeenCalledWith('diagram exported', expect.objectContaining({ format: 'pdf', enlarged_step_bucket: '<=1' }));
    await open(insertSteps(createDiagram({ title: 'Crane' }), steps, 0));
    await click(radio('Step files (ZIP)'));
    expect(notice()).toContain('Enlarge arrows print only on the pages; the step files leave them out.');
    expect(notice()).not.toContain('page after');
  });

  it('counts only the enlarge arrows the pages print: none before a step seeded with no picture yet (Revision 2)', async () => {
    const area: KnownDiagramAnnotation = { id: 'area-1', kind: 'zoom', from: [0.5, 0.4], to: [0.5, 0.4], radius: 0.2 };
    const seeded: DiagramStep = {
      ...createStep(() => 'step-seeded'),
      zoom: { from: 'area-1', shape: 'circle', frame: { centre: [0.5, 0.4], radius: 0.2 } },
    };
    await open(insertSteps(createDiagram({ title: 'Crane' }), [{ ...cpStep('step-area'), annotations: [area] }, seeded], 0));
    await click(radio('Step files (ZIP)'));
    expect(notice()).not.toContain('Enlarge arrows');
    expect(notice()).not.toContain('enlarge arrows');
  });

  it('refuses a PDF with a character the fonts lack, and lets the step files draw a box for it', async () => {
    await open(diagram('Fold 𠀀'));
    expect(notice()).toContain('so a PDF can’t be made');
    expect(exportButton().disabled).toBe(true);
    await click(radio('Step files (ZIP)'));
    expect(notice()).toContain('the files draw a box for each');
    expect(exportButton().disabled).toBe(false);
    await click(radio('SVG'));
    expect(notice()).toContain('the SVG leaves them to the fonts of whatever opens it');
    expect(exportButton().disabled).toBe(false);
  });

  it('says when a font could not be downloaded, rather than blame the text, and tries again when asked', async () => {
    let failing = true;
    dependencies.load = async () => ({
      fonts: { ...FIXTURE_FONTS, unavailable: failing ? [{ key: 'sc', weight: 400 }] : [] },
      subsetter,
    });
    await open(diagram('Fold 𠀀'));
    expect(notice()).toContain('couldn’t be downloaded');
    expect(notice()).not.toContain('Change the text');
    expect(exportButton().disabled).toBe(true);
    failing = false;
    await click(button('Try again'));
    await act(async () => {});
    expect(notice()).not.toContain('couldn’t be downloaded');
    expect(notice()).toContain('Change the text');
  });

  it('refuses a step file too large for a PNG here by saying which, and reports nothing', async () => {
    appleMobile.value = true;
    const document = diagram();
    const long = { ...document.steps[2]!, text: 'Fold the corner up to the edge, then unfold. '.repeat(300) };
    await open({ ...document, steps: [document.steps[0]!, document.steps[1]!, long] });
    await click(radio('Step files (ZIP)'));
    await click(button('PNG'));
    await click(button('600 dpi'));
    await click(host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Same size for every step"]')!);
    // The file on show fits; the long instruction's does not.
    expect(exportButton().disabled).toBe(false);
    await click(exportButton());
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/Step 3 would be [\d,]+ × [\d,]+ px/);
    expect(saveBinaryFile).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('shows the Page tab for Edit page setup, from whichever workspace the dialog was opened in', async () => {
    const activatePanel = vi.spyOn(useLayoutStore.getState(), 'activatePanel').mockImplementation(() => {});
    try {
      await open();
      await click(button('Edit page setup'));
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
      expect(activatePanel).toHaveBeenCalledWith('diagram-page');
      // The pages the setup lays out, beside it.
      expect(useWorkspaceStore.getState().diagramView).toBe('pages');
    } finally {
      activatePanel.mockRestore();
    }
  });

  it('stops a PDF being written when the dialog closes, and saves nothing', async () => {
    let signal: AbortSignal | undefined;
    let finish: (bytes: Uint8Array) => void = () => {};
    writePdf.mockImplementation((_pages, _fonts, _options, given) => {
      signal = given;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await open();
    // An option changed, so remembering it would show.
    await click(radio('Print shop'));
    await click(exportButton());
    expect(exportButton().textContent).toBe('Writing PDF…');
    expect(button('Stop')).toBeTruthy();
    act(() => root.unmount());
    root = createRoot(host);
    expect(signal?.aborted).toBe(true);
    // The writer answers anyway: nothing is offered to a save dialog, announced or remembered.
    await act(async () => {
      finish(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    });
    await act(async () => {});
    expect(saveBinaryFile).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalledWith('diagram exported', expect.anything());
    expect(useSettingsStore.getState().diagramExport.pdf).toBe('home');
  });
});

describe('DiagramExportModal', () => {
  afterEach(() => {
    act(() => useWorkspaceStore.setState({ diagram: null }));
  });

  it('closes a request whose diagram goes away or is replaced, rather than reopening it on another', () => {
    const dialog = () => host.querySelector('[role="dialog"]');
    act(() => useWorkspaceStore.setState({ diagram: diagram(), diagramLoadId: 7 }));
    act(() => useDiagramExportUiStore.getState().open(null, 7));
    act(() => root.render(<TooltipProvider><DiagramExportModal /></TooltipProvider>));
    expect(dialog()).not.toBeNull();

    // Undone back to no diagram: closed, and a diagram made later does not bring it back.
    act(() => useWorkspaceStore.setState({ diagram: null }));
    expect(useDiagramExportUiStore.getState().request).toBeNull();
    act(() => useWorkspaceStore.setState({ diagram: diagram() }));
    expect(dialog()).toBeNull();

    // Another project's diagram in its place: closed too.
    act(() => useDiagramExportUiStore.getState().open(null, 7));
    expect(dialog()).not.toBeNull();
    act(() => useWorkspaceStore.setState({ diagram: diagram(), diagramLoadId: 8 }));
    expect(useDiagramExportUiStore.getState().request).toBeNull();
    expect(dialog()).toBeNull();
  });
});
