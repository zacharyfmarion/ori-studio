import { strFromU8, strToU8, unzipSync } from 'fflate';
import { act, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_SHEET_MM, DIAGRAM_STEP_SHEET_MM } from '../lib/paper/paperPage';
import type { PaperScene } from '../lib/paper/paperScene';
import { DEFAULT_PAPER_STYLE, type PaperStyle } from '../lib/paper/paperStyle';
import { builtInPaperPreset } from '../lib/paper/paperPresets';
import {
  DEFAULT_PAPER_EXPORT_SETTINGS,
  type PaperExportKind,
  type PaperExportSettings,
} from '../lib/paperExportSettings';
import { paperPngSize } from '../lib/paper/paperPng';
import { paperPresetRows } from '../lib/paperPresetRows';
import { readJson, readString, removeKey, STORAGE_KEYS, storageKey } from '../lib/storage';
import type { FileService, SaveBinaryFileOptions } from '../platform/fileService';
import type { PaperExportRequest } from '../store/paperExportUiStore';
import { useSettingsStore } from '../store/settingsStore';
import { paintPaperExport, paperExportPage, paperExportStyle } from './paperExportSession';
import type { PaperExportPage, PaperExportScope, PaperExportTarget, PaperSceneInput } from './paperExportTarget';
import {
  paperExportDraft,
  usePaperExportDialog,
  type PaperExportDialogBinding,
} from './usePaperExportDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tracked: { event: string; properties?: Record<string, unknown> }[] = [];
vi.mock('../analytics/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../analytics/runtime')>()),
  track: (event: string, properties?: Record<string, unknown>) => {
    tracked.push(properties ? { event, properties } : { event });
  },
}));

const { toast, service, encodePng, appleMobile } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  encodePng: vi.fn(async (): Promise<Uint8Array> => new Uint8Array([137, 80, 78, 71])),
  appleMobile: vi.fn(() => false),
  service: {
    saveTextFile: vi.fn(async (): Promise<{ name: string; path: null } | null> => ({
      name: 'Crane step 3.svg',
      path: null,
    })),
    saveBinaryFile: vi.fn(
      async (_options: SaveBinaryFileOptions): Promise<{ name: string; path: null } | null> => ({
        name: 'Crane step 3.png',
        path: null,
      })
    ),
  },
}));
vi.mock('sonner', () => ({ toast }));
vi.mock('../platform/fileService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/fileService')>()),
  getFileService: () => service as unknown as FileService,
}));
// jsdom has no canvas to rasterise on.
vi.mock('../lib/paper/paperPng', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/paper/paperPng')>()),
  paperSvgToPng: encodePng,
}));
vi.mock('../platform/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/runtime')>()),
  isAppleMobilePlatform: appleMobile,
}));

const SCENE: PaperScene = {
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
  sheet: 100,
  items: [
    { kind: 'face', face: 0, side: 'front', rings: [[[0, 0], [100, 0], [100, 50]]], shade: 1, hidden: false },
    { kind: 'face', face: 1, side: 'back', rings: [[[0, 0], [100, 0], [100, 50]]], shade: 1, hidden: true },
  ],
};
const WIDE_SCENE: PaperScene = { ...SCENE, bounds: { minX: 0, minY: 0, maxX: 300, maxY: 50 } };
const PAPER_EXPORT_KEY = storageKey(STORAGE_KEYS.paperExport);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeTarget(overrides: Partial<PaperExportTarget> = {}) {
  const buildScene = vi.fn(async (_input: PaperSceneInput): Promise<PaperScene | null> => SCENE);
  const target: PaperExportTarget = {
    surface: 'folded-flat',
    title: 'Export folded figure',
    fileStem: 'Crane folded',
    pages: null,
    exportStyle: DEFAULT_PAPER_STYLE,
    pins: null,
    buriesFaces: true,
    // The paper colour and the hidden test are what this fake's picture bakes in.
    sceneKey: ({ style, markHidden }) => `${style.paper.front}|${markHidden}`,
    buildScene,
    paintStyle: (style: PaperStyle) => style,
    release: vi.fn(),
    ...overrides,
  };
  return { target, buildScene };
}

/** A target whose every build waits until the test settles it. */
function manualTarget() {
  const builds: Deferred<PaperScene | null>[] = [];
  const { target } = fakeTarget({
    buildScene: vi.fn(() => {
      const build = deferred<PaperScene | null>();
      builds.push(build);
      return build.promise;
    }),
  });
  return { target, builds };
}

function stepScene(bounds: PaperScene['bounds']): PaperScene {
  const { minX, minY, maxX, maxY } = bounds;
  const ring: [number, number][] = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
  ];
  return {
    bounds,
    sheet: 100,
    items: [{ kind: 'face', face: 0, side: 'front', rings: [ring], shade: 1, hidden: false }],
  };
}

/** Three steps whose pictures each sit in a box of their own. */
const STEP_SCENES = [
  stepScene({ minX: 0, minY: 0, maxX: 100, maxY: 50 }),
  stepScene({ minX: -20, minY: 0, maxX: 60, maxY: 40 }),
  stepScene({ minX: 0, minY: -30, maxX: 80, maxY: 50 }),
];
const STEPS_UNION = { minX: -20, minY: -30, maxX: 100, maxY: 50 };
const STEP_PAGES: PaperExportPage[] = [
  { label: 'Step 1', fileStem: 'Crane step 1' },
  { label: 'Turn over', fileStem: 'Crane turn over' },
  { label: 'Step 2', fileStem: 'Crane step 2' },
];

