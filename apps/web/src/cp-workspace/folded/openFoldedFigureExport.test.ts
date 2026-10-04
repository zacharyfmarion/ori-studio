import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OristudioCpFolded3dAuxLines,
  OristudioCpFolded3dRenderModel,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldedRenderSnapshot,
} from '../../engine/oristudioCpTypes';
import { IDENTITY_FOLDED_PLACEMENT } from '../../engine/oristudioCpTypes';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import {
  DEFAULT_PAPER_EXPORT_SETTINGS,
  PAPER_EXPORT_STYLE_SLOT,
  type PaperExportSettings,
  type PaperExportStyleChoice,
} from '../../lib/paperExportSettings';
import { paperPresetRows } from '../../lib/paperPresetRows';
import { exportPaperStyle } from '../../lib/paperStyleSettings';
import {
  paintPaperExport,
  paperExportPage,
  paperExportSceneInput,
  paperExportStyle,
} from '../../paperExport/paperExportSession';
import type { PaperExportTarget } from '../../paperExport/paperExportTarget';
import { usePaperExportUiStore } from '../../store/paperExportUiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { resetFolded3dAuxLinesSync } from '../../store/workspaceStore/folded3dAuxLinesSync';
import { cpOverlayViewStore } from '../cpOverlayViewStore';
import { resetFolded3dAuxLines, setFolded3dAuxLines } from './folded3dAuxLines';
import { DEFAULT_FOLDED_3D_CAMERA, folded3dFrameRadius } from './folded3dCamera';
import { resetFolded3dRenderModels, setFolded3dRenderModel } from './folded3dRenderModels';
import { folded3dFigureScene, folded3dStoredSceneInCssPx } from './folded3dStoredScene';
import { foldedFigureExportDocument } from './foldedFigureExport';
import { foldedFlatFigureScenePxPerUnit } from './foldedFlatFigureExport';
import { resetFoldedModelWriteQueueForTests } from './foldedModelWriteQueue';
import { foldedFigureCssPerUserUnit, openFoldedFigureExport } from './openFoldedFigureExport';

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('sonner', () => ({ toast }));

// The kernel lives in a worker; the scene it would answer with is hand-built
// in its own shape, and which handles it was asked for is part of the test.
const kernel = vi.hoisted(() => ({
  paperScene: vi.fn(async (_handle: number, _document?: number | null): Promise<unknown> => null),
}));
vi.mock('../../store/workspaceStore/oristudioCpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/workspaceStore/oristudioCpRuntime')>();
  return { ...actual, getOristudioCpFoldedFigurePaperScene: kernel.paperScene };
});

const auxSync = vi.hoisted(() => ({
  settled: vi.fn<(store: unknown, handle: number | null | undefined) => Promise<void>>(),
}));
vi.mock('../../store/workspaceStore/folded3dAuxLinesSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/workspaceStore/folded3dAuxLinesSync')>();
  auxSync.settled.mockImplementation(actual.folded3dAuxLinesSettled as typeof auxSync.settled);
  return { ...actual, folded3dAuxLinesSettled: auxSync.settled };
});

type Entry = OristudioCpFoldedFigureEntry;

const t = ((_key: string, fallback: string, options?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name]))) as unknown as TFunction;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const RENDER_MODEL: OristudioCpFolded3dRenderModel = JSON.parse(
  readFileSync(join(FIXTURES, 'hinge_90.rendermodel.json'), 'utf8')
);
const SPATIAL_HANDLE = 5;
const FLAT_HANDLE = 9;

/** Colours that already mirror the default style, so the paper mirror has nothing to write. */
const MODEL: OristudioCpFoldedFigureModel = {
  front_color: { red: 255, green: 255, blue: 50 },
  back_color: { red: 233, green: 233, blue: 233 },
  line_color: { red: 0, green: 0, blue: 0 },
  scale: 1,
  rotation: 0,
  anti_alias: true,
  display_shadows: false,
  state: 'Front0',
  folded_cases: 1,
  transparent_transparency: 16,
  transparency_color: false,
};

