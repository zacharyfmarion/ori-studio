import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpreadSolution } from '@oristudio/layer-spread';
import { connectedSpreadSource } from '../../cp-workspace/folded/connectedSpreadSource';
import { foldedFigureObj, foldedFlatObjMesh } from '../../cp-workspace/folded/foldedFigureObj';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, surfacePaperStyle } from '../../lib/paper/paperStyleResolve';
import { DEFAULT_PAPER_EXPORT_SETTINGS } from '../../lib/paperExportSettings';
import { paperExportSceneInput } from '../../paperExport/paperExportSession';
import { FOLD_PANE_DISPLAY_DEFAULT } from '../canvas/foldPaneScenes';
import type { FoldScene } from '../engine/foldEngineWire';
import { foldStepsObj } from './foldStepObj';

const mock = vi.hoisted(() => ({ prepare: vi.fn(), pane: vi.fn(), picture: vi.fn() }));
vi.mock('../../layer-spread/prepareConnected', () => ({ prepareConnected: mock.prepare }));
vi.mock('../canvas/foldPaneScenes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../canvas/foldPaneScenes')>()),
  foldedPaneScene: mock.pane,
}));
vi.mock('../../cp-workspace/folded/foldedFigureSpreadExport', () => ({ spreadPictureExport: mock.picture }));

/**
 * A 400 × 200 sheet folded in half, as a Fold state has it: y up. Face 0, the
 * left half, lies turned over on face 1.
 */
function halfFold(): FoldScene {
  const at = (x: number, y: number) => ({ x, y: -y });
  const edges = (outline: { x: number; y: number }[]) =>
    outline.map((from, i) => ({ from, to: outline[(i + 1) % outline.length]!, kind: 'border' as const }));
  const left = [at(400, 0), at(200, 0), at(200, 200), at(400, 200)];
  const right = [at(200, 0), at(400, 0), at(400, 200), at(200, 200)];
  return {
    schema_version: 3,
    flipped: false,
    sheet: 400,
    faces: [
      { outline: left, points: [0, 1, 4, 5], front_up: false, edges: edges(left) },
      { outline: right, points: [1, 2, 3, 4], front_up: true, edges: edges(right) },
    ],
    subfaces: [{ polygon: right, faces_top_to_bottom: [0, 1] }],
    aux_lines: [],
    sheet_points: [at(0, 0), at(200, 0), at(400, 0), at(400, 200), at(200, 200), at(0, 200)],
  } as unknown as FoldScene;
}

const LIFT: SpreadSolution = {
  version: 'normalized-50-v1',
  heights: [1, 0.5, 0, 0, 0.5, 1],
  references: [
    { plane: [0, 0, 0], center: [0, 0, 0], samples: 0, rms: 0 },
    { plane: [0, 0, 0], center: [0, 0, 0], samples: 0, rms: 0 },
  ],
  diagnostics: {} as SpreadSolution['diagnostics'],
};

const DEFAULT_SPREAD: LayerSpreadOptions = { kind: 'connected', version: 1, amount: 0.5, reveal: [0.3, 0.2] };
const AFFINE: LayerSpreadOptions = { kind: 'affine', amount: 0.3, keep: 'top', skew: 0, axisDeg: 0 };

const scene = halfFold();
const states = [
  { scene, spread: null },
  { scene, spread: AFFINE },
  { scene, spread: DEFAULT_SPREAD },
];
const input = (page: number) =>
  paperExportSceneInput({ buriesFaces: true }, DEFAULT_PAPER_STYLE, { ...DEFAULT_PAPER_EXPORT_SETTINGS, format: 'obj' }, page);

const PANE = { items: [{ kind: 'face' }], bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } };
const SETTLED = { items: [{ kind: 'face', settled: true }], bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } };

let release = vi.fn();
let picture = { scene: vi.fn(), release: vi.fn() };
beforeEach(() => {
  mock.prepare.mockReset();
  mock.pane.mockReset();
  mock.picture.mockReset();
  release = vi.fn();
  mock.prepare.mockImplementation(() => ({
    promise: Promise.resolve({ source: connectedSpreadSource(scene, true), solution: LIFT }),
    release,
  }));
  mock.pane.mockReturnValue(PANE);
  picture = { scene: vi.fn(async () => SETTLED), release: vi.fn() };
  mock.picture.mockReturnValue(picture);
});

