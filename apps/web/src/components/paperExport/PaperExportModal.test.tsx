import { unzipSync } from 'fflate';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runReferencesShortcut,
  type ReferencesShortcutActions,
} from '../../cp-workspace/references/referencesShortcuts';
import { registerReferencesShortcutExecutor } from '../../keyboard/shortcutRuntime';
import i18n from '../../i18n';
import { installAppKeyboardListener } from '../../lib/appKeyboard';
import { builtInPaperPreset } from '../../lib/paper/paperPresets';
import type { PaperScene } from '../../lib/paper/paperScene';
import {
  DEFAULT_PAPER_STYLE,
  type PaperStyle,
  type PaperStyleOverrides,
} from '../../lib/paper/paperStyle';
import { DEFAULT_PAPER_EXPORT_SETTINGS, paperExportMemoryOf } from '../../lib/paperExportSettings';
import { emptyMultiSelection } from '../../lib/selection';
import type {
  PaperExportPages,
  PaperExportScope,
  PaperExportTarget,
} from '../../paperExport/paperExportTarget';
import type { FileService } from '../../platform/fileService';
import { usePaperExportUiStore } from '../../store/paperExportUiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { TooltipProvider } from '../ui/Tooltip';
import { PaperExportModal } from './PaperExportModal';
import { paperExportPinsHint } from './PaperStylePicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Radix measures its controls; jsdom has nothing to measure with.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
// Radix Select scrolls the selected option into view as it opens.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

vi.mock('../../analytics/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics/runtime')>()),
  track: () => {},
}));
const { service, paperSvgToPng } = vi.hoisted(() => ({
  service: {
    saveTextFile: vi.fn(async () => ({ name: 'Crane.svg', path: null })),
    saveBinaryFile: vi.fn(async () => ({ name: 'Crane.png', path: null })),
  },
  paperSvgToPng: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../platform/fileService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/fileService')>()),
  getFileService: () => service as unknown as FileService,
}));
// jsdom cannot rasterise; a ZIP of PNGs only needs the bytes to arrive.
vi.mock('../../lib/paper/paperPng', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/paper/paperPng')>()),
  paperSvgToPng,
}));

const SCENE: PaperScene = {
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
  sheet: 100,
  items: [
    { kind: 'face', face: 0, side: 'front', rings: [[[0, 0], [100, 0], [100, 50]]], shade: 1, hidden: false },
  ],
};

function target(overrides: Partial<PaperExportTarget> = {}): PaperExportTarget {
  return {
    surface: 'folded-flat',
    title: 'Export folded figure',
    fileStem: 'Crane',
    pages: null,
    exportStyle: DEFAULT_PAPER_STYLE,
    pins: null,
    buriesFaces: true,
    sceneKey: ({ style }) => style.paper.front,
    buildScene: async () => SCENE,
    paintStyle: (style: PaperStyle) => style,
    release: vi.fn(),
    ...overrides,
  };
}

const initialSettings = useSettingsStore.getInitialState();
let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function open(
  opened: PaperExportTarget,
  returnFocus: HTMLElement | null = null,
  format: 'svg' | 'png' | null = null,
  scope: PaperExportScope = 'this'
) {
  await act(async () => {
    usePaperExportUiStore.getState().open({ target: opened, format, scope, returnFocus });
  });
}

const dialog = (title = 'Export folded figure') =>
  document.querySelector<HTMLElement>(`[role="dialog"][aria-label="${title}"]`);
const page = () => dialog()?.querySelector<HTMLElement>('[role="document"]') ?? null;
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent?.trim() === name || element.getAttribute('aria-label') === name
  );