const TOLERANCES = {
  angle_radians: 1e-7,
  distance_relative: 1e-6,
  flat_snap_degrees: 1e-6,
  overlap_area_relative: 1e-9,
};

const UNLIT = { ...DEFAULT_PAPER_STYLE.light, enabled: false };

/** A 3D figure as the fold leaves it: the window's scene stored, the frame recorded. */
function spatial(overrides: Partial<Entry> = {}): Entry {
  const folded3d = { model: MODEL, diagnostics: { tolerances: TOLERANCES } } as unknown as NonNullable<
    Entry['folded3d']
  >;
  const base = {
    id: 'spatial-1',
    title: 'Folded model 1',
    handle: SPATIAL_HANDLE,
    sourceKind: 'generated-3d',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: null,
    folded3d,
    renderSnapshot: null,
    placement: IDENTITY_FOLDED_PLACEMENT,
    camera: DEFAULT_FOLDED_3D_CAMERA,
    frameRadius: folded3dFrameRadius(RENDER_MODEL),
    error: null,
  } as Entry;
  return {
    ...base,
    scene: folded3dFigureScene(base, RENDER_MODEL, { style: DEFAULT_PAPER_STYLE, space: 'document' }),
    ...overrides,
  };
}

/** A 3D figure's picture as a file from before it stored a scene: one filled square. */
const LEGACY_SNAPSHOT = {
  schema_version: 1,
  fixture: null,
  pass: null,
  primitives: [
    {
      sequence: 0,
      kind: 'fill_polygon',
      style: {
        paint: { kind: 'color', color: { red: 255, green: 255, blue: 50, alpha: 255 } },
        stroke: { kind: 'none' },
        antialias: 'default',
      },
      geometry: {
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      },
    },
  ],
} as unknown as OristudioCpFoldedRenderSnapshot;

/** The hinge with one aux line on face 0, from the paper's edge to the fold. */
const AUX_LINES: OristudioCpFolded3dAuxLines = { faces: [0], points: [200, 0, 0, 0, 0, 0] };

/**
 * A sheet folded in half: face 0 (the left half, turned over) lies on face 1.
 * Both land on the same 200-unit square, so the whole picture is one subface
 * whose stack is `[0, 1]`; face 1 is buried.
 */
function kernelScene(): OristudioCpFoldedPaperScene {
  const square = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 200 },
    { x: 0, y: 200 },
  ];
  const edges = (kinds: Array<'border' | 'fold'>) =>
    square.map((from, index) => ({ from, to: square[(index + 1) % 4]!, kind: kinds[index]! }));
  return {
    schema_version: 2,
    flipped: false,
    sheet: 400,
    faces: [
      { outline: square, points: [0, 1, 2, 3], front_up: false, edges: edges(['border', 'fold', 'border', 'border']) },
      { outline: square, points: [4, 1, 2, 5], front_up: true, edges: edges(['border', 'fold', 'border', 'border']) },
    ],
    subfaces: [{ polygon: square, faces_top_to_bottom: [0, 1] }],
    aux_lines: [],
  };
}

/** The drawer's picture of the same fold, as the canvas keeps it. */
function renderSnapshot(): OristudioCpFoldedRenderSnapshot {
  return {
    schema_version: 1,
    fixture: null,
    pass: null,
    primitives: [
      {
        sequence: 0,
        kind: 'fill_polygon',
        style: {
          paint: { kind: 'color', color: { red: 233, green: 233, blue: 233, alpha: 255 } },
          stroke: { kind: 'none' },
          antialias: 'default',
        },
        geometry: {
          kind: 'polygon',
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 200 },
            { x: 0, y: 200 },
          ],
        },
      },
    ],
  };
}

/** A flat figure as the fold leaves it: a live handle, the drawer's picture stored. */
function flat(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'flat-1',
    title: 'Folded model 1',
    handle: FLAT_HANDLE,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: {
      model: MODEL,
      display_style: 'Paper5',
      discovered_fold_cases: 1,
      outcome: 'Solved',
    } as unknown as NonNullable<Entry['snapshot']>,
    folded3d: null,
    renderSnapshot: renderSnapshot(),
    placement: IDENTITY_FOLDED_PLACEMENT,
    camera: null,
    frameRadius: null,
    error: null,
    ...overrides,
  };
}

