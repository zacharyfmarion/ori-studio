import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cpHitRadiusModel, CP_LINE_HIT_RATIO, CP_POINT_HIT_RATIO } from '../../cp-workspace/snapRadius';
import { DEFAULT_DEPTH_SPREAD, DEFAULT_LAYER_SPREAD } from '../../cp-workspace/folded/layerSpreadSettings';
import type { Point } from '../../lib/geometry';
import { CP_DEFAULT_SNAP_RADIUS } from '../../lib/cpSnapRadiusSetting';
import type { FoldOp } from '../document/foldSequenceDocument';
import { createFoldEngineCalls, type FoldEngineCalls } from '../engine/foldEngineCalls';
import type { FoldEngineOutcome } from '../engine/foldEngineWire';
import { FOLD_UNITS_PER_CP_UNIT, FOLD_USER_PER_UNIT } from './foldCanvasGeometry';
import { FOLD_PANE_DISPLAY_DEFAULT, foldedPaneScene } from './foldPaneScenes';
import { foldPaneSpreadMap } from './foldPaneSpreadMap';
import { foldPickIndex, resolveFoldPick } from './foldPicking';
import { restingSpread } from './useFoldCanvasPaint';

/**
 * The folded pane picked where it draws the paper, over the real engine's
 * states, in-process: a book fold with its corner valley-folded up, spread by
 * the default affine spread (which holds one face still and moves every other,
 * the flap on top among them) and by depth. Skipped when the bridge has not
 * been built.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

const valley = (through: [[number, number], [number, number]], moving: [number, number]): FoldOp => ({
  kind: 'valley',
  line: { via: 'free', through },
  moving,
  seed: { scope: 'all' },
});
const BOOK = valley([[0.5, 0], [0.5, 1]], [0.1, 0.5]);
const CORNER = valley([[0.75, 0], [1, 0.25]], [0.95, 0.05]);

function landed<T>(outcome: FoldEngineOutcome<T>): T {
  if (outcome.status !== 'ok') throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome;
}

/** The user's default snap radius at 100%, in sheet units, as the pane measures it. */
const RADII = {
  point: cpHitRadiusModel(CP_DEFAULT_SNAP_RADIUS, 1, CP_POINT_HIT_RATIO, 6) * FOLD_UNITS_PER_CP_UNIT,
  line: cpHitRadiusModel(CP_DEFAULT_SNAP_RADIUS, 1, CP_LINE_HIT_RATIO, 8) * FOLD_UNITS_PER_CP_UNIT,
};
const POINT = { snap: 'point' as const, edges: true, free: false };

async function bookAndCorner(): Promise<{ calls: FoldEngineCalls; state: number }> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const calls = createFoldEngineCalls(new wasm.FoldEngine());
  const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
  const book = landed(calls.step(sheet, BOOK)).state;
  return { calls, state: landed(calls.step(book, CORNER)).state };
}

const near = (a: Point | null | undefined, b: Point, within = 1e-9) =>
  !!a && Math.hypot(a.x - b.x, a.y - b.y) <= within;

