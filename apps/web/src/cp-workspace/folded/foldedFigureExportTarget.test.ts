import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  OristudioCpFolded3dRenderModel,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldedRenderSnapshot,
} from '../../engine/oristudioCpTypes';
import { IDENTITY_FOLDED_PLACEMENT } from '../../engine/oristudioCpTypes';
import { DEFAULT_PAPER_SIZE_MM } from '../../lib/paper/paperPage';
import { DEFAULT_PAPER_STYLE, type PaperStyle } from '../../lib/paper/paperStyle';
import { PT_PER_MM } from '../../lib/paper/paperSvg';
import { PAPER_STYLE_POLICIES, surfacePaperStyle } from '../../lib/paper/paperStyleResolve';
import {
  DEFAULT_PAPER_EXPORT_SETTINGS,
  type PaperExportSettings,
} from '../../lib/paperExportSettings';
import { paperPresetRows } from '../../lib/paperPresetRows';
import { DEFAULT_PAPER_STYLE_SETTINGS, exportPaperStyle } from '../../lib/paperStyleSettings';
import {
  createPaperExportSession,
  paintPaperExport,
  paperExportPage,
  paperExportSceneInput,
  paperExportStyle,
} from '../../paperExport/paperExportSession';
import type { PaperSceneInput } from '../../paperExport/paperExportTarget';
import { paperExportDraft } from '../../paperExport/usePaperExportDialog';
import golden from './__fixtures__/foldedFigureExportGolden.json';
import { DEFAULT_FOLDED_3D_CAMERA, folded3dFrameRadius } from './folded3dCamera';
import { FOLDED_3D_MESH_VERTEX_BUDGET } from './folded3dMesh';
import { folded3dFigureScene } from './folded3dStoredScene';
import { foldedFigureExportDocument } from './foldedFigureExport';
import {
  foldedFigureExportPicture,
  foldedFigureExportTarget,
  type FoldedFigureExportPicture,
} from './foldedFigureExportTarget';
import { foldedFlatFigureExportsScene } from './foldedFlatFigureExport';

/**
 * The export dialog must write, for a folded figure, byte for byte the page
 * the store's direct export wrote before the dialog existed.
 *
 * The golden pages were written by `exportOristudioCpFoldedFigure('svg', …)`
 * as it stood before Phase 7 of `implementation-plans/paper-export-dialog.md`,
 * on these figures, with the settings store at its defaults and no canvas
 * mounted, and are compared here with the dialog's own path: the capture, the
 * draft, the style it resolves, the session's scene, and the paint.
 *
 * The custom pages were repainted when a figure's size came to measure the
 * figure rather than the sheet it was folded from: at 120 mm the drawing's
 * longer side is now 120 mm, where the unfolded sheet used to be. The default
 * pages were repainted when "as shown" went, and every page became a size in
 * mm: they are 50 mm across. Only the scale moved on either; everything drawn
 * is still the direct export's. The 3D pages were repainted again when a
 * mesh's line pieces came to join where they meet — drawn round at a link
 * rather than butt-ended — and that is all that changed on them. Every live
 * page was repainted when a face became a `<path>` rather than a `<polygon>`,
 * and a flat figure's whole face came to stroke its own outline: its polygon
 * and the lines along its edges are one path in the edge pen, and nothing
 * else moved (`implementation-plans/editable-face-paths.md`).
 */

type Entry = OristudioCpFoldedFigureEntry;
type LivePicture = Extract<FoldedFigureExportPicture, { kind: 'live-3d' }>;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const RENDER_MODEL: OristudioCpFolded3dRenderModel = JSON.parse(
  readFileSync(join(FIXTURES, 'hinge_90.rendermodel.json'), 'utf8')
);

/** Colours that already mirror the default style. */
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