/** The overlay view of a canvas at 100%: one CSS px per user unit, the box as with no canvas. */
const UNIT_VIEW = { origin: [0, 0], ex: [1, 0], ey: [0, 1] } as const;

function setFigures(...figures: Entry[]): void {
  useWorkspaceStore.setState({ oristudioCpFoldedFigures: figures });
}

/** A distinctive export style, set apart from display; unlit, so a fill is the paper colour exactly. */
function setExportStyle(): void {
  useSettingsStore.setState({
    paperStyle: {
      ...useSettingsStore.getState().paperStyle,
      export: {
        ...DEFAULT_PAPER_STYLE,
        paper: { front: '#123456', back: '#654321' },
        edges: { ...DEFAULT_PAPER_STYLE.edges, color: '#0000ff' },
        light: UNLIT,
      },
    },
  });
}

async function open(figureId: string): Promise<PaperExportTarget | null> {
  await openFoldedFigureExport(figureId, t);
  return usePaperExportUiStore.getState().request?.target ?? null;
}

async function openTarget(figureId: string): Promise<PaperExportTarget> {
  const target = await open(figureId);
  if (!target) throw new Error('the dialog did not open');
  return target;
}

const rows = paperPresetRows([]);

/** The scene the dialog builds first: the export style, on the default page. */
function firstScene(target: PaperExportTarget) {
  return target.buildScene(paperExportSceneInput(target, target.exportStyle, DEFAULT_PAPER_EXPORT_SETTINGS));
}

/** The page the dialog paints for these options: its style, its scene, its page. */
async function paint(
  target: PaperExportTarget,
  choice: PaperExportStyleChoice = PAPER_EXPORT_STYLE_SLOT,
  options: PaperExportSettings = DEFAULT_PAPER_EXPORT_SETTINGS
): Promise<string> {
  const style = paperExportStyle(target, choice, rows);
  const scene = await target.buildScene(paperExportSceneInput(target, style, options));
  if (!scene) throw new Error('the target built no scene');
  return paintPaperExport(target, scene, style, paperExportPage(target, options)).svg;
}

/**
 * The width the dialog's first scene is built at, in its own px: the CSS px
 * the figure covers on the canvas. The page is the size asked for whatever
 * this is; the scene's px are what a pen is measured against while building.
 */
async function sceneWidthPx(target: PaperExportTarget): Promise<number> {
  const scene = await firstScene(target);
  if (!scene) throw new Error('the target built no scene');
  return scene.bounds.maxX - scene.bounds.minX;
}

/** Every face's fill in the page, back to front: each face is one `<path>`. */
function faceFills(svg: string): string[] {
  return [...svg.matchAll(/<path\s[^>]*?fill="([^"]*)"[^>]*\/>/g)].map((match) => match[1]!);
}

beforeEach(() => {
  toast.error.mockClear();
  toast.success.mockClear();
  kernel.paperScene.mockClear();
  kernel.paperScene.mockImplementation(async () => kernelScene());
  auxSync.settled.mockClear();
  resetFoldedModelWriteQueueForTests();
  resetFolded3dRenderModels();
  resetFolded3dAuxLines();
  resetFolded3dAuxLinesSync();
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  usePaperExportUiStore.setState({ request: null });
  setFolded3dRenderModel(SPATIAL_HANDLE, RENDER_MODEL);
  useWorkspaceStore.setState({
    workspaceTitle: 'Crane',
    oristudioCpFoldedFigures: [spatial(), flat()],
    // The paper mirror answers a pinned colour with a kernel write; there is
    // no kernel here, and the export reads the style, not the model.
    updateOristudioCpFoldedFigureModel: vi.fn(async () => true) as never,
  });
});