/** Step `index`, cropped as every page of the set is. */
function onTheSetsCrop(index: number): PaperScene {
  return { ...STEP_SCENES[index]!, bounds: STEPS_UNION };
}

/** A References sequence showing its second step. */
function stepsTarget(list: readonly PaperExportPage[] = STEP_PAGES, current = 1) {
  const buildScene = vi.fn(
    async ({ page }: PaperSceneInput): Promise<PaperScene | null> => STEP_SCENES[page] ?? null
  );
  // Called once per page painted: counts the paints an export makes.
  const paintStyle = vi.fn((style: PaperStyle) => style);
  const { target } = fakeTarget({
    paintStyle,
    surface: 'references',
    title: 'Export turn over',
    fileStem: 'Crane turn over',
    pages: { list, current, title: 'Export all steps', zipStem: 'Crane steps' },
    buriesFaces: false,
    sceneKey: ({ page, style }) => `${page}|${style.paper.front}`,
    buildScene,
  });
  return {
    target,
    buildScene,
    paintStyle,
    builtPages: () => buildScene.mock.calls.map(([input]) => input.page),
  };
}

/** The ZIP handed to the save dialog, and its entries in order. */
function savedZip() {
  const [options] = service.saveBinaryFile.mock.calls[0]!;
  return { options, files: unzipSync(options.bytes) };
}

/** The page `scene` paints to under these options, as the dialog would paint it. */
function paintedFrom(scene: PaperScene, target: PaperExportTarget, draft: PaperExportSettings): string {
  const rows = paperPresetRows(useSettingsStore.getState().paperStyle.presets);
  const style = paperExportStyle(target, draft.style, rows);
  return paintPaperExport(target, scene, style, paperExportPage(target, draft)).svg;
}

/** What `kind` remembers. */
const remembered = (kind: PaperExportKind) => useSettingsStore.getState().paperExport[kind];

/** Has `kind` remember `options` over the defaults, leaving the other kinds as they are. */
function rememberFor(kind: PaperExportKind, options: Partial<PaperExportSettings>) {
  const { paperExport } = useSettingsStore.getState();
  useSettingsStore.setState({
    paperExport: { ...paperExport, [kind]: { ...DEFAULT_PAPER_EXPORT_SETTINGS, ...options } },
  });
}

const initialSettings = useSettingsStore.getInitialState();
let root: Root | null = null;
let container: HTMLDivElement | null = null;
const binding: { current: PaperExportDialogBinding | null } = { current: null };
/** The binding as each commit left it, including the ones a deferred value trails in. */
const history: PaperExportDialogBinding[] = [];
const close = vi.fn();

function Probe({ request }: { request: PaperExportRequest }) {
  const dialog = usePaperExportDialog(request, close);
  useEffect(() => {
    binding.current = dialog;
    history.push(dialog);
  });
  return dialog.preview ? <img src={dialog.preview.url} alt="" /> : null;
}

function shownSrc(): string | null {
  return container?.querySelector('img')?.getAttribute('src') ?? null;
}

function unmount() {
  act(() => root?.unmount());
  root = null;
}

async function open(
  target: PaperExportTarget,
  format: PaperExportRequest['format'] = null,
  scope: PaperExportScope = 'this'
) {
  await act(async () => {
    root?.render(<Probe request={{ id: 1, target, format, scope, returnFocus: null }} />);
  });
  return () => {
    if (!binding.current) throw new Error('hook not mounted');
    return binding.current;
  };
}

beforeEach(() => {
  tracked.length = 0;
  history.length = 0;
  toast.success.mockClear();
  service.saveTextFile.mockClear();
  service.saveBinaryFile.mockClear();
  encodePng.mockClear();
  appleMobile.mockReturnValue(false);
  close.mockClear();
  removeKey(PAPER_EXPORT_KEY);
  useSettingsStore.setState(initialSettings, true);
  // jsdom has no object URLs.
  let blobs = 0;
  URL.createObjectURL = vi.fn(() => `blob:page-${++blobs}`);
  URL.revokeObjectURL = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  binding.current = null;
  removeKey(PAPER_EXPORT_KEY);
  useSettingsStore.setState(initialSettings, true);
});

describe('paperExportDraft', () => {
  const asShown = { ...DEFAULT_PAPER_EXPORT_SETTINGS, sheet: 'as-shown' as const };

  it('opens a target with a sheet of its own at that sheet, and keeps a chosen one', () => {
    const figure = { format: null, target: { defaultSheetMm: 250 } };
    const step = { format: null, target: { defaultSheetMm: 41 } };
    expect(paperExportDraft(asShown, figure, []).sheet).toEqual({ mm: 250 });
    expect(paperExportDraft(asShown, step, []).sheet).toEqual({ mm: 41 });
    expect(paperExportDraft({ ...asShown, sheet: { mm: 90 } }, figure, []).sheet).toEqual({ mm: 90 });
  });

  it('keeps "as shown" for every other target', () => {
    expect(paperExportDraft(asShown, { format: null, target: {} }, []).sheet).toBe('as-shown');
    expect(paperExportDraft(asShown, { format: null }, []).sheet).toBe('as-shown');
  });
});