describe('foldStepsObj', () => {
  it('writes each step folded as its picture spreads it: flat, lifted by Default, refused for a picture-only spread', async () => {
    const { objs } = foldStepsObj(states, FOLD_PANE_DISPLAY_DEFAULT);
    expect(objs.map((obj) => obj.unavailableReason)).toEqual([null, 'picture-only-spread', null]);
    expect(await objs[0]!.build()).toBe(
      foldedFigureObj(foldedFlatObjMesh(scene, connectedSpreadSource(scene, true), null, true))
    );
    expect(mock.prepare).not.toHaveBeenCalled();
    expect(await objs[2]!.build()).toBe(
      foldedFigureObj(
        foldedFlatObjMesh(scene, connectedSpreadSource(scene, true), { solution: LIFT, amount: 0.5 }, true)
      )
    );
    // Solved y up, as the Fold pane solves a state.
    expect(mock.prepare).toHaveBeenCalledExactlyOnceWith(scene, true);
  });

  it('previews a flat step as the folded pane draws it, keyed by the page alone', async () => {
    const display = { stepCreases: false, precreases: false };
    const { view } = foldStepsObj(states, display);
    expect(await view.buildScene(input(0))).toBe(PANE);
    expect(mock.pane).toHaveBeenLastCalledWith(scene, display, undefined, null);
    expect(mock.picture).not.toHaveBeenCalled();
    // Neither the style nor a page option reaches a flat state's scene: they only repaint it.
    expect(view.sceneKey(input(0))).toBe('0');
    expect(view.sizeMeasures).toBe('figure');
    expect(view.paintStyle(DEFAULT_PAPER_STYLE)).toEqual(surfacePaperStyle(DEFAULT_PAPER_STYLE, PAPER_STYLE_POLICIES.fold));
  });

  it('previews a spread step settled, as every exported spread picture is, from the pane’s own scene, y up', async () => {
    const display = { stepCreases: false, precreases: false };
    const { view } = foldStepsObj(states, display);
    expect(await view.buildScene(input(2))).toBe(SETTLED);
    await view.buildScene(input(2));
    // Settled once per step, in the pane's pens, at the page's size.
    expect(mock.picture).toHaveBeenCalledExactlyOnceWith(scene, DEFAULT_SPREAD, expect.objectContaining({ policy: 'fold', yUp: true }));
    expect(picture.scene).toHaveBeenLastCalledWith({
      style: surfacePaperStyle(DEFAULT_PAPER_STYLE, PAPER_STYLE_POLICIES.fold),
      mm: DEFAULT_PAPER_EXPORT_SETTINGS.sheet.mm,
    });
    // Its live scene is the pane's, spread by the solve — or unspread, should the spread not settle.
    const { build } = mock.picture.mock.calls[0]![2] as { build: (prepared: unknown, spreads: boolean) => unknown };
    const prepared = { source: connectedSpreadSource(scene, true), solution: LIFT };
    build(prepared, true);
    expect(mock.pane).toHaveBeenLastCalledWith(scene, display, undefined, DEFAULT_SPREAD, prepared);
    build(null, false);
    expect(mock.pane).toHaveBeenLastCalledWith(scene, display, undefined, null, undefined);
    // A bitmap, should it need one, is drawn in the page's pens and size: both key its scene.
    expect(view.sceneKey(input(2))).toBe(
      `2|${DEFAULT_PAPER_EXPORT_SETTINGS.sheet.mm}|${JSON.stringify(DEFAULT_PAPER_STYLE)}`
    );
  });

  it('draws nothing for a state the pane draws nothing of, or past the last step', async () => {
    const { view } = foldStepsObj(states, FOLD_PANE_DISPLAY_DEFAULT);
    mock.pane.mockReturnValueOnce({ items: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } });
    expect(await view.buildScene(input(0))).toBeNull();
    expect(await view.buildScene(input(5))).toBeNull();
  });

  it('lets go when the dialog closes: every settled picture, and a file’s solve still running', async () => {
    const captured = foldStepsObj(states, FOLD_PANE_DISPLAY_DEFAULT);
    await captured.view.buildScene(input(2));
    const pending = vi.fn();
    mock.prepare.mockReturnValueOnce({ promise: new Promise(() => {}), release: pending });
    void captured.objs[2]!.build();
    captured.release();
    expect(picture.release).toHaveBeenCalledOnce();
    expect(pending).toHaveBeenCalled();
  });
});