describe.skipIf(!available)('the spread folded pane, picked where it is drawn', () => {
  it('maps every face where the painter draws it', async () => {
    const { calls, state } = await bookAndCorner();
    const scene = calls.scene(state);
    for (const spread of [DEFAULT_LAYER_SPREAD, DEFAULT_DEPTH_SPREAD]) {
      const map = foldPaneSpreadMap(scene, spread)!;
      const painted = foldedPaneScene(scene, FOLD_PANE_DISPLAY_DEFAULT, undefined, spread);
      let checked = 0;
      for (const item of painted.items) {
        if (item.kind !== 'face' || item.group !== undefined) continue;
        const outline = scene.faces[item.face]!.outline;
        item.rings[0]!.forEach(([x, y], k) => {
          const drawn = { x: x / FOLD_USER_PER_UNIT, y: -y / FOLD_USER_PER_UNIT };
          expect(near(map.onFace(item.face, outline[k]!), drawn, 1e-9), `${spread.kind} face ${item.face} corner ${k}`).toBe(true);
          checked += 1;
        });
      }
      expect(checked).toBeGreaterThan(0);
    }
    expect(foldPaneSpreadMap(scene, null)).toBeNull();
  });

  it('picks the flap’s corner where the default spread draws it, and the face held still where it lies', async () => {
    const { calls, state } = await bookAndCorner();
    const scene = calls.scene(state);
    const landmarks = calls.landmarks(state, []);
    const map = foldPaneSpreadMap(scene, DEFAULT_LAYER_SPREAD)!;
    // The flap's corner, on the bottom layer's sheet at (1, 0.25), lies on the top layer's (0, 0.25).
    const truth = { x: 1, y: 0.25 };
    const drawn = map.sheet([1, 0.25])!;
    expect(Math.hypot(drawn.x - truth.x, drawn.y - truth.y)).toBeGreaterThan(2 * RADII.point);

    // Unspread, the pane finds nothing where the reader sees the corner.
    expect(resolveFoldPick(foldPickIndex(scene, landmarks, []), 'folded', drawn, RADII, POINT)).toBeNull();

    const index = foldPickIndex(scene, landmarks, [], map);
    const flap = resolveFoldPick(index, 'folded', drawn, RADII, POINT);
    expect(flap).toMatchObject({ kind: 'point', sheet: [1, 0.25] });
    // The pick lies where the paper does: the step stores the sheet point, and the flat pane draws it there.
    expect(near(flap?.kind === 'point' ? flap.scene : null, truth, 1e-9)).toBe(true);
    const freeEnd = resolveFoldPick(index, 'folded', drawn, RADII, { ...POINT, snap: 'free', snapFree: true });
    expect(freeEnd).toMatchObject({ kind: 'free', sheet: [1, 0.25] });
    expect(near(freeEnd?.kind === 'free' ? freeEnd.scene : null, truth, 1e-9)).toBe(true);
    // The face held still is where it lies, and so is its corner there.
    expect(resolveFoldPick(index, 'folded', truth, RADII, POINT)).toMatchObject({ kind: 'point', sheet: [0, 0.25] });
  });

  it('picks a top face’s corner where a depth spread draws it', async () => {
    const { calls, state } = await bookAndCorner();
    const scene = calls.scene(state);
    const map = foldPaneSpreadMap(scene, DEFAULT_DEPTH_SPREAD)!;
    const index = foldPickIndex(scene, calls.landmarks(state, []), [], map);
    // The book's top edge, at its fold: a top face's corner, moved toward its deeper neighbours.
    const drawn = map.sheet([0.5, 1])!;
    expect(Math.hypot(drawn.x - 0.5, drawn.y - 1)).toBeGreaterThan(RADII.point);
    expect(resolveFoldPick(index, 'folded', drawn, RADII, POINT)).toMatchObject({ kind: 'point', sheet: [0.5, 1] });
  });

  it('reads a free point off the face drawn on top, and draws it back where it was clicked', async () => {
    const { calls, state } = await bookAndCorner();
    const scene = calls.scene(state);
    const map = foldPaneSpreadMap(scene, DEFAULT_LAYER_SPREAD)!;
    const index = foldPickIndex(scene, calls.landmarks(state, []), [], map);
    // Inside the flap as drawn.
    const inFlap = map.sheet([0.95, 0.15])!;
    const pick = resolveFoldPick(index, 'folded', inFlap, RADII, { snap: 'free', edges: false, free: false });
    expect(pick?.kind).toBe('free');
    if (pick?.kind !== 'free') return;
    expect(pick.sheet?.[0]).toBeCloseTo(0.95, 9);
    expect(pick.sheet?.[1]).toBeCloseTo(0.15, 9);
    expect(near(map.sheet(pick.sheet!), inFlap, 1e-9)).toBe(true);
  });

  it('lies flat once a tool has a pick in hand', () => {
    const none = { action: null, analysis: null };
    expect(restingSpread(DEFAULT_LAYER_SPREAD, none)).toBe(DEFAULT_LAYER_SPREAD);
    expect(restingSpread(DEFAULT_LAYER_SPREAD, none, true)).toBeNull();
  });
});