afterEach(() => {
  usePaperExportUiStore.setState({ request: null });
  resetFoldedModelWriteQueueForTests();
  resetFolded3dRenderModels();
  resetFolded3dAuxLines();
  resetFolded3dAuxLinesSync();
  // The store takes no null; a unit view is the unmounted scale.
  cpOverlayViewStore.set({ model: UNIT_VIEW, user: UNIT_VIEW });
});

describe('opening the export of a 3D folded figure with a live kernel', () => {
  it('opens the dialog on this figure, named for it, on the remembered format', async () => {
    const appearance = { 'paper.front': '#ff00ff' };
    setFigures(spatial({ appearance }));

    await openFoldedFigureExport('spatial-1', t);

    const request = usePaperExportUiStore.getState().request;
    expect(request?.scope).toBe('this');
    expect(request?.format).toBeNull();
    const target = request!.target;
    expect(target.surface).toBe('folded-3d');
    expect(target.title).toBe('Export Folded model 1');
    expect(target.fileStem).toBe('Crane Folded model 1');
    expect(target.pages).toBeNull();
    expect(target.pins).toEqual(appearance);
    expect(target.exportStyle).toEqual(exportPaperStyle(useSettingsStore.getState().paperStyle, appearance));
    expect(target.buriesFaces).toBe(true);
    expect(target.fixedPicture ?? null).toBeNull();
    expect(target.hint ?? null).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
    // The kernel's flat paper scene is a flat figure's; a 3D one never asks for it.
    expect(kernel.paperScene).not.toHaveBeenCalled();
  });

  it('pins nothing for a figure with no style of its own', async () => {
    const target = await openTarget('spatial-1');

    expect(target.pins).toBeNull();
    expect(target.exportStyle).toEqual(exportPaperStyle(useSettingsStore.getState().paperStyle));
  });

  it('paints the window’s scene with the export style, on the painter’s page', async () => {
    setExportStyle();

    const svg = await paint(await openTarget('spatial-1'));

    // The painter's page, in points, not the stored snapshot's 1024 px document.
    expect(svg).toMatch(/<svg[^>]* width="[\d.]+pt"/);
    expect(svg).not.toContain('aria-label="Folded figure"');
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('stroke="#0000ff"');
  });

  it('lays the figure’s own pins over the export style, and over a picked preset', async () => {
    setExportStyle();
    setFigures(spatial({ appearance: { 'paper.front': '#ff00ff', light: UNLIT } }));
    const target = await openTarget('spatial-1');

    const exportSlot = await paint(target);
    expect(exportSlot).toContain('fill="#ff00ff"');
    expect(exportSlot).not.toContain('fill="#123456"');
    expect(exportSlot).toContain('stroke="#0000ff"');

    // The diagram preset brings its own ink; the pinned paper stays.
    const diagram = await paint(target, 'builtin:diagram');
    expect(diagram).toContain('fill="#ff00ff"');
    expect(diagram).toContain('stroke="#231f20"');
    expect(diagram).not.toContain('stroke="#0000ff"');
  });

  it('builds the scene at the figure’s on-screen box at the mounted canvas', async () => {
    // Read from the live user-space affine the canvas publishes. A canvas at
    // 200% doubles the box, so the scene is twice as wide.
    const atUnit = await sceneWidthPx(await openTarget('spatial-1'));
    // Folded figures are drawn in user space; the model affine is set apart
    // so reading the wrong one shows.
    cpOverlayViewStore.set({
      model: { origin: [40, 40], ex: [3, 0], ey: [0, 3] },
      user: { origin: [40, 40], ex: [2, 0], ey: [0, 2] },
    });
    expect(foldedFigureCssPerUserUnit()).toBe(2);
    const atDouble = await sceneWidthPx(await openTarget('spatial-1'));

    expect(atUnit).toBeGreaterThan(0);
    expect(atDouble / atUnit).toBeCloseTo(2, 3);
  });

  it('keeps the canvas scale it was opened at, however the canvas zooms while it is open', async () => {
    const target = await openTarget('spatial-1');
    const atOpen = await sceneWidthPx(target);

    cpOverlayViewStore.set({ model: UNIT_VIEW, user: { origin: [0, 0], ex: [2, 0], ey: [0, 2] } });

    expect(await sceneWidthPx(target)).toBeCloseTo(atOpen, 6);
  });

  it('waits for the figure’s aux lines to settle, and paints the ones that landed', async () => {
    let settle!: () => void;
    auxSync.settled.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        })
    );

    const opening = openFoldedFigureExport('spatial-1', t);
    await Promise.resolve();
    expect(auxSync.settled).toHaveBeenCalledWith(useWorkspaceStore, SPATIAL_HANDLE);
    expect(usePaperExportUiStore.getState().request).toBeNull();

    // An aux line drawn a moment ago lands while the export waits for it.
    setFolded3dAuxLines(SPATIAL_HANDLE, 'drawn', AUX_LINES);
    settle();
    await opening;

    const target = usePaperExportUiStore.getState().request!.target;
    const style = target.exportStyle;
    const scene = await firstScene(target);
    const figure = spatial();
    const withAux = folded3dFigureScene(figure, RENDER_MODEL, {
      style,
      space: 1,
      markHidden: false,
      aux: AUX_LINES,
    });
    expect(scene).toEqual(withAux);
    expect(scene?.items.some((item) => item.kind === 'line' && item.role === 'aux')).toBe(true);
    expect(scene).not.toEqual(
      folded3dFigureScene(figure, RENDER_MODEL, { style, space: 1, markHidden: false, aux: null })
    );
  });
});