describe('usePaperExportDialog', () => {
  it('opens on the remembered options, on the verb’s format, and counts the opening', async () => {
    rememberFor('folded-figure', { format: 'svg', paddingMm: 8 });
    const { target } = fakeTarget();
    const dialog = await open(target, 'png');
    expect(dialog().draft).toMatchObject({ format: 'png', paddingMm: 8 });
    expect(tracked).toContainEqual({
      event: 'paper export opened',
      properties: { surface: 'folded-flat', scope: 'this' },
    });
  });

  it('builds the scene once and paints a page from it', async () => {
    const { target, buildScene } = fakeTarget();
    const dialog = await open(target);
    expect(buildScene).toHaveBeenCalledTimes(1);
    expect(dialog().status).toBe('ready');
    expect(dialog().preview?.page.svg).toContain('<svg');
    expect(dialog().preview?.url).toMatch(/^blob:page-/);
    expect(dialog().canExport).toBe(true);
  });

  it('repaints for a page option, and rebuilds only for what the scene bakes in', async () => {
    const { target, buildScene } = fakeTarget();
    const dialog = await open(target);
    const narrow = dialog().preview!.page.widthPt;
    await act(async () => dialog().patch({ paddingMm: 20 }));
    expect(buildScene).toHaveBeenCalledTimes(1);
    expect(dialog().preview!.page.widthPt).toBeGreaterThan(narrow);
    // A sheet size is a page option for a target whose key leaves it out.
    await act(async () => dialog().patch({ sheet: { mm: 120 } }));
    expect(buildScene).toHaveBeenCalledTimes(1);
    await act(async () => dialog().patch({ style: 'builtin:diagram' }));
    expect(buildScene).toHaveBeenCalledTimes(2);
    expect(buildScene.mock.calls[1]![0].style.paper.front).toBe(builtInPaperPreset('diagram').style.paper.front);
  });

  it('asks for the hidden test only when an SVG drops the faces nothing shows, and counts them', async () => {
    const { target, buildScene } = fakeTarget();
    const dialog = await open(target);
    expect(buildScene.mock.calls[0]![0].markHidden).toBe(false);
    await act(async () => dialog().patch({ keepHiddenFaces: false }));
    expect(buildScene.mock.calls[1]![0].markHidden).toBe(true);
    expect(dialog().hiddenFacesDropped).toBe(1);
  });

  it('saves the previewed page, remembers the options, counts it and closes', async () => {
    const { target } = fakeTarget();
    const dialog = await open(target);
    await act(async () => dialog().patch({ paddingMm: 12 }));
    const previewed = dialog().preview!.page.svg;
    await act(async () => dialog().exportNow());
    expect(service.saveTextFile).toHaveBeenCalledWith(
      expect.objectContaining({ contents: previewed, suggestedName: 'Crane-folded.svg' })
    );
    expect(remembered('folded-figure').paddingMm).toBe(12);
    expect(tracked).toContainEqual({
      event: 'paper exported',
      properties: expect.objectContaining({ surface: 'folded-flat', format: 'svg', options_changed: 'yes' }),
    });
    expect(toast.success).toHaveBeenCalledWith('Exported Crane step 3.svg');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('never offers Export on a commit whose preview is not the options as they stand', async () => {
    const { target } = fakeTarget();
    const dialog = await open(target);
    history.length = 0;
    await act(async () => dialog().patch({ paddingMm: 20 }));
    await act(async () => dialog().patch({ style: 'builtin:diagram', background: '#112233' }));
    const offered = history.filter((entry) => entry.canExport);
    expect(offered.length).toBeGreaterThan(0);
    for (const entry of offered) {
      expect(entry.preview!.page.svg).toBe(paintedFrom(SCENE, target, entry.draft));
    }
    // The deferred page and the image trail the options by a commit or two;
    // Export waits for them.
    expect(history.some((entry) => entry.status === 'ready' && !entry.canExport)).toBe(true);
  });

  it('offers no second export while a save is in flight', async () => {
    const save = deferred<{ name: string; path: null } | null>();
    service.saveTextFile.mockReturnValueOnce(save.promise);
    const { target } = fakeTarget();
    const dialog = await open(target);
    let first!: Promise<void>;
    await act(async () => {
      first = dialog().exportNow();
    });
    expect(dialog().saving).toBe(true);
    // One file being written: nothing closes the dialog until it is.
    expect(dialog().busy).toBe(true);
    expect(dialog().progress).toBeNull();
    expect(dialog().canExport).toBe(false);
    await act(async () => dialog().exportNow());
    expect(service.saveTextFile).toHaveBeenCalledTimes(1);
    await act(async () => {
      save.resolve({ name: 'Crane folded.svg', path: null });
      await first;
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('stays open, remembering nothing, when the save dialog is dismissed', async () => {
    service.saveTextFile.mockResolvedValueOnce(null);
    const { target } = fakeTarget();
    const dialog = await open(target);
    await act(async () => dialog().patch({ paddingMm: 30 }));
    await act(async () => dialog().exportNow());
    expect(close).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().paperExport).toEqual(initialSettings.paperExport);
  });

  it('says why a save failed, and stays open', async () => {
    service.saveTextFile.mockRejectedValueOnce(new Error('disk full'));
    const { target } = fakeTarget();
    const dialog = await open(target);
    await act(async () => dialog().exportNow());
    expect(dialog().saveError).toBe('disk full');
    expect(close).not.toHaveBeenCalled();
  });

  it('refuses a PNG larger than the browser will draw', async () => {
    const { target } = fakeTarget();
    const dialog = await open(target, 'png');
    await act(async () => dialog().patch({ sheet: { mm: 1000 }, pngDpi: 1200 }));
    expect(dialog().pngTooLarge).toBe(true);
    expect(dialog().canExport).toBe(false);
  });

  it('says what went wrong when the picture cannot be built', async () => {
    const { target } = fakeTarget({ buildScene: vi.fn(async () => Promise.reject(new Error('no kernel'))) });
    const dialog = await open(target);
    expect(dialog().status).toBe('error');
    expect(dialog().error).toBe('no kernel');
    expect(dialog().canExport).toBe(false);
  });

  it('remembers the format and style a file was written in, and opens on them next time', async () => {
    const { target } = fakeTarget();
    const dialog = await open(target);
    await act(async () => dialog().patch({ format: 'png', style: 'builtin:diagram' }));
    await act(async () => dialog().exportNow());
    expect(service.saveBinaryFile).toHaveBeenCalledTimes(1);
    expect(remembered('folded-figure')).toMatchObject({ format: 'png', style: 'builtin:diagram' });
    expect(readJson(PAPER_EXPORT_KEY, null)).toMatchObject({
      version: 2,
      kinds: { 'folded-figure': { format: 'png', style: 'builtin:diagram' } },
    });

    unmount();
    root = createRoot(container!);
    const reopened = await open(target);
    expect(reopened().draft).toMatchObject({ format: 'png', style: 'builtin:diagram' });
  });

  it('opens a remembered preset that no longer exists as the export style, and remembers that', async () => {
    rememberFor('folded-figure', { style: 'user:Gone' });
    const { target } = fakeTarget();
    const dialog = await open(target);
    expect(dialog().draft.style).toBe('export-style');
    await act(async () => dialog().exportNow());
    expect(remembered('folded-figure').style).toBe('export-style');
  });

  it('shows the scene for the options as they stand when an older build resolves late', async () => {
    const { target, builds } = manualTarget();
    const dialog = await open(target);
    await act(async () => dialog().patch({ style: 'builtin:diagram' }));
    expect(builds).toHaveLength(2);
    expect(dialog().status).toBe('building');
    expect(dialog().canExport).toBe(false);

    await act(async () => builds[1]!.resolve(WIDE_SCENE));
    await act(async () => builds[0]!.resolve(SCENE));
    expect(dialog().status).toBe('ready');
    expect(dialog().canExport).toBe(true);
    expect(dialog().preview!.page.svg).toBe(paintedFrom(WIDE_SCENE, target, dialog().draft));
  });

  it('ignores an older build that fails after the current one is shown', async () => {
    const { target, builds } = manualTarget();
    const dialog = await open(target);
    await act(async () => dialog().patch({ style: 'builtin:diagram' }));
    await act(async () => builds[1]!.resolve(WIDE_SCENE));
    const shown = dialog().preview;

    await act(async () => builds[0]!.reject(new Error('stale')));
    expect(dialog().status).toBe('ready');
    expect(dialog().error).toBeNull();
    expect(dialog().canExport).toBe(true);
    expect(dialog().preview).toBe(shown);
  });

  it('keeps the last complete page on screen while a new style builds, without repainting the old scene', async () => {
    const { target, builds } = manualTarget();
    const dialog = await open(target);
    await act(async () => builds[0]!.resolve(SCENE));
    const before = dialog().preview!;
    const { url, page } = before;

    await act(async () => dialog().patch({ style: 'builtin:diagram' }));
    expect(dialog().status).toBe('building');
    expect(dialog().canExport).toBe(false);
    expect(dialog().preview).toBe(before);
    expect(dialog().preview!.url).toBe(url);
    expect(dialog().preview!.page.svg).toBe(page.svg);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('writes exactly the previewed page when the options are not the defaults', async () => {
    const { target } = fakeTarget();
    const dialog = await open(target);
    await act(async () => dialog().patch({ style: 'builtin:diagram', background: '#112233', paddingMm: 12 }));
    expect(dialog().canExport).toBe(true);
    const previewed = dialog().preview!.page.svg;
    expect(previewed).toContain('fill="#112233"');
    expect(previewed).toBe(paintedFrom(SCENE, target, dialog().draft));

    await act(async () => dialog().exportNow());
    expect(service.saveTextFile).toHaveBeenCalledWith(expect.objectContaining({ contents: previewed }));
  });

  it('reports that nothing was changed when the options were saved as they opened', async () => {
    const { target } = fakeTarget();
    const dialog = await open(target);
    await act(async () => dialog().exportNow());
    expect(tracked).toContainEqual({
      event: 'paper exported',
      properties: expect.objectContaining({ options_changed: 'no' }),
    });
  });

  it('holds a PNG to the smaller canvas an iPhone or iPad will draw', async () => {
    const { target } = fakeTarget();
    const dialog = await open(target, 'png');
    await act(async () => dialog().patch({ sheet: { mm: 300 }, pngDpi: 600 }));
    const { width, height } = paperPngSize(dialog().preview!.page, 600);
    // Inside the desktop limit on each side, past WebKit's mobile area.
    expect(Math.max(width, height)).toBeLessThan(16_384);
    expect(width * height).toBeGreaterThan(4_096 * 4_096);
    expect(dialog().pngTooLarge).toBe(false);
    expect(dialog().canExport).toBe(true);

    appleMobile.mockReturnValue(true);
    await act(async () => dialog().patch({}));
    expect(dialog().pngTooLarge).toBe(true);
    expect(dialog().canExport).toBe(false);
  });

  it('abandons a PNG still encoding when the dialog goes away', async () => {
    const encode = deferred<Uint8Array>();
    encodePng.mockReturnValueOnce(encode.promise);
    const { target } = fakeTarget();
    const dialog = await open(target, 'png');
    await act(async () => dialog().patch({ paddingMm: 30 }));
    let saved: Promise<void> = Promise.resolve();
    await act(async () => {
      saved = dialog().exportNow();
    });
    expect(encodePng).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      encode.resolve(new Uint8Array([137, 80, 78, 71]));
      await saved;
    });
    expect(service.saveBinaryFile).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().paperExport).toEqual(initialSettings.paperExport);
    expect(readString(PAPER_EXPORT_KEY)).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  it('revokes a preview URL only once its replacement is on screen', async () => {
    const revokes: { url: string; shown: string | null }[] = [];
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokes.push({ url, shown: shownSrc() });
    });
    const { target } = fakeTarget();
    const dialog = await open(target);
    expect(dialog().preview!.url).toBe('blob:page-1');

    await act(async () => dialog().patch({ paddingMm: 20 }));
    expect(dialog().preview!.url).toBe('blob:page-2');
    expect(revokes).toEqual([{ url: 'blob:page-1', shown: 'blob:page-2' }]);
  });

  it('does not repaint for the density, which changes the file and not the page', async () => {
    const { target } = fakeTarget();
    const dialog = await open(target, 'png');
    const shown = dialog().preview;
    await act(async () => dialog().patch({ pngDpi: 300 }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(dialog().preview).toBe(shown);
  });

  it('does not repaint for the format when the page is the same in both', async () => {
    const { target } = fakeTarget();
    const dialog = await open(target);
    const shown = dialog().preview;
    await act(async () => dialog().patch({ format: 'png' }));
    await act(async () => dialog().patch({ format: 'svg' }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(dialog().preview).toBe(shown);
  });

  it('revokes every preview URL it made when the dialog goes away', async () => {
    const { target } = fakeTarget();
    const dialog = await open(target);
    await act(async () => dialog().patch({ paddingMm: 20 }));
    await act(async () => dialog().patch({ paddingMm: 25 }));
    unmount();
    const created = vi.mocked(URL.createObjectURL).mock.results.map((result) => result.value as string);
    const revoked = vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url);
    expect(created).toHaveLength(3);
    expect([...revoked].sort()).toEqual([...created].sort());
  });

  it('counts the opening once under StrictMode', async () => {
    const { target } = fakeTarget();
    await act(async () => {
      root?.render(
        <StrictMode>
          <Probe request={{ id: 1, target, format: null, scope: 'this', returnFocus: null }} />
        </StrictMode>
      );
    });
    expect(tracked.filter(({ event }) => event === 'paper export opened')).toHaveLength(1);
  });
});

describe('usePaperExportDialog, each kind of export on options of its own', () => {
  const KINDS: readonly (readonly [PaperExportTarget['surface'], PaperExportKind])[] = [
    ['references', 'step'],
    ['folded-flat', 'folded-figure'],
    ['folded-3d', 'folded-figure'],
    ['simulator', 'simulation'],
    ['inline-simulation', 'simulation'],
  ];

  /** Every kind on options of its own. */
  function rememberEveryKind() {
    rememberFor('simulation', { paddingMm: 7, background: '#111111' });
    rememberFor('folded-figure', { paddingMm: 11, format: 'png', pngDpi: 300 });
    rememberFor('step', { paddingMm: 13, style: 'builtin:diagram' });
    return useSettingsStore.getState().paperExport;
  }

  it.each(KINDS)('opens a %s target on what a %s remembers', async (surface, kind) => {
    const memory = rememberEveryKind();
    const dialog = await open(fakeTarget({ surface }).target);
    expect(dialog().draft).toEqual(memory[kind]);
  });

  it('remembers a save into its own kind alone, in the store and in what is stored', async () => {
    const before = rememberEveryKind();
    const dialog = await open(fakeTarget({ surface: 'references' }).target);
    await act(async () => dialog().patch({ paddingMm: 20, background: '#445566' }));
    await act(async () => dialog().exportNow());
    expect(service.saveTextFile).toHaveBeenCalledTimes(1);

    const step = { ...before.step, paddingMm: 20, background: '#445566' };
    expect(useSettingsStore.getState().paperExport).toEqual({ ...before, step });
    expect(readJson(PAPER_EXPORT_KEY, null)).toEqual({ version: 2, kinds: { ...before, step } });
  });

  it('opens a simulation and a figure on SVG after a step was saved as a PNG, and the next step on PNG', async () => {
    const step = await open(fakeTarget({ surface: 'references' }).target);
    await act(async () => step().patch({ format: 'png' }));
    await act(async () => step().exportNow());
    expect(service.saveBinaryFile).toHaveBeenCalledTimes(1);

    const reopenedOn = [
      ['simulator', 'svg'],
      ['folded-flat', 'svg'],
      ['references', 'png'],
    ] as const;
    for (const [surface, format] of reopenedOn) {
      unmount();
      root = createRoot(container!);
      const reopened = await open(fakeTarget({ surface }).target);
      expect(reopened().draft.format, surface).toBe(format);
    }
  });
});

describe('usePaperExportDialog on its first run', () => {
  it('opens a folded figure on a sheet it reads well at, a step at a diagram’s, a simulation as shown', async () => {
    const openedOn = [
      ['folded-flat', { mm: DEFAULT_PAPER_SHEET_MM }],
      ['folded-3d', { mm: DEFAULT_PAPER_SHEET_MM }],
      ['simulator', 'as-shown'],
      ['references', { mm: DIAGRAM_STEP_SHEET_MM }],
    ] as const;
    for (const [surface, sheet] of openedOn) {
      unmount();
      root = createRoot(container!);
      const dialog = await open(fakeTarget({ surface }).target);
      expect(dialog().draft.sheet, surface).toEqual(sheet);
    }
  });
});

describe('usePaperExportDialog on a target with diagram marks', () => {
  /** A References step whose scene bakes in its marks, as the real target's does. */
  function markedTarget() {
    return fakeTarget({
      surface: 'references',
      buriesFaces: false,
      marks: ['letters', 'highlights'],
      sceneKey: ({ page, style, marks }) => `${page}|${style.paper.front}|${JSON.stringify(marks)}`,
    });
  }

  it('builds the scene with the marks the options carry, and rebuilds when one is turned off', async () => {
    const { target, buildScene } = markedTarget();
    const dialog = await open(target);
    expect(buildScene.mock.calls[0]![0].marks).toEqual({ letters: true, highlights: true });
    await act(async () => dialog().patch({ marks: { letters: false, highlights: true } }));
    expect(buildScene).toHaveBeenCalledTimes(2);
    expect(buildScene.mock.calls[1]![0].marks).toEqual({ letters: false, highlights: true });
  });

  it('builds the scene at the page’s sheet size, and rebuilds it for another', async () => {
    // A References step's scene is drawn at the page's scale, so its key names the size.
    const { target, buildScene } = fakeTarget({
      surface: 'references',
      buriesFaces: false,
      defaultSheetMm: 41,
      sceneKey: ({ page, style, sheet }) => `${page}|${style.paper.front}|${JSON.stringify(sheet)}`,
    });
    const dialog = await open(target);
    expect(buildScene.mock.calls[0]![0].sheet).toEqual({ mm: 41 });
    await act(async () => dialog().patch({ sheet: { mm: 120 } }));
    expect(buildScene).toHaveBeenCalledTimes(2);
    expect(buildScene.mock.calls[1]![0].sheet).toEqual({ mm: 120 });
    expect(dialog().canExport).toBe(true);
  });

  it('builds every page of the set without the marks that are off', async () => {
    const { target, buildScene } = markedTarget();
    const dialog = await open(
      { ...target, pages: { list: STEP_PAGES, current: 0, title: 'Export all steps', zipStem: 'Crane steps' } },
      null,
      'all'
    );
    buildScene.mockClear();
    await act(async () => dialog().patch({ marks: { letters: true, highlights: false } }));
    expect(buildScene.mock.calls.map(([input]) => input.page)).toEqual([0, 1, 2]);
    for (const [input] of buildScene.mock.calls) {
      expect(input.marks).toEqual({ letters: true, highlights: false });
    }
  });

  it('remembers the marks with the step’s options, and reports them', async () => {
    const { target } = markedTarget();
    const dialog = await open(target);
    await act(async () => dialog().patch({ marks: { letters: false, highlights: true } }));
    await act(async () => dialog().exportNow());
    expect(remembered('step').marks).toEqual({ letters: false, highlights: true });
    expect(remembered('folded-figure').marks).toEqual({ letters: true, highlights: true });
    expect(tracked).toContainEqual({
      event: 'paper exported',
      properties: expect.objectContaining({ letters: 'hidden', highlights: 'shown' }),
    });
  });

  it('reports no marks for a target that offers none', async () => {
    const { target } = fakeTarget();
    const dialog = await open(target);
    await act(async () => dialog().exportNow());
    const exported = tracked.find(({ event }) => event === 'paper exported');
    expect(exported?.properties).not.toHaveProperty('letters');
    expect(exported?.properties).not.toHaveProperty('highlights');
  });
});

describe('usePaperExportDialog on a target with several pages', () => {
  it('on This step, offers both scopes and builds and shows only the page on show, on its own crop', async () => {
    const { target, builtPages } = stepsTarget();
    const dialog = await open(target);
    expect(dialog().scopes?.scope).toBe('this');
    expect(dialog().title).toBe('Export turn over');
    expect(dialog().pager).toBeNull();
    expect(builtPages()).toEqual([1]);
    expect(dialog().preview!.page.svg).toBe(paintedFrom(STEP_SCENES[1]!, target, dialog().draft));
    expect(dialog().preview!.page.svg).not.toBe(paintedFrom(onTheSetsCrop(1), target, dialog().draft));
    expect(tracked).toContainEqual({
      event: 'paper export opened',
      properties: { surface: 'references', scope: 'this' },
    });
  });

  it('on This step, saves the one page as a file of its own', async () => {
    const { target } = stepsTarget();
    const dialog = await open(target);
    const previewed = dialog().preview!.page.svg;
    await act(async () => dialog().exportNow());
    expect(service.saveTextFile).toHaveBeenCalledWith(
      expect.objectContaining({ contents: previewed, suggestedName: 'Crane-turn-over.svg' })
    );
    expect(service.saveBinaryFile).not.toHaveBeenCalled();
    const exported = tracked.find(({ event }) => event === 'paper exported');
    expect(exported?.properties).toMatchObject({ scope: 'this' });
    expect(exported?.properties).not.toHaveProperty('page_count_bucket');
  });

  it('on All steps, titles the set, builds every page, and counts the opening with that scope', async () => {
    const { target, builtPages } = stepsTarget();
    const dialog = await open(target, null, 'all');
    expect(dialog().scopes?.scope).toBe('all');
    expect(dialog().title).toBe('Export all steps');
    expect([...builtPages()].sort()).toEqual([0, 1, 2]);
    expect(dialog().pager).toMatchObject({ index: 1, count: 3, label: 'Turn over' });
    expect(dialog().canExport).toBe(true);
    expect(tracked).toContainEqual({
      event: 'paper export opened',
      properties: { surface: 'references', scope: 'all' },
    });
  });

  it('paints every page on one crop, and moving the pager repaints without rebuilding', async () => {
    const { target, buildScene } = stepsTarget();
    const dialog = await open(target, null, 'all');
    const { draft } = dialog();
    expect(dialog().preview!.page.svg).toBe(paintedFrom(onTheSetsCrop(1), target, draft));
    const { widthPt, heightPt } = dialog().preview!.page;

    for (const index of [0, 2]) {
      await act(async () => dialog().pager!.setIndex(index));
      expect(dialog().pager).toMatchObject({ index, label: STEP_PAGES[index]!.label });
      expect(dialog().preview!.page.svg).toBe(paintedFrom(onTheSetsCrop(index), target, draft));
      expect(dialog().preview!.page).toMatchObject({ widthPt, heightPt });
      expect(dialog().canExport).toBe(true);
    }
    expect(buildScene).toHaveBeenCalledTimes(3);
  });

  it('holds the pager to the pages there are', async () => {
    const { target } = stepsTarget();
    const dialog = await open(target, null, 'all');
    await act(async () => dialog().pager!.setIndex(-4));
    expect(dialog().pager!.index).toBe(0);
    await act(async () => dialog().pager!.setIndex(99));
    expect(dialog().pager!.index).toBe(2);
    expect(dialog().pager!.label).toBe('Step 2');
  });

  it('switches between the scopes, building only the pages it has not', async () => {
    const { target, builtPages } = stepsTarget();
    const dialog = await open(target);
    await act(async () => dialog().scopes!.setScope('all'));
    expect(dialog().title).toBe('Export all steps');
    expect(builtPages()).toEqual([1, 0, 2]);
    expect(dialog().pager?.index).toBe(1);
    expect(dialog().preview!.page.svg).toBe(paintedFrom(onTheSetsCrop(1), target, dialog().draft));

    // Back on This step, the page is the one the surface showed, wherever the pager was.
    await act(async () => dialog().pager!.setIndex(2));
    await act(async () => dialog().scopes!.setScope('this'));
    expect(dialog().title).toBe('Export turn over');
    expect(dialog().pager).toBeNull();
    expect(dialog().preview!.page.svg).toBe(paintedFrom(STEP_SCENES[1]!, target, dialog().draft));
    expect(builtPages()).toHaveLength(3);
  });

  it('exports every page as one ZIP painted from the same options, the shown page as previewed', async () => {
    service.saveBinaryFile.mockResolvedValueOnce({ name: 'Crane steps.zip', path: null });
    const { target, paintStyle } = stepsTarget();
    const dialog = await open(target, null, 'all');
    await act(async () => dialog().patch({ paddingMm: 12, background: '#112233' }));
    await act(async () => dialog().pager!.setIndex(2));
    expect(dialog().canExport).toBe(true);
    const { draft } = dialog();
    const previewed = dialog().preview!.page.svg;
    const paintsBefore = paintStyle.mock.calls.length;

    await act(async () => dialog().exportNow());
    // The other two pages are painted; the one on show is the preview's own.
    expect(paintStyle.mock.calls.length - paintsBefore).toBe(STEP_PAGES.length - 1);
    expect(service.saveTextFile).not.toHaveBeenCalled();
    expect(service.saveBinaryFile).toHaveBeenCalledTimes(1);
    const { options, files } = savedZip();
    expect(options).toMatchObject({
      suggestedName: 'Crane-steps.zip',
      extensions: ['zip'],
      mimeType: 'application/zip',
    });
    expect(Object.keys(files)).toEqual(['Crane-step-1.svg', 'Crane-turn-over.svg', 'Crane-step-2.svg']);
    expect(Object.values(files).map((bytes) => strFromU8(bytes))).toEqual(
      STEP_PAGES.map((_, index) => paintedFrom(onTheSetsCrop(index), target, draft))
    );
    expect([...files['Crane-step-2.svg']!]).toEqual([...strToU8(previewed)]);

    expect(remembered('step')).toMatchObject({ paddingMm: 12, background: '#112233' });
    expect(tracked).toContainEqual({
      event: 'paper exported',
      properties: expect.objectContaining({
        surface: 'references',
        format: 'svg',
        scope: 'all',
        page_count_bucket: '<=5',
      }),
    });
    expect(toast.success).toHaveBeenCalledWith('Exported Crane steps.zip');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('counts the pages up as they encode, and holds the dialog open only for the save', async () => {
    const encodes = STEP_PAGES.map(() => deferred<Uint8Array>());
    for (const encode of encodes) encodePng.mockReturnValueOnce(encode.promise);
    const save = deferred<{ name: string; path: null } | null>();
    service.saveBinaryFile.mockReturnValueOnce(save.promise);
    const { target } = stepsTarget();
    const dialog = await open(target, 'png', 'all');
    let saved: Promise<void> = Promise.resolve();
    await act(async () => {
      saved = dialog().exportNow();
    });
    expect(dialog()).toMatchObject({
      saving: true,
      busy: false,
      canExport: false,
      progress: { done: 0, total: 3 },
    });

    for (const [index, encode] of encodes.entries()) {
      expect(encodePng).toHaveBeenCalledTimes(index + 1);
      expect(encodePng).toHaveBeenLastCalledWith(expect.anything(), dialog().draft.pngDpi);
      await act(async () => encode.resolve(new Uint8Array([137, 80, 78, 71, index])));
      expect(dialog().progress).toEqual({ done: index + 1, total: 3 });
      expect(dialog().busy).toBe(index === encodes.length - 1);
    }
    await vi.waitFor(() => expect(service.saveBinaryFile).toHaveBeenCalledTimes(1));
    expect(dialog()).toMatchObject({ saving: true, busy: true });
    expect(Object.values(savedZip().files).map((bytes) => bytes[4])).toEqual([0, 1, 2]);

    await act(async () => {
      save.resolve({ name: 'Crane steps.zip', path: null });
      await saved;
    });
    expect(dialog()).toMatchObject({ saving: false, busy: false, progress: null });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('saves nothing and remembers nothing when the dialog closes while the pages encode', async () => {
    const encode = deferred<Uint8Array>();
    encodePng.mockReturnValueOnce(encode.promise);
    const { target } = stepsTarget();
    const dialog = await open(target, 'png', 'all');
    await act(async () => dialog().patch({ paddingMm: 30 }));
    let saved: Promise<void> = Promise.resolve();
    await act(async () => {
      saved = dialog().exportNow();
    });
    expect(dialog().busy).toBe(false);

    unmount();
    await act(async () => {
      encode.resolve(new Uint8Array([137, 80, 78, 71]));
      await saved;
    });
    expect(encodePng).toHaveBeenCalledTimes(1);
    expect(service.saveBinaryFile).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().paperExport).toEqual(initialSettings.paperExport);
    expect(readString(PAPER_EXPORT_KEY)).toBeNull();
    expect(tracked.some(({ event }) => event === 'paper exported')).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it('offers no scopes on a target with one page, and exports that page alone when asked for all', async () => {
    const { target, builtPages } = stepsTarget([STEP_PAGES[1]!], 0);
    const dialog = await open(target, null, 'all');
    expect(dialog().scopes).toBeNull();
    expect(dialog().pager).toBeNull();
    expect(dialog().title).toBe('Export turn over');
    expect(builtPages()).toEqual([0]);
    expect(tracked).toContainEqual({
      event: 'paper export opened',
      properties: { surface: 'references', scope: 'this' },
    });

    await act(async () => dialog().exportNow());
    expect(service.saveTextFile).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'Crane-turn-over.svg' })
    );
    expect(service.saveBinaryFile).not.toHaveBeenCalled();
    expect(dialog().progress).toBeNull();
  });
});

describe('usePaperExportDialog on a set with a page that draws nothing', () => {
  it('has nothing to export under All steps, and still exports the page on show', async () => {
    const pageless = [STEP_SCENES[0]!, STEP_SCENES[1]!, null];
    const { target } = fakeTarget({
      surface: 'references',
      pages: { list: STEP_PAGES, current: 1, title: 'Export all steps', zipStem: 'Crane steps' },
      buriesFaces: false,
      sceneKey: ({ page, style }) => `${page}|${style.paper.front}`,
      buildScene: vi.fn(async ({ page }: PaperSceneInput) => pageless[page] ?? null),
    });
    const dialog = await open(target, null, 'all');
    expect(dialog().status).toBe('empty');
    expect(dialog().canExport).toBe(false);
    await act(async () => dialog().scopes!.setScope('this'));
    expect(dialog().status).toBe('ready');
    expect(dialog().canExport).toBe(true);
  });
});

describe('usePaperExportDialog on a fixed picture', () => {
  const FIXED_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#abcdef"/></svg>';
  const FIXED_PAGE = { svg: FIXED_SVG, widthPt: 300, heightPt: 225 };

  function fixedTarget() {
    return fakeTarget({
      surface: 'folded-3d',
      fixedPicture: { svg: FIXED_SVG, widthPx: 400, heightPx: 300 },
    });
  }

  it('builds no scene, and previews the picture as it is at its own size', async () => {
    const { target, buildScene } = fixedTarget();
    const dialog = await open(target);
    expect(buildScene).not.toHaveBeenCalled();
    expect(dialog()).toMatchObject({ status: 'ready', fixed: true, canExport: true });
    expect(dialog().preview!.page).toEqual(FIXED_PAGE);
    expect(dialog().pngSize).toEqual({ width: 400, height: 300 });
  });

  it('changes nothing for a style or page option, which the picture cannot take', async () => {
    const { target, buildScene } = fixedTarget();
    const dialog = await open(target);
    const shown = dialog().preview;
    await act(async () => dialog().patch({ style: 'builtin:diagram', paddingMm: 20, background: '#112233' }));
    expect(buildScene).not.toHaveBeenCalled();
    expect(dialog().preview).toBe(shown);
    expect(dialog().canExport).toBe(true);
  });

  it('sizes the PNG at the picture’s own pixels, whatever the density', async () => {
    const { target } = fixedTarget();
    const dialog = await open(target, 'png');
    for (const pngDpi of [72, 300, 1200]) {
      await act(async () => dialog().patch({ pngDpi }));
      expect(dialog().pngSize).toEqual({ width: 400, height: 300 });
      expect(dialog().pngTooLarge).toBe(false);
      expect(dialog().canExport).toBe(true);
    }
  });

  it('saves the SVG exactly as the picture is', async () => {
    const { target } = fixedTarget();
    const dialog = await open(target);
    await act(async () => dialog().exportNow());
    expect(service.saveTextFile).toHaveBeenCalledWith(
      expect.objectContaining({ contents: FIXED_SVG, suggestedName: 'Crane-folded.svg' })
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rasterises the PNG at 96 dpi, where a CSS px is a pixel', async () => {
    const { target } = fixedTarget();
    const dialog = await open(target, 'png');
    await act(async () => dialog().patch({ pngDpi: 600 }));
    await act(async () => dialog().exportNow());
    expect(encodePng).toHaveBeenCalledTimes(1);
    expect(encodePng).toHaveBeenCalledWith(FIXED_PAGE, 96);
    expect(service.saveBinaryFile).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'Crane-folded.png', mimeType: 'image/png' })
    );
    // The density the file was written at, not the one the draft remembers.
    expect(tracked).toContainEqual({
      event: 'paper exported',
      properties: expect.objectContaining({ format: 'png', resolution: '1x' }),
    });
  });
});
