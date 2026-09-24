import { act, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperScene } from '../lib/paper/paperScene';
import { DEFAULT_PAPER_STYLE, type PaperStyle } from '../lib/paper/paperStyle';
import { builtInPaperPreset } from '../lib/paper/paperPresets';
import { DEFAULT_PAPER_EXPORT_SETTINGS, type PaperExportSettings } from '../lib/paperExportSettings';
import { paperPngSize } from '../lib/paper/paperPng';
import { paperPresetRows } from '../lib/paperPresetRows';
import { readJson, readString, removeKey, STORAGE_KEYS, storageKey } from '../lib/storage';
import type { FileService } from '../platform/fileService';
import type { PaperExportRequest } from '../store/paperExportUiStore';
import { useSettingsStore } from '../store/settingsStore';
import { paintPaperExport, paperExportPage, paperExportStyle } from './paperExportSession';
import type { PaperExportTarget, PaperSceneInput } from './paperExportTarget';
import { usePaperExportDialog, type PaperExportDialogBinding } from './usePaperExportDialog';

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
    saveBinaryFile: vi.fn(async () => ({ name: 'Crane step 3.png', path: null })),
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

/** The page `scene` paints to under these options, as the dialog would paint it. */
function paintedFrom(scene: PaperScene, target: PaperExportTarget, draft: PaperExportSettings): string {
  const rows = paperPresetRows(useSettingsStore.getState().paperStyle.presets);
  const style = paperExportStyle(target, draft.style, rows);
  return paintPaperExport(target, scene, style, paperExportPage(target, draft)).svg;
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

async function open(target: PaperExportTarget, format: PaperExportRequest['format'] = null) {
  await act(async () => {
    root?.render(<Probe request={{ id: 1, target, format, returnFocus: null }} />);
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

describe('usePaperExportDialog', () => {
  it('opens on the remembered options, on the verb’s format, and counts the opening', async () => {
    useSettingsStore.setState({
      paperExport: { ...DEFAULT_PAPER_EXPORT_SETTINGS, format: 'svg', paddingMm: 8 },
    });
    const { target } = fakeTarget();
    const dialog = await open(target, 'png');
    expect(dialog().draft).toMatchObject({ format: 'png', paddingMm: 8 });
    expect(tracked).toContainEqual({ event: 'paper export opened', properties: { surface: 'folded-flat' } });
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
    expect(useSettingsStore.getState().paperExport.paddingMm).toBe(12);
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
    expect(useSettingsStore.getState().paperExport.paddingMm).toBe(DEFAULT_PAPER_EXPORT_SETTINGS.paddingMm);
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
    expect(useSettingsStore.getState().paperExport).toMatchObject({ format: 'png', style: 'builtin:diagram' });
    expect(readJson(PAPER_EXPORT_KEY, null)).toMatchObject({ format: 'png', style: 'builtin:diagram' });

    unmount();
    root = createRoot(container!);
    const reopened = await open(target);
    expect(reopened().draft).toMatchObject({ format: 'png', style: 'builtin:diagram' });
  });

  it('opens a remembered preset that no longer exists as the export style, and remembers that', async () => {
    useSettingsStore.setState({ paperExport: { ...DEFAULT_PAPER_EXPORT_SETTINGS, style: 'user:Gone' } });
    const { target } = fakeTarget();
    const dialog = await open(target);
    expect(dialog().draft.style).toBe('export-style');
    await act(async () => dialog().exportNow());
    expect(useSettingsStore.getState().paperExport.style).toBe('export-style');
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
          <Probe request={{ id: 1, target, format: null, returnFocus: null }} />
        </StrictMode>
      );
    });
    expect(tracked.filter(({ event }) => event === 'paper export opened')).toHaveLength(1);
  });
});