describe('opening the export of a 3D folded figure without a kernel', () => {
  const STORED_HINT = 'Shaded as it was when it was folded: fold it again to light it in another style.';

  it('repaints the stored scene, carried into the canvas’s px, and says it cannot be re-lit', async () => {
    // Reopened from a file: no handle, so no render model and no fresh scene.
    const placement = { ...IDENTITY_FOLDED_PLACEMENT, scale: 2 };
    setFigures(spatial({ placement, handle: null }));
    cpOverlayViewStore.set({ model: UNIT_VIEW, user: { origin: [0, 0], ex: [3, 0], ey: [0, 3] } });

    const target = await openTarget('spatial-1');

    expect(target.surface).toBe('folded-3d');
    expect(target.hint).toBe(STORED_HINT);
    expect(target.fixedPicture ?? null).toBeNull();
    expect(auxSync.settled).toHaveBeenCalledWith(useWorkspaceStore, null);
    const stored = spatial({ placement }).scene!;
    const scene = await firstScene(target);
    expect(scene).toEqual(folded3dStoredSceneInCssPx(stored, placement, 3));
    expect(scene).not.toEqual(stored);
    const svg = await paint(target);
    expect(svg).toMatch(/<svg[^>]* width="[\d.]+pt"/);
    expect(svg).not.toContain('aria-label="Folded figure"');
    expect(kernel.paperScene).not.toHaveBeenCalled();
  });

  it('builds the stored picture at the size the live path would have given it', async () => {
    // One figure is one scene, whether or not it has been rehydrated: the
    // stored one is brought into the CSS px the live build measures its pens
    // in (`folded3dStoredSceneInCssPx`).
    const placement = { ...IDENTITY_FOLDED_PLACEMENT, scale: 2 };
    cpOverlayViewStore.set({ model: UNIT_VIEW, user: { origin: [0, 0], ex: [3, 0], ey: [0, 3] } });
    setFigures(spatial({ placement }));
    const live = await sceneWidthPx(await openTarget('spatial-1'));
    setFigures(spatial({ placement, handle: null }));
    const stored = await sceneWidthPx(await openTarget('spatial-1'));

    expect(live).toBeGreaterThan(0);
    expect(stored / live).toBeCloseTo(1, 3);
  });

  it('takes the same path when the handle has no render model behind it', async () => {
    resetFolded3dRenderModels();

    const target = await openTarget('spatial-1');

    expect(target.hint).toBe(STORED_HINT);
    expect(await paint(target)).toMatch(/<svg[^>]* width="[\d.]+pt"/);
  });

  it('opens the stored snapshot as a fixed picture when an older file carries no scene', async () => {
    // Written before a 3D figure stored a scene: the entry has the primitive
    // stream and nothing else, which exports as it was drawn.
    setFigures(spatial({ handle: null, scene: null, renderSnapshot: LEGACY_SNAPSHOT }));

    const target = await openTarget('spatial-1');

    const document = foldedFigureExportDocument(LEGACY_SNAPSHOT)!;
    expect(target.surface).toBe('folded-3d');
    expect(target.fixedPicture).toEqual({
      svg: document.svg,
      widthPx: document.width,
      heightPx: document.height,
    });
    expect(target.fixedPicture?.svg).toContain('aria-label="Folded figure"');
    expect(target.buriesFaces).toBe(false);
    expect(await firstScene(target)).toBeNull();
  });
});