/** A 3D figure as the fold leaves it: the window's scene stored, the frame recorded. */
function spatial(overrides: Partial<Entry> = {}): Entry {
  const folded3d = { model: MODEL, diagnostics: { tolerances: TOLERANCES } } as unknown as NonNullable<
    Entry['folded3d']
  >;
  const base = {
    id: 'spatial-1',
    title: 'Folded model 1',
    handle: 5,
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
    sheet_points: [],
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
    handle: 9,
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

interface Runtime {
  model?: OristudioCpFolded3dRenderModel | null;
  kernel?: OristudioCpFoldedPaperScene | null;
  cssPerUserUnit?: number;
}

function pictureOf(figure: Entry, { model = null, kernel = null, cssPerUserUnit = 1 }: Runtime = {}) {
  return foldedFigureExportPicture(figure, { model, aux: null, kernel, cssPerUserUnit });
}

/** The kernel's paper scene only where the verb would fetch one, as it captures a flat figure. */
const captured = (figure: Entry) => (foldedFlatFigureExportsScene(figure) ? kernelScene() : null);

const STORED_HINT = 'Shaded as it was when it was folded: fold it again to light it in another style.';

function targetOf(figure: Entry, picture: FoldedFigureExportPicture) {
  return foldedFigureExportTarget({
    figure,
    picture,
    title: `Export ${figure.title}`,
    fileStem: `Crane ${figure.title}`,
    exportStyle: exportPaperStyle(DEFAULT_PAPER_STYLE_SETTINGS, figure.appearance),
    storedSceneHint: STORED_HINT,
  });
}

/** The page the dialog saves for these remembered options, exactly as the dialog reaches it. */
async function dialogSvg(figure: Entry, runtime: Runtime, remembered: PaperExportSettings) {
  const picture = pictureOf(figure, runtime);
  expect(picture).not.toBeNull();
  const exported = targetOf(figure, picture!);
  const rows = paperPresetRows([]);
  const draft = paperExportDraft(remembered, { format: null }, rows);
  const style = paperExportStyle(exported, draft.style, rows);
  const scene = await createPaperExportSession(exported).scene(
    paperExportSceneInput(exported, style, draft)
  );
  expect(scene).not.toBeNull();
  return paintPaperExport(exported, scene!, style, paperExportPage(exported, draft)).svg;
}

const CUSTOM: PaperExportSettings = {
  ...DEFAULT_PAPER_EXPORT_SETTINGS,
  background: '#223344',
  paddingMm: 12,
  sheet: { mm: 120 },
  keepHiddenFaces: false,
};

describe('foldedFigureExportTarget draws the direct export’s picture', () => {
  it('for a live 3D figure at the defaults', async () => {
    const svg = await dialogSvg(spatial(), { model: RENDER_MODEL }, DEFAULT_PAPER_EXPORT_SETTINGS);
    expect(svg).toBe(golden['3d'].liveDefaults);
  });

  it('for a live 3D figure with its own pins, on a coloured, sized page that drops hidden faces', async () => {
    const figure = spatial({
      appearance: {
        'paper.front': '#ff00ff',
        light: { ...DEFAULT_PAPER_STYLE.light, azimuth: 30 },
      },
    });
    const svg = await dialogSvg(figure, { model: RENDER_MODEL }, CUSTOM);
    expect(svg).toBe(golden['3d'].liveCustom);
  });

  it('for a 3D figure with only its stored scene, at the defaults and on the custom page', async () => {
    expect(await dialogSvg(spatial(), {}, DEFAULT_PAPER_EXPORT_SETTINGS)).toBe(
      golden['3d'].storedDefaults
    );
    expect(await dialogSvg(spatial(), {}, CUSTOM)).toBe(golden['3d'].storedCustom);
  });

  it('for a flat figure with a live kernel at the defaults', async () => {
    const svg = await dialogSvg(flat(), { kernel: kernelScene() }, DEFAULT_PAPER_EXPORT_SETTINGS);
    expect(svg).toBe(golden.flat.liveDefaults);
  });

  it('for a flat figure with its own pins on the custom page', async () => {
    const figure = flat({ appearance: { 'paper.front': '#ff00ff' } });
    const svg = await dialogSvg(figure, { kernel: kernelScene() }, CUSTOM);
    expect(svg).toBe(golden.flat.liveCustom);
  });

  it('for a flat figure reopened from a file, as its fixed picture', () => {
    const figure = flat({ handle: null });
    const exported = targetOf(figure, pictureOf(figure, { kernel: captured(figure) })!);
    expect(exported.fixedPicture?.svg).toBe(golden.flat.legacy);
  });
});

describe('foldedFigureExportPicture', () => {
  it('builds a 3D figure with a render model live, its stored scene kept for a fallback', () => {
    const figure = spatial();
    const picture = pictureOf(figure, { model: RENDER_MODEL, cssPerUserUnit: 2 });
    expect(picture).toMatchObject({ kind: 'live-3d', model: RENDER_MODEL, cssPerUserUnit: 2 });
    // Carried into the space the live path builds at: the placement's scale at the canvas's.
    const placed = spatial({ placement: { ...IDENTITY_FOLDED_PLACEMENT, scale: 1.5 } });
    const { stored } = pictureOf(placed, { model: RENDER_MODEL, cssPerUserUnit: 2 }) as LivePicture;
    const { bounds } = figure.scene!;
    expect(stored!.bounds.maxX - stored!.bounds.minX).toBeCloseTo((bounds.maxX - bounds.minX) * 3, 9);
    expect(stored!.items).toHaveLength(figure.scene!.items.length);
  });

  it('keeps no fallback for a live 3D figure with no stored scene', () => {
    for (const scene of [null, { ...spatial().scene!, items: [] }]) {
      expect(pictureOf(spatial({ scene }), { model: RENDER_MODEL })).toMatchObject({
        kind: 'live-3d',
        stored: null,
      });
    }
  });

  it('repaints the stored scene of a 3D figure with no render model', () => {
    const figure = spatial({ handle: null });
    expect(pictureOf(figure)).toEqual({ kind: 'stored-3d', scene: figure.scene });
  });

  it('paints the kernel’s scene for a flat figure whose kernel has faces', () => {
    const kernel = kernelScene();
    expect(pictureOf(flat(), { kernel, cssPerUserUnit: 2 })).toEqual({
      kind: 'flat',
      kernel,
      cssPerUserUnit: 2,
    });
  });

  it('fixes the stored render snapshot for a flat figure it cannot paint', () => {
    const fixed = foldedFigureExportDocument(renderSnapshot())!;
    const expected = { kind: 'fixed', svg: fixed.svg, widthPx: fixed.width, heightPx: fixed.height };
    // A kernel with no faces, no kernel, and a wireframe the verb never asks the kernel for.
    expect(pictureOf(flat(), { kernel: { ...kernelScene(), faces: [], subfaces: [] } })).toEqual(
      expected
    );
    expect(pictureOf(flat({ handle: null }))).toEqual(expected);
    const wireframe = flat({ displayStyle: 'Wire2' });
    expect(pictureOf(wireframe, { kernel: captured(wireframe) })).toEqual(expected);
  });

  it('fixes the render snapshot of a 3D figure from a file older than its stored scene', () => {
    const figure = spatial({ handle: null, scene: null, renderSnapshot: renderSnapshot() });
    expect(pictureOf(figure)).toMatchObject({ kind: 'fixed' });
  });

  it('has no picture when the figure has nothing to draw', () => {
    expect(pictureOf(flat({ handle: null, renderSnapshot: null }))).toBeNull();
    expect(pictureOf(flat({ renderSnapshot: null }), { kernel: null })).toBeNull();
    expect(pictureOf(spatial({ handle: null, scene: null }))).toBeNull();
    const empty = { ...renderSnapshot(), primitives: [] };
    expect(pictureOf(flat({ handle: null, renderSnapshot: empty }))).toBeNull();
  });
});

const input = (overrides: Partial<PaperSceneInput> = {}): PaperSceneInput => ({
  page: 0,
  style: DEFAULT_PAPER_STYLE,
  markHidden: false,
  background: null,
  sheet: { mm: 60 },
  ...overrides,
});

const relit: PaperStyle = { ...DEFAULT_PAPER_STYLE, light: { ...DEFAULT_PAPER_STYLE.light, azimuth: 30 } };
const heavier: PaperStyle = { ...DEFAULT_PAPER_STYLE, edges: { ...DEFAULT_PAPER_STYLE.edges, width: 4 } };
const recoloured: PaperStyle = {
  ...DEFAULT_PAPER_STYLE,
  paper: { front: '#ff00ff', back: '#00ffff' },
  edges: { ...DEFAULT_PAPER_STYLE.edges, color: '#0000ff' },
};

function liveTarget(figure = spatial()) {
  return targetOf(figure, pictureOf(figure, { model: RENDER_MODEL })!);
}

describe('foldedFigureExportTarget’s scene key', () => {
  it('rebuilds a live 3D scene for the light, the widest pen and the hidden test, not for a colour', () => {
    const { sceneKey } = liveTarget();
    const plain = sceneKey(input());
    expect(sceneKey(input({ style: relit }))).not.toBe(plain);
    expect(sceneKey(input({ style: heavier }))).not.toBe(plain);
    expect(sceneKey(input({ markHidden: true }))).not.toBe(plain);
    expect(sceneKey(input({ style: recoloured }))).toBe(plain);
    expect(sceneKey(input({ background: '#223344' }))).toBe(plain);
    // Only a References step is drawn at the page's scale.
    expect(sceneKey(input({ sheet: { mm: 120 } }))).toBe(plain);
  });

  it('never rebuilds a stored 3D scene or a fixed picture', () => {
    const stored = spatial({ handle: null });
    const legacy = flat({ handle: null });
    for (const { sceneKey } of [
      targetOf(stored, pictureOf(stored)!),
      targetOf(legacy, pictureOf(legacy)!),
    ]) {
      const plain = sceneKey(input());
      for (const changed of [
        input({ style: relit }),
        input({ style: heavier }),
        input({ style: recoloured }),
        input({ markHidden: true }),
        input({ background: '#223344' }),
        input({ sheet: { mm: 120 } }),
      ]) {
        expect(sceneKey(changed)).toBe(plain);
      }
    }
  });

  it('rebuilds a flat scene for the hidden test alone', () => {
    const { sceneKey } = targetOf(flat(), pictureOf(flat(), { kernel: kernelScene() })!);
    const plain = sceneKey(input());
    expect(sceneKey(input({ markHidden: true }))).not.toBe(plain);
    for (const style of [relit, heavier, recoloured]) expect(sceneKey(input({ style }))).toBe(plain);
    expect(sceneKey(input({ background: '#223344' }))).toBe(plain);
    expect(sceneKey(input({ sheet: { mm: 120 } }))).toBe(plain);
  });

  it('builds the live 3D scene the key names', async () => {
    const figure = spatial();
    const scene = await liveTarget(figure).buildScene(input({ style: relit, markHidden: true }));
    expect(scene).toEqual(
      folded3dFigureScene(figure, RENDER_MODEL, { style: relit, space: 1, markHidden: true, aux: null })
    );
    expect(scene).not.toEqual(
      folded3dFigureScene(figure, RENDER_MODEL, { style: DEFAULT_PAPER_STYLE, space: 1, aux: null })
    );
  });

  it('paints the stored scene when the live model is past the mesh’s budget', async () => {
    const tooLarge = { ...RENDER_MODEL, edge_count: FOLDED_3D_MESH_VERTEX_BUDGET };
    const figure = spatial();
    expect(folded3dFigureScene(figure, tooLarge, { style: DEFAULT_PAPER_STYLE, space: 1 })).toBeNull();
    const picture = pictureOf(figure, { model: tooLarge });
    expect(picture?.kind).toBe('live-3d');
    const scene = await targetOf(figure, picture!).buildScene(input());
    expect(scene).not.toBeNull();
    expect(scene).toBe((picture as LivePicture).stored);

    const bare = spatial({ scene: null });
    await expect(
      targetOf(bare, pictureOf(bare, { model: tooLarge })!).buildScene(input())
    ).resolves.toBeNull();
  });
});

describe('foldedFigureExportTarget', () => {
  it('names the figure, and lays its pins over every style it is exported in', () => {
    const appearance = { 'paper.front': '#ff00ff' } as const;
    const figure = flat({ appearance });
    const exported = targetOf(figure, pictureOf(figure, { kernel: kernelScene() })!);
    expect(exported).toMatchObject({
      surface: 'folded-flat',
      title: 'Export Folded model 1',
      fileStem: 'Crane Folded model 1',
      pages: null,
      pins: appearance,
    });
    expect(exported.exportStyle.paper.front).toBe('#ff00ff');
    expect(targetOf(flat(), pictureOf(flat(), { kernel: kernelScene() })!).pins).toBeNull();
  });

  it('is a folded-3d surface for every 3D picture and a folded-flat one for every flat picture', () => {
    const live = spatial();
    const stored = spatial({ handle: null });
    const legacy3d = spatial({ handle: null, scene: null, renderSnapshot: renderSnapshot() });
    const legacyFlat = flat({ handle: null });
    expect(liveTarget(live).surface).toBe('folded-3d');
    expect(targetOf(stored, pictureOf(stored)!).surface).toBe('folded-3d');
    expect(targetOf(legacy3d, pictureOf(legacy3d)!).surface).toBe('folded-3d');
    expect(targetOf(flat(), pictureOf(flat(), { kernel: kernelScene() })!).surface).toBe(
      'folded-flat'
    );
    expect(targetOf(legacyFlat, pictureOf(legacyFlat)!).surface).toBe('folded-flat');
  });

  it('sizes the figure, whatever picture it is, opening 50 mm across', () => {
    expect(DEFAULT_PAPER_SIZE_MM).toBe(50);
    expect(DEFAULT_PAPER_EXPORT_SETTINGS.sheet).toEqual({ mm: DEFAULT_PAPER_SIZE_MM });
    const stored = spatial({ handle: null });
    const legacy = flat({ handle: null });
    for (const exported of [
      liveTarget(),
      targetOf(stored, pictureOf(stored)!),
      targetOf(flat(), pictureOf(flat(), { kernel: kernelScene() })!),
      targetOf(legacy, pictureOf(legacy)!),
    ]) {
      expect(exported.sizeMeasures).toBe('figure');
    }
  });

  // The sheet a figure was folded from is nowhere in its picture, so a size
  // is the drawing's own: its longer side, margins aside, is what was asked for.
  it('sizes the figure, not the sheet it was folded from', async () => {
    for (const [figure, runtime] of [
      [spatial(), { model: RENDER_MODEL }],
      [spatial(), {}],
      [flat(), { kernel: kernelScene() }],
    ] as const) {
      for (const mm of [41, 120]) {
        const svg = await dialogSvg(figure, runtime, { ...CUSTOM, sheet: { mm } });
        const [, width, height] = /width="([\d.]+)pt" height="([\d.]+)pt"/.exec(svg)!;
        const longerMm = Math.max(Number(width), Number(height)) / PT_PER_MM - 2 * CUSTOM.paddingMm;
        expect(longerMm).toBeCloseTo(mm, 1);
      }
    }
  });

  it('buries faces, and has no fixed picture, unless it is fixed', async () => {
    const stored = spatial({ handle: null });
    for (const exported of [
      liveTarget(),
      targetOf(stored, pictureOf(stored)!),
      targetOf(flat(), pictureOf(flat(), { kernel: kernelScene() })!),
    ]) {
      expect(exported.buriesFaces).toBe(true);
      expect(exported.fixedPicture ?? null).toBeNull();
    }

    const legacy = flat({ handle: null });
    const fixed = targetOf(legacy, pictureOf(legacy)!);
    const document = foldedFigureExportDocument(legacy.renderSnapshot)!;
    expect(fixed.buriesFaces).toBe(false);
    expect(fixed.fixedPicture).toEqual({
      svg: document.svg,
      widthPx: document.width,
      heightPx: document.height,
    });
    await expect(fixed.buildScene(input())).resolves.toBeNull();
  });

  it('keeps a fixed picture’s own proportions', () => {
    // A picture twice as wide as it is tall, so a width read as a height shows.
    const wide = renderSnapshot();
    const fill = wide.primitives[0]!;
    if (fill.geometry.kind !== 'polygon') throw new Error('fixture is a polygon');
    fill.geometry.points = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 200 },
      { x: 0, y: 200 },
    ];
    const legacy = flat({ handle: null, renderSnapshot: wide });
    const picture = targetOf(legacy, pictureOf(legacy)!).fixedPicture!;
    expect(picture.widthPx).toBeGreaterThan(picture.heightPx);
    expect(picture).toMatchObject({
      widthPx: foldedFigureExportDocument(wide)!.width,
      heightPx: foldedFigureExportDocument(wide)!.height,
    });
  });

  it('says a stored 3D scene keeps its light, and says nothing of any other picture', () => {
    const stored = spatial({ handle: null });
    const legacy = flat({ handle: null });
    expect(targetOf(stored, pictureOf(stored)!).hint).toBe(STORED_HINT);
    for (const exported of [
      liveTarget(),
      targetOf(flat(), pictureOf(flat(), { kernel: kernelScene() })!),
      targetOf(legacy, pictureOf(legacy)!),
    ]) {
      expect(exported.hint ?? null).toBeNull();
    }
  });

  it('paints with the surface’s policy: the light on a 3D figure only, every crease in the edge pen', () => {
    const threeD = liveTarget().paintStyle(relit);
    const flatStyle = targetOf(flat(), pictureOf(flat(), { kernel: kernelScene() })!).paintStyle(relit);
    expect(threeD).toEqual(surfacePaperStyle(relit, PAPER_STYLE_POLICIES['folded-3d']));
    expect(flatStyle).toEqual(surfacePaperStyle(relit, PAPER_STYLE_POLICIES['folded-flat']));
    expect(threeD.light.azimuth).toBe(30);
    expect(flatStyle.light).toEqual(DEFAULT_PAPER_STYLE.light);
    for (const style of [threeD, flatStyle]) {
      expect(style.mountainFolds).toEqual(style.edges);
      expect(style.valleyFolds).toEqual(style.edges);
    }
  });
});