const field = (label: string, title?: string) =>
  dialog(title)?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`) ?? null;
const text = () => dialog()?.textContent ?? '';

function key(target: EventTarget, name: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Settles what a keypress queued: the frame's refocus microtask, a deferred repaint. */
async function flush() {
  await act(async () => {});
}

/** Types into a React-controlled input the way the browser does. */
function type(input: HTMLInputElement, value: string) {
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Makes the next SVG save wait until the returned function settles it. */
function holdNextSave(): (name: string) => Promise<void> {
  let settle: (result: { name: string; path: null }) => void = () => {};
  service.saveTextFile.mockImplementationOnce(
    () => new Promise((resolve) => (settle = resolve))
  );
  return async (name) => {
    await act(async () => settle({ name, path: null }));
  };
}

async function submit() {
  await act(async () => {
    dialog()?.querySelector('form')?.requestSubmit();
  });
}

beforeEach(() => {
  useSettingsStore.setState(initialSettings, true);
  usePaperExportUiStore.setState({ request: null });
  service.saveTextFile.mockClear();
  service.saveBinaryFile.mockClear();
  paperSvgToPng.mockClear();
  // jsdom has no object URLs.
  URL.createObjectURL = vi.fn(() => 'blob:page');
  URL.revokeObjectURL = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <TooltipProvider delayDuration={0}>
        <PaperExportModal />
      </TooltipProvider>
    )
  );
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
  usePaperExportUiStore.setState({ request: null });
  useSettingsStore.setState(initialSettings, true);
});

describe('PaperExportModal', () => {
  it('shows nothing until a surface opens it', () => {
    expect(dialog()).toBeNull();
  });

  it('shows the page and states its size, with Export ready and focused', async () => {
    await open(target());
    expect(dialog()).not.toBeNull();
    expect(dialog()?.querySelector('img')?.getAttribute('src')).toBe('blob:page');
    expect(text()).toMatch(/\d+(\.\d)? × \d+(\.\d)? mm · \d+ KB/);
    const exportButton = button('Export SVG');
    expect(exportButton?.disabled).toBe(false);
    expect(document.activeElement).toBe(exportButton);
  });

  it('shows Resolution for a PNG, and Keep hidden faces only for an SVG that can bury faces', async () => {
    await open(target());
    expect(text()).toContain('Keep hidden faces');
    expect(text()).not.toContain('Resolution');
    await act(async () => button('PNG')?.click());
    expect(text()).toContain('Resolution');
    expect(text()).not.toContain('Keep hidden faces');
    expect(text()).toMatch(/px/);
    expect(button('Export PNG')).toBeTruthy();

    act(() => usePaperExportUiStore.getState().close());
    await open(target({ buriesFaces: false }));
    expect(text()).not.toContain('Keep hidden faces');
  });

  it('asks for a page colour once the page is not transparent', async () => {
    await open(target());
    expect(dialog()?.querySelector('input[type="color"]')).toBeNull();
    await act(async () => button('Transparent background')?.click());
    expect(dialog()?.querySelector('input[type="color"]')).not.toBeNull();
  });

  it('closes on Escape, releasing its capture, and hands focus back', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    const opened = target();
    await open(opened, opener);
    key(document.body, 'Escape');
    expect(dialog()).toBeNull();
    expect(opened.release).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });

  it('leaves Escape to a field that is being typed in', async () => {
    await open(target());
    const margin = dialog()?.querySelector<HTMLInputElement>('input[aria-label="Margin"]');
    expect(margin).toBeTruthy();
    key(margin!, 'Escape');
    expect(dialog()).not.toBeNull();
  });

  it('saves the page when Export is pressed, and closes', async () => {
    await open(target());
    await act(async () => {
      dialog()?.querySelector('form')?.requestSubmit();
    });
    expect(service.saveTextFile).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'Crane.svg' }));
    expect(dialog()).toBeNull();
  });

  it('closes on Cancel without saving', async () => {
    await open(target());
    act(() => button('Cancel')?.click());
    expect(dialog()).toBeNull();
    expect(service.saveTextFile).not.toHaveBeenCalled();
  });

  it('closes on a press on the backdrop but not on one inside the page', async () => {
    await open(target());
    act(() => page()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(dialog()).not.toBeNull();
    act(() => dialog()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(dialog()).toBeNull();
  });

  it('leaves Escape to a dialog stacked over it', async () => {
    await open(target());
    const settings = document.body.appendChild(document.createElement('div'));
    settings.setAttribute('role', 'dialog');
    settings.setAttribute('aria-modal', 'true');
    const inside = settings.appendChild(document.createElement('button'));

    key(inside, 'Escape');
    expect(dialog()).not.toBeNull();

    settings.remove();
    key(page()!, 'Escape');
    expect(dialog()).toBeNull();
  });

  it('opens on the remembered format, and names the PNG it cannot rasterise', async () => {
    // 1000 mm at 600 dpi is about 23 900 px a side, past every engine's canvas.
    const { paperExport } = useSettingsStore.getState();
    useSettingsStore.setState({
      paperExport: {
        ...paperExport,
        'folded-figure': { ...paperExport['folded-figure'], format: 'png', sheet: { mm: 1000 }, pngDpi: 600 },
      },
    });
    await open(target());
    const caption = () => dialog()?.querySelector('.paper-export__caption')?.textContent ?? '';
    expect(caption()).toMatch(/^Too large to export as PNG: [\d,]+ × [\d,]+ px/);
    expect(button('Export PNG')?.disabled).toBe(true);

    const sheet = field('Sheet size');
    type(sheet!, '100');
    key(sheet!, 'Enter');
    await flush();
    expect(caption()).toMatch(/^[\d.]+ × [\d.]+ mm · [\d,]+ × [\d,]+ px$/);
    expect(button('Export PNG')?.disabled).toBe(false);
  });

  it('offers a target with a sheet of its own the sheet size alone, starting there even when "as shown" is remembered', async () => {
    const { paperExport } = useSettingsStore.getState();
    useSettingsStore.setState({
      paperExport: { ...paperExport, 'folded-figure': { ...paperExport['folded-figure'], sheet: 'as-shown' } },
    });
    await open(target({ defaultSheetMm: 250 }));
    expect(button('As shown')).toBeUndefined();
    expect(button('Custom')).toBeUndefined();
    expect(field('Sheet size')?.value).toBe('250');
    expect(text()).toContain('The unfolded sheet spans this size');

    act(() => usePaperExportUiStore.getState().close());
    await open(target());
    expect(button('As shown')).toBeDefined();
    expect(field('Sheet size')).toBeNull();
  });

  it('puts Size and Margin on rows of one kind, each labelled beside its field', async () => {
    const rowLabel = (label: string) =>
      field(label)
        ?.closest('.export-modal__field-row')
        ?.querySelector('.export-modal__label')?.textContent ?? null;
    const { paperExport } = useSettingsStore.getState();
    useSettingsStore.setState({
      paperExport: { ...paperExport, 'folded-figure': { ...paperExport['folded-figure'], sheet: 'as-shown' } },
    });

    await open(target({ defaultSheetMm: 250 }));
    expect(rowLabel('Sheet size')).toBe('Size');
    expect(rowLabel('Margin')).toBe('Margin');

    // With "As shown" on offer, the choice has a heading of its own, and the
    // Size row comes with Custom.
    act(() => usePaperExportUiStore.getState().close());
    await open(target());
    const headings = () =>
      [...(dialog()?.querySelectorAll('.export-modal__label') ?? [])].map((label) => label.textContent);
    expect(headings()).toContain('Sheet');
    expect(headings()).not.toContain('Size');
    await act(async () => button('Custom')?.click());
    expect(rowLabel('Sheet size')).toBe('Size');
    expect(rowLabel('Margin')).toBe('Margin');
  });

  it('starts a fresh draft when opened over an open dialog, releasing the one it replaces', async () => {
    const first = target();
    await open(first);
    const margin = field('Margin');
    type(margin!, '12');
    key(margin!, 'Enter');
    expect(field('Margin')?.value).toBe('12');

    await open(target({ title: 'Export step 2' }), null, 'png');
    expect(dialog()).toBeNull();
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(dialog('Export step 2')).not.toBeNull();
    expect(field('Margin', 'Export step 2')?.value).toBe('5');
    expect(button('Export PNG')).toBeTruthy();
    // The draft that was dropped is not remembered either.
    expect(useSettingsStore.getState().paperExport).toEqual(initialSettings.paperExport);
  });

  describe('while a save is in flight', () => {
    it('cannot be closed, and closes once the file is written', async () => {
      const settle = holdNextSave();
      await open(target());
      await submit();
      expect(service.saveTextFile).toHaveBeenCalledTimes(1);
      expect(button('Cancel')?.disabled).toBe(true);
      expect(button('Close Export folded figure')?.disabled).toBe(true);
      expect(button('Exporting…')?.disabled).toBe(true);

      key(page()!, 'Escape');
      expect(dialog()).not.toBeNull();
      act(() => dialog()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
      expect(dialog()).not.toBeNull();

      await settle('Crane.svg');
      expect(dialog()).toBeNull();
    });

    it('leaves a dialog opened over it open when it settles', async () => {
      const settle = holdNextSave();
      await open(target());
      await submit();
      await open(target({ title: 'Export step 2' }));

      await settle('Crane.svg');
      expect(dialog('Export step 2')).not.toBeNull();
    });
  });

  describe('focus', () => {
    it('keeps focus in the dialog when Enter commits a field, where the next Enter exports', async () => {
      await open(target());
      const margin = field('Margin');
      type(margin!, '8');
      const commit = key(margin!, 'Enter');
      await flush();
      expect(field('Margin')?.value).toBe('8');
      // Not the form's implicit submission, which would save the page before the margin reached it.
      expect(commit.defaultPrevented).toBe(true);
      expect(service.saveTextFile).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(page());

      await act(async () => {
        page()?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        );
      });
      expect(service.saveTextFile).toHaveBeenCalledTimes(1);
    });

    it('lets go of the colour swatch on Escape, and closes on the next', async () => {
      await open(target());
      await act(async () => button('Transparent background')?.click());
      const swatch = field('Background');
      act(() => swatch?.focus());

      key(swatch!, 'Escape');
      await flush();
      expect(dialog()).not.toBeNull();
      expect(document.activeElement).toBe(page());

      key(document.activeElement!, 'Escape');
      expect(dialog()).toBeNull();
    });
  });

  describe('style picker', () => {
    const trigger = () => dialog()?.querySelector<HTMLButtonElement>('button[aria-label="Style"]');
    const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]');
    const option = (name: string) =>
      [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (element) => element.textContent?.trim() === name
      );

    async function openPicker() {
      // Enter opens the Select; it is not the dialog's Enter, which would export.
      await act(async () => {
        trigger()?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        );
      });
      await flush();
    }

    it('names the export slot, and rebuilds and repaints the page in a picked preset', async () => {
      let urls = 0;
      URL.createObjectURL = vi.fn(() => `blob:page-${++urls}`);
      const buildScene = vi.fn<PaperExportTarget['buildScene']>(async () => SCENE);
      await open(target({ sceneKey: ({ style }) => JSON.stringify(style), buildScene }));
      expect(trigger()?.textContent).toBe('Export style · Default, from display');
      const before = dialog()?.querySelector('img')?.getAttribute('src');
      buildScene.mockClear();

      await openPicker();
      expect(service.saveTextFile).not.toHaveBeenCalled();
      expect(listbox()).not.toBeNull();
      await act(async () => option('Diagram')?.click());
      await flush();

      expect(listbox()).toBeNull();
      expect(trigger()?.textContent).toBe('Diagram');
      expect(buildScene).toHaveBeenCalledTimes(1);
      expect(buildScene.mock.calls[0]?.[0]?.style).toEqual(builtInPaperPreset('diagram').style);
      expect(dialog()?.querySelector('img')?.getAttribute('src')).not.toBe(before);
    });

    it('closes the open Select on Escape and leaves the dialog open', async () => {
      await open(target());
      await openPicker();
      expect(listbox()).not.toBeNull();
      // Radix moves focus onto the selected option as the listbox opens.
      expect(listbox()?.contains(document.activeElement)).toBe(true);

      key(document.activeElement!, 'Escape');
      expect(listbox()).toBeNull();
      expect(dialog()).not.toBeNull();
    });
  });
});

describe('PaperExportModal over the References workspace', () => {
  const references: ReferencesShortcutActions = {
    nextStep: vi.fn(),
    previousStep: vi.fn(),
    nextCandidate: vi.fn(),
    previousCandidate: vi.fn(),
    recompute: vi.fn(),
    toggleLandmarksFirst: vi.fn(),
    resetView: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    clearTarget: vi.fn(),
    playFold: vi.fn(),
    exportStep: vi.fn(),
    exportAllSteps: vi.fn(),
    exportStepSvg: vi.fn(),
    exportStepPng: vi.fn(),
  };
  let teardown: Array<() => void> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    teardown = [
      installAppKeyboardListener({
        getActiveEditingContext: () => 'references',
        getSelection: () => emptyMultiSelection(),
        handleMenuAction: () => undefined,
        selectNone: () => undefined,
      }),
      registerReferencesShortcutExecutor((id) => runReferencesShortcut(id, references)),
    ];
  });

  afterEach(() => {
    for (const undo of teardown) undo();
    teardown = [];
  });

  it('reaches the workspace with no dialog up', () => {
    const space = key(document.body, ' ');
    expect(references.playFold).toHaveBeenCalledTimes(1);
    expect(space.defaultPrevented).toBe(true);
  });

  it('keeps Space and the arrows on its focused Export button from the workspace behind', async () => {
    await open(target());
    const exportButton = button('Export SVG')!;
    expect(document.activeElement).toBe(exportButton);

    const space = key(exportButton, ' ');
    const arrow = key(exportButton, 'ArrowRight');
    expect(references.playFold).not.toHaveBeenCalled();
    expect(references.nextStep).not.toHaveBeenCalled();
    expect(space.defaultPrevented).toBe(false);
    expect(arrow.defaultPrevented).toBe(false);
  });

  it('takes Escape for itself: it closes, and the workspace keeps its target', async () => {
    await open(target());
    key(button('Export SVG')!, 'Escape');
    expect(dialog()).toBeNull();
    expect(references.clearTarget).not.toHaveBeenCalled();
  });
});

describe('PaperExportModal on a target with several pages', () => {
  const STEPS: PaperExportPages = {
    list: [
      { label: 'Step 1', fileStem: '01 step 1' },
      { label: 'Step 2', fileStem: '02 step 2' },
      { label: 'Turn over', fileStem: '03 turn over after step 2' },
    ],
    current: 1,
    title: 'Export all steps',
    zipStem: 'Crane steps',
  };

  const steps = (overrides: Partial<PaperExportTarget> = {}) =>
    target({
      surface: 'references',
      title: 'Export step 2',
      fileStem: 'Crane step 2',
      pages: STEPS,
      buriesFaces: false,
      sceneKey: ({ page, style }) => `${page}:${style.paper.front}`,
      ...overrides,
    });

  const scopeGroup = () => document.querySelector<HTMLElement>('[role="group"][aria-label="Steps"]');
  const pagerLabel = () =>
    document.querySelector('.paper-export__pager [aria-live]')?.textContent ?? null;
  const caption = () => document.querySelector('.paper-export__caption')?.textContent ?? '';

  /** Makes each of the next `count` rasterisations wait until its own release. */
  function holdRasterising(count: number): Array<() => Promise<void>> {
    return Array.from({ length: count }, () => {
      let settle: () => void = () => {};
      paperSvgToPng.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settle = () => resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
          })
      );
      return async () => {
        await act(async () => settle());
      };
    });
  }

  it('offers no Steps switch for a target with one page', async () => {
    await open(target());
    expect(scopeGroup()).toBeNull();

    act(() => usePaperExportUiStore.getState().close());
    await open(steps({ pages: { ...STEPS, list: STEPS.list.slice(0, 1), current: 0 } }));
    expect(dialog('Export step 2')).not.toBeNull();
    expect(scopeGroup()).toBeNull();
  });

  it('opens on This step, exporting the page on show alone', async () => {
    await open(steps());
    expect(scopeGroup()).not.toBeNull();
    expect(button('This step')?.getAttribute('aria-pressed')).toBe('true');
    expect(pagerLabel()).toBeNull();
    expect(caption()).not.toContain('ZIP');
    expect(button('Export SVG')).toBeTruthy();
  });

  it('switches to All steps: retitled, paged through, and captioned as a ZIP', async () => {
    await open(steps());
    await act(async () => button('All steps')?.click());
    await flush();

    expect(dialog('Export step 2')).toBeNull();
    expect(dialog('Export all steps')).not.toBeNull();
    expect(button('All steps')?.getAttribute('aria-pressed')).toBe('true');
    // The pager opens on the step the surface was showing.
    expect(pagerLabel()).toBe('Step 2 · 2 of 3');
    expect(caption()).toMatch(/ · 3 files · ZIP$/);
    expect(button('Export SVGs as ZIP')?.disabled).toBe(false);

    await act(async () => button('Previous step')?.click());
    expect(pagerLabel()).toBe('Step 1 · 1 of 3');
    expect(button('Previous step')?.disabled).toBe(true);
    expect(button('Next step')?.disabled).toBe(false);

    await act(async () => button('Next step')?.click());
    await act(async () => button('Next step')?.click());
    expect(pagerLabel()).toBe('Turn over · 3 of 3');
    expect(button('Next step')?.disabled).toBe(true);
    expect(button('Previous step')?.disabled).toBe(false);
  });

  it('saves every step as one ZIP when Export is pressed, and closes', async () => {
    await open(steps());
    await act(async () => button('All steps')?.click());
    await flush();

    await act(async () => button('Export SVGs as ZIP')?.click());
    // fflate is loaded on demand, past the microtasks one act settles.
    await act(async () => {
      await vi.waitFor(() => expect(service.saveBinaryFile).toHaveBeenCalled());
    });
    await flush();

    expect(service.saveTextFile).not.toHaveBeenCalled();
    expect(service.saveBinaryFile).toHaveBeenCalledTimes(1);
    const saved = (service.saveBinaryFile.mock.calls[0] as unknown[])[0] as {
      bytes: Uint8Array;
      suggestedName: string;
      mimeType: string;
    };
    expect(saved).toMatchObject({ mimeType: 'application/zip', suggestedName: 'Crane-steps.zip' });
    const entries = unzipSync(saved.bytes);
    expect(Object.keys(entries)).toEqual([
      '01-step-1.svg',
      '02-step-2.svg',
      '03-turn-over-after-step-2.svg',
    ]);
    for (const entry of Object.values(entries)) {
      expect(new TextDecoder().decode(entry)).toContain('<svg');
    }
    expect(dialog('Export all steps')).toBeNull();
  });

  it('opens straight on All steps when the request asks for every step', async () => {
    await open(steps(), null, null, 'all');
    await flush();
    expect(dialog('Export all steps')).not.toBeNull();
    expect(button('All steps')?.getAttribute('aria-pressed')).toBe('true');
    expect(pagerLabel()).toBe('Step 2 · 2 of 3');
    expect(button('Export SVGs as ZIP')).toBeTruthy();
  });

  it('opens a target with one page on that page, whatever the request asks for', async () => {
    await open(target(), null, null, 'all');
    expect(dialog()).not.toBeNull();
    expect(pagerLabel()).toBeNull();
    expect(button('Export SVG')).toBeTruthy();
  });

  describe('while the pages of a ZIP paint', () => {
    it('counts them off on Export, and stays open to Cancel', async () => {
      const [first] = holdRasterising(2);
      await open(steps(), null, 'png', 'all');
      await flush();

      await act(async () => button('Export PNGs as ZIP')?.click());
      expect(paperSvgToPng).toHaveBeenCalledTimes(1);
      expect(button('Exporting 1 of 3…')?.disabled).toBe(true);
      expect(button('Cancel')?.disabled).toBe(false);
      expect(button('Close Export all steps')?.disabled).toBe(false);

      await first!();
      expect(button('Exporting 2 of 3…')).toBeTruthy();
    });

    it('stops at the next page when cancelled, and saves nothing', async () => {
      const [first, second] = holdRasterising(2);
      const opened = steps();
      await open(opened, null, 'png', 'all');
      await flush();

      await act(async () => button('Export PNGs as ZIP')?.click());
      await first!();
      expect(button('Exporting 2 of 3…')).toBeTruthy();

      act(() => button('Cancel')?.click());
      expect(dialog('Export all steps')).toBeNull();
      expect(opened.release).toHaveBeenCalledTimes(1);

      await second!();
      await flush();
      expect(paperSvgToPng).toHaveBeenCalledTimes(2);
      expect(service.saveBinaryFile).not.toHaveBeenCalled();
    });

    it('cannot be closed once every page is painted and the ZIP is being written', async () => {
      let settle: (result: { name: string; path: null }) => void = () => {};
      service.saveBinaryFile.mockImplementationOnce(
        () => new Promise((resolve) => (settle = resolve))
      );
      await open(steps(), null, 'png', 'all');
      await flush();

      await act(async () => button('Export PNGs as ZIP')?.click());
      await act(async () => {
        await vi.waitFor(() => expect(service.saveBinaryFile).toHaveBeenCalled());
      });
      expect(button('Exporting 3 of 3…')?.disabled).toBe(true);
      expect(button('Cancel')?.disabled).toBe(true);
      key(dialog('Export all steps')!.querySelector('[role="document"]')!, 'Escape');
      expect(dialog('Export all steps')).not.toBeNull();

      await act(async () => settle({ name: 'Crane-steps.zip', path: null }));
      expect(dialog('Export all steps')).toBeNull();
    });
  });
});

describe('PaperExportModal on a fixed picture', () => {
  const fixed = () =>
    target({
      surface: 'folded-3d',
      title: 'Export Crane',
      fixedPicture: {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"></svg>',
        widthPx: 400,
        heightPx: 300,
      },
    });
  const labels = () =>
    [...(dialog('Export Crane')?.querySelectorAll('.export-modal__label') ?? [])].map(
      (label) => label.textContent
    );
  const fixedText = () => dialog('Export Crane')?.textContent ?? '';
  const caption = () => document.querySelector('.paper-export__caption')?.textContent ?? '';

  it('offers the format alone, and says why', async () => {
    await open(fixed());
    expect(labels()).toEqual(['Format']);
    expect(dialog('Export Crane')?.querySelector('button[aria-label="Style"]')).toBeNull();
    expect(field('Margin', 'Export Crane')).toBeNull();
    expect(fixedText()).not.toContain('Transparent background');
    expect(fixedText()).not.toContain('Keep hidden faces');
    expect(fixedText()).toContain('This figure is exported as it was saved');
    expect(button('Export SVG')?.disabled).toBe(false);

    await act(async () => button('PNG')?.click());
    expect(labels()).toEqual(['Format']);
    expect(fixedText()).not.toContain('Resolution');
    expect(button('Export PNG')?.disabled).toBe(false);
  });

  it('captions a PNG with the picture’s own pixel size, whatever density was remembered', async () => {
    useSettingsStore.setState({
      paperExport: paperExportMemoryOf({ ...DEFAULT_PAPER_EXPORT_SETTINGS, pngDpi: 600 }),
    });
    await open(fixed(), null, 'png');
    expect(caption()).toMatch(/^[\d.]+ × [\d.]+ mm · 400 × 300 px$/);
  });
});

describe('PaperExportModal diagram marks', () => {
  /** A References step whose scene bakes in its marks, as the real target's does. */
  const stepTarget = (buildScene = vi.fn(async () => SCENE)) =>
    target({
      surface: 'references',
      title: 'Export step 3',
      buriesFaces: false,
      marks: ['letters', 'highlights'],
      sceneKey: ({ style, marks }) => `${style.paper.front}|${JSON.stringify(marks)}`,
      buildScene,
    });
  const stepText = () => dialog('Export step 3')?.textContent ?? '';
  // The sections are found by their headings.
  const sections = (title?: string) =>
    [...(dialog(title)?.querySelectorAll('.export-modal__label') ?? [])].map((label) => label.textContent);
  const toggle = (name: string, title?: string) =>
    dialog(title)?.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) ?? null;

  it('offers Letters and Line highlights, both on, for a target that declares them', async () => {
    await open(stepTarget());
    expect(sections('Export step 3')).toContain('Marks');
    expect(stepText()).toContain('The names of the points a step refers to.');
    expect(toggle('Letters', 'Export step 3')?.getAttribute('aria-checked')).toBe('true');
    expect(toggle('Line highlights', 'Export step 3')?.getAttribute('aria-checked')).toBe('true');
  });

  it('offers no Marks section for a target without marks, nor for a fixed picture', async () => {
    await open(target());
    expect(sections()).not.toContain('Marks');
    expect(toggle('Letters')).toBeNull();

    act(() => usePaperExportUiStore.getState().close());
    await open(
      target({
        marks: ['letters', 'highlights'],
        fixedPicture: { svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', widthPx: 10, heightPx: 10 },
      })
    );
    expect(sections()).toEqual(['Format']);
    expect(toggle('Letters')).toBeNull();
  });

  it('rebuilds and repaints the page when a mark is turned off, and remembers it for the next step', async () => {
    const buildScene = vi.fn(async () => SCENE);
    await open(stepTarget(buildScene));
    const painted = vi.mocked(URL.createObjectURL).mock.calls.length;
    await act(async () => toggle('Letters', 'Export step 3')?.click());
    expect(toggle('Letters', 'Export step 3')?.getAttribute('aria-checked')).toBe('false');
    expect(buildScene).toHaveBeenLastCalledWith(
      expect.objectContaining({ marks: { letters: false, highlights: true } })
    );
    expect(vi.mocked(URL.createObjectURL).mock.calls.length).toBeGreaterThan(painted);

    await act(async () => {
      dialog('Export step 3')?.querySelector('form')?.requestSubmit();
    });
    expect(service.saveTextFile).toHaveBeenCalledTimes(1);
    const { paperExport } = useSettingsStore.getState();
    expect(paperExport.step.marks).toEqual({ letters: false, highlights: true });
    expect(paperExport['folded-figure'].marks).toEqual({ letters: true, highlights: true });

    await open(stepTarget());
    expect(toggle('Letters', 'Export step 3')?.getAttribute('aria-checked')).toBe('false');
    expect(toggle('Line highlights', 'Export step 3')?.getAttribute('aria-checked')).toBe('true');
  });

  it('turns Line highlights off on its own, leaving Letters as they are', async () => {
    const buildScene = vi.fn(async () => SCENE);
    await open(stepTarget(buildScene));
    await act(async () => toggle('Line highlights', 'Export step 3')?.click());
    expect(toggle('Line highlights', 'Export step 3')?.getAttribute('aria-checked')).toBe('false');
    expect(toggle('Letters', 'Export step 3')?.getAttribute('aria-checked')).toBe('true');
    expect(buildScene).toHaveBeenLastCalledWith(
      expect.objectContaining({ marks: { letters: true, highlights: false } })
    );
  });
});

describe('PaperExportModal style hint', () => {
  const PINS: PaperStyleOverrides = {
    'paper.front': '#ff00ff',
    light: { ...DEFAULT_PAPER_STYLE.light, enabled: false },
  };
  const PINS_LINE = 'Keeps its own front colour and light, whichever style is picked.';
  const hint = () =>
    dialog()
      ?.querySelector('button[aria-label="Style"]')
      ?.closest('.export-modal__control-group')
      ?.querySelector('.export-modal__hint')?.textContent ?? null;

  it('names the fields the object keeps of its own under the Style picker', async () => {
    await open(target({ pins: PINS }));
    expect(hint()).toBe(PINS_LINE);
  });

  it('follows the pins with the target’s own hint', async () => {
    await open(target({ pins: PINS, hint: 'X' }));
    expect(hint()).toBe(`${PINS_LINE} X`);
  });

  it('shows the target’s hint alone when nothing is pinned', async () => {
    await open(target({ hint: 'X' }));
    expect(hint()).toBe('X');
  });

  it('shows no hint with no pins and no hint of its own', async () => {
    await open(target({ pins: {} }));
    expect(dialog()?.querySelector('button[aria-label="Style"]')).not.toBeNull();
    expect(hint()).toBeNull();
  });
});

describe('paperExportPinsHint', () => {
  it('is null for an object that pins nothing', () => {
    expect(paperExportPinsHint(i18n.t, 'en', null)).toBeNull();
    expect(paperExportPinsHint(i18n.t, 'en', undefined)).toBeNull();
    expect(paperExportPinsHint(i18n.t, 'en', {})).toBeNull();
    expect(paperExportPinsHint(i18n.t, 'en', { 'paper.front': undefined })).toBeNull();
  });

  it('lists the pinned fields in the style’s own order, as the locale joins a list', () => {
    const pins: PaperStyleOverrides = {
      light: DEFAULT_PAPER_STYLE.light,
      'auxCreases.visible': false,
      'paper.front': '#ff00ff',
    };
    expect(paperExportPinsHint(i18n.t, 'en', pins)).toBe(
      'Keeps its own front colour, auxiliary creases shown or hidden, and light, whichever style is picked.'
    );
    expect(paperExportPinsHint(i18n.t, 'de', pins)).toBe(
      'Keeps its own front colour, auxiliary creases shown or hidden und light, whichever style is picked.'
    );
  });
});