describe('opening the export of a flat folded figure', () => {
  it('asks the kernel for the figure’s scene against the document’s aux lines', async () => {
    const target = await openTarget('flat-1');

    // No document open: the kernel uses the aux lines the fold captured.
    expect(kernel.paperScene).toHaveBeenCalledWith(FLAT_HANDLE, null);
    expect(target.surface).toBe('folded-flat');
    expect(target.title).toBe('Export Folded model 1');
    expect(target.fileStem).toBe('Crane Folded model 1');
    expect(target.buriesFaces).toBe(true);
    expect(target.fixedPicture ?? null).toBeNull();

    kernel.paperScene.mockClear();
    useWorkspaceStore.setState({ oristudioCpDocument: { handle: 3 } as never });
    await open('flat-1');
    expect(kernel.paperScene).toHaveBeenCalledWith(FLAT_HANDLE, 3);
  });

  it('never waits on a 3D figure’s aux lines', async () => {
    await open('flat-1');

    expect(auxSync.settled).not.toHaveBeenCalled();
  });

  it('paints every layer of the kernel’s scene with the export style', async () => {
    setExportStyle();

    const svg = await paint(await openTarget('flat-1'));

    expect(svg).toMatch(/<svg[^>]* width="[\d.]+pt"/);
    expect(svg).not.toContain('aria-label="Folded figure"');
    // Back to front: the buried face 1 (front up) under face 0 (turned over,
    // so the back of the paper).
    expect(faceFills(svg)).toEqual(['#123456', '#654321']);
    expect(svg).toContain('stroke="#0000ff"');
  });

  it('lays the figure’s own pins over the export style', async () => {
    setExportStyle();
    const appearance = { 'paper.back': '#ff00ff' };
    setFigures(flat({ appearance }));

    const target = await openTarget('flat-1');

    expect(target.pins).toEqual(appearance);
    expect(faceFills(await paint(target))).toEqual(['#123456', '#ff00ff']);
  });

  it('drops the buried layer only when the page does', async () => {
    const target = await openTarget('flat-1');

    expect(faceFills(await paint(target))).toHaveLength(2);
    const dropping = { ...DEFAULT_PAPER_EXPORT_SETTINGS, keepHiddenFaces: false };
    expect(faceFills(await paint(target, PAPER_EXPORT_STYLE_SLOT, dropping))).toHaveLength(1);
  });

  it('builds the scene at the figure’s on-screen size: its placement at the mounted canvas', async () => {
    const atUnit = await sceneWidthPx(await openTarget('flat-1'));
    expect(atUnit).toBeCloseTo(200 * foldedFlatFigureScenePxPerUnit(flat()), 1);

    cpOverlayViewStore.set({
      model: { origin: [40, 40], ex: [3, 0], ey: [0, 3] },
      user: { origin: [40, 40], ex: [2, 0], ey: [0, 2] },
    });
    expect((await sceneWidthPx(await openTarget('flat-1'))) / atUnit).toBeCloseTo(2, 3);

    cpOverlayViewStore.set({ model: UNIT_VIEW, user: UNIT_VIEW });
    setFigures(flat({ placement: { ...IDENTITY_FOLDED_PLACEMENT, scale: 3, rotation: 1 } }));
    expect((await sceneWidthPx(await openTarget('flat-1'))) / atUnit).toBeCloseTo(3, 3);
  });

  const unsolved = flat({
    displayStyle: 'Transparent3',
    snapshot: {
      ...flat().snapshot!,
      display_style: 'Transparent3',
      outcome: 'Contradiction',
      contradiction: { upper_face: 1, lower_face: 3 },
    } as unknown as NonNullable<Entry['snapshot']>,
  });

  it.each([
    ['with no handle', flat({ handle: null })],
    ['in a wireframe, whose picture is not the paper scene', flat({ displayStyle: 'Wire2' })],
    // A fold the kernel could not order has no `Paper5` picture, and asking
    // would repeat the failed search.
    ['with no layer ordering', unsolved],
  ])('opens the stored picture, without asking the kernel, for a figure %s', async (_label, figure) => {
    setFigures(figure);
    kernel.paperScene.mockRejectedValue(new Error('fold_contradiction'));

    const target = await openTarget('flat-1');

    expect(kernel.paperScene).not.toHaveBeenCalled();
    expect(target.surface).toBe('folded-flat');
    expect(target.fixedPicture?.svg).toContain('aria-label="Folded figure"');
    expect(target.buriesFaces).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each([
    ['no paper picture', null],
    ['a picture with no faces', { ...kernelScene(), faces: [], subfaces: [] }],
  ])('opens the stored picture when the kernel answers %s', async (_label, answer) => {
    kernel.paperScene.mockResolvedValueOnce(answer);

    const target = await openTarget('flat-1');

    expect(kernel.paperScene).toHaveBeenCalledWith(FLAT_HANDLE, null);
    const document = foldedFigureExportDocument(renderSnapshot())!;
    expect(target.fixedPicture).toEqual({
      svg: document.svg,
      widthPx: document.width,
      heightPx: document.height,
    });
  });
});

describe('opening the export of a folded figure that cannot give a picture', () => {
  it.each([
    ['3D', spatial({ id: 'empty', handle: null, scene: null, renderSnapshot: null })],
    ['flat', flat({ id: 'empty', handle: null, renderSnapshot: null })],
  ])('says a %s figure with no picture has nothing to export, and opens nothing', async (_label, figure) => {
    setFigures(figure);

    await openFoldedFigureExport('empty', t);

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('This folded model has nothing to export yet');
    expect(usePaperExportUiStore.getState().request).toBeNull();
  });

  it('does nothing for a figure that is not there', async () => {
    await openFoldedFigureExport('missing', t);

    expect(toast.error).not.toHaveBeenCalled();
    expect(kernel.paperScene).not.toHaveBeenCalled();
    expect(auxSync.settled).not.toHaveBeenCalled();
    expect(usePaperExportUiStore.getState().request).toBeNull();
  });

  it('says the export failed, and opens nothing, when the kernel fails', async () => {
    kernel.paperScene.mockRejectedValueOnce(new Error('kernel lost'));

    await openFoldedFigureExport('flat-1', t);

    expect(toast.error).toHaveBeenCalledWith('Could not export this folded model', {
      description: 'kernel lost',
    });
    expect(usePaperExportUiStore.getState().request).toBeNull();
  });
});

describe('where focus goes back to', () => {
  it('is what held focus when the verb ran, though focus moves while the capture waits', async () => {
    const opener = document.createElement('button');
    const elsewhere = document.createElement('button');
    document.body.append(opener, elsewhere);
    opener.focus();
    let answer!: (scene: OristudioCpFoldedPaperScene) => void;
    kernel.paperScene.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );

    const opening = openFoldedFigureExport('flat-1', t);
    elsewhere.focus();
    answer(kernelScene());
    await opening;

    expect(document.activeElement).toBe(elsewhere);
    expect(usePaperExportUiStore.getState().request?.returnFocus).toBe(opener);
    opener.remove();
    elsewhere.remove();
  });
});
