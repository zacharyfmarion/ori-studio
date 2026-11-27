// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { polygonArea } from '../../fold/canvas/foldCanvasGeometry';
import { SQUARE_PAPER, type FoldOp } from '../../fold/document/foldSequenceDocument';
import { createFoldEngineCalls } from '../../fold/engine/foldEngineCalls';
import { createFoldEngineCompoundCalls } from '../../fold/engine/foldEngineCompoundCalls';
import type { FoldScene } from '../../fold/engine/foldEngineWire';
import { orderPairs, overlap, reflection, RepeatFailure, sheetRing } from '../../fold/repeat/repeatGeometry';
import { changedFaces, stepRelation, verifyMaterial } from '../../fold/repeat/repeatVerification';
import { foldStepGroups, startingRuns, type FoldMergeStep } from './foldStepMerge';

/**
 * Merging Fold steps a book draws as one, over the real Fold bridge
 * in-process: each sequence is folded from a square, its states' scenes read
 * as the session reads them, and grouped (`foldStepGroups`). Synthetic
 * sequences only. Skipped when the bridge has not been built.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

type Engine = ReturnType<typeof createFoldEngineCalls> & ReturnType<typeof createFoldEngineCompoundCalls>;
type Step = FoldOp | 'turn';

const valley = (through: [[number, number], [number, number]], moving: [number, number]): FoldOp => ({
  kind: 'valley',
  line: { via: 'free', through },
  moving,
  seed: { scope: 'all' },
});
const precrease = (through: [[number, number], [number, number]], moving: [number, number]): FoldOp => ({
  kind: 'precrease',
  direction: 'valley',
  line: { via: 'free', through },
  moving,
  seed: { scope: 'all' },
});

/** Fold and unfold in half, bottom to top. */
const HALF = precrease([[0, 0.5], [1, 0.5]], [0.5, 0.1]);
/** The cupboard fold: the bottom edge to the centre, then the top edge. */
const BOTTOM = valley([[0, 0.25], [1, 0.25]], [0.5, 0.1]);
const TOP = valley([[0, 0.75], [1, 0.75]], [0.5, 0.9]);
/** The cupboard-folded strip's two ends, a half turn apart: no mirror takes one onto the other. */
const LEFT_END = valley([[0, 0.75], [0.5, 0.25]], [0.05, 0.3]);
const RIGHT_END = valley([[0.5, 0.75], [1, 0.25]], [0.95, 0.7]);
/** Creases along two of a square's corner lines, left for the corners to fold along. */
const BR_CREASE = precrease([[0.75, 0], [1, 0.25]], [0.95, 0.05]);
const TL_CREASE = precrease([[0, 0.75], [0.25, 1]], [0.05, 0.95]);
/** The four corners, each folded in by a quarter of the side. */
const BR = valley([[0.75, 0], [1, 0.25]], [0.95, 0.05]);
const BL = valley([[0, 0.25], [0.25, 0]], [0.05, 0.05]);
const TL = valley([[0, 0.75], [0.25, 1]], [0.05, 0.95]);
const TR = valley([[0.75, 1], [1, 0.75]], [0.95, 0.95]);
/** Two corners folded past the centre: once down, one lies on the other. */
const BL_DEEP = valley([[0, 0.6], [0.6, 0]], [0.05, 0.05]);
const TR_DEEP = valley([[0.4, 1], [1, 0.4]], [0.95, 0.95]);

let raw: { free(): void } | null = null;
let engine: Engine | null = null;

/** The state each step lands on `from`, in order. */
function land(from: number, steps: readonly Step[]): number[] {
  const states = [from];
  for (const step of steps) {
    const op: FoldOp = step === 'turn' ? { kind: 'turn', axis: 'vertical' } : step;
    const landed = engine!.step(states.at(-1)!, op);
    if (landed.status !== 'ok') throw new Error(`step: ${JSON.stringify(landed).slice(0, 300)}`);
    states.push(landed.state);
  }
  return states;
}

/** `steps` folded from a square: the scene of the sheet, then of each state. */
function fold(steps: readonly Step[]): { states: number[]; scenes: FoldScene[] } {
  const sheet = engine!.sheet(SQUARE_PAPER);
  if (sheet.status !== 'ok') throw new Error('sheet');
  const states = land(sheet.state, steps);
  return { states, scenes: states.map((state) => engine!.scene(state)) };
}

/** The path as the merge reads it: step k folds from scene k to scene k + 1. */
function path(steps: readonly Step[], scenes: readonly FoldScene[]): FoldMergeStep[] {
  return steps.map((step, k) => ({ id: `s${k + 1}`, mergeable: step !== 'turn', before: scenes[k]!, after: scenes[k + 1]! }));
}

/** Whether face `a` lies over face `b` in `scene`, read from its stacks; undefined where they share no stack. */
function over(scene: FoldScene, a: number, b: number): boolean | undefined {
  const sign = orderPairs(scene).get(`${Math.min(a, b)}:${Math.max(a, b)}`);
  return sign === undefined ? undefined : a < b ? sign === 1 : sign === -1;
}

/** Whether two states hold the paper alike: every piece in the same place, every stack in the same order. */
function sameLanding(x: FoldScene, y: FoldScene): boolean {
  if (changedFaces(x, y).length > 0 || changedFaces(y, x).length > 0) return false;
  const holding = (scene: FoldScene, ring: ReturnType<typeof sheetRing>) =>
    scene.faces.flatMap((_, i) => (Math.abs(polygonArea(overlap(ring, sheetRing(scene, i)))) > 1e-12 ? [i] : []));
  for (const key of orderPairs(x).keys()) {
    const [a, b] = key.split(':').map(Number) as [number, number];
    for (const i of holding(y, sheetRing(x, a)))
      for (const k of holding(y, sheetRing(x, b))) {
        const seen = i === k ? undefined : over(y, i, k);
        if (seen !== undefined && seen !== over(x, a, b)) return false;
      }
  }
  return true;
}

describe.skipIf(!available)('merging Fold steps a book draws as one', () => {
  beforeAll(async () => {
    const module = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
    module.initSync({ module: readFileSync(WASM) });
    const made = new module.FoldEngine();
    raw = made;
    engine = { ...createFoldEngineCalls(made), ...createFoldEngineCompoundCalls(made) };
  });
  afterAll(() => {
    engine?.clear();
    raw?.free();
  });

  it('merges the cupboard fold’s two edges: independent mirror images', () => {
    const steps = [HALF, BOTTOM, TOP];
    const { scenes } = fold(steps);
    const groups = foldStepGroups(path(steps, scenes));
    expect(groups).toEqual([{ steps: ['s2', 's3'], related: [[], ['mirror']] }]);
    expect(startingRuns(groups[0]!, true)).toEqual([[0, 1]]);
  });

  it('merges four corners, two of them folded along creases left before', () => {
    const steps = [BR_CREASE, TL_CREASE, BR, BL, TL, TR];
    const { scenes } = fold(steps);
    const groups = foldStepGroups(path(steps, scenes));
    // The two creases mirror each other too, and move no paper.
    expect(groups.map((group) => group.steps)).toEqual([
      ['s1', 's2'],
      ['s3', 's4', 's5', 's6'],
    ]);
    const corners = groups[1]!;
    expect(corners.related.slice(1).every((row) => row.includes('mirror'))).toBe(true);
    expect(startingRuns(corners, true)).toEqual([[0, 3]]);
  });

  it('measures creases as far folded: Repeat’s exact test refuses a corner folded across fresh paper', () => {
    const steps = [BR_CREASE, BR, BL];
    const { scenes } = fold(steps);
    const [, before, after, next] = scenes as [FoldScene, FoldScene, FoldScene, FoldScene];
    // BR refolds a crease; BL folds fresh paper. Across the vertical centre line, the same fold.
    const mirror = reflection({ n: [1, 0], d: 0.5 });
    const refused = () => verifyMaterial(before, after, after, next, mirror, 'same', 'exact');
    expect(refused).toThrow(RepeatFailure);
    expect(verifyMaterial(before, after, after, next, mirror, 'same', 'angles')).toBe('unmoved');
    expect(stepRelation(before, after, after, next)).toBe('mirror');
  });

  it('offers a strip’s two ends, a half turn apart, without merging them', () => {
    const steps = [BOTTOM, TOP, LEFT_END, RIGHT_END];
    const { scenes } = fold(steps);
    const groups = foldStepGroups(path(steps, scenes));
    expect(groups).toEqual([
      { steps: ['s1', 's2'], related: [[], ['mirror']] },
      { steps: ['s3', 's4'], related: [[], ['turn']] },
    ]);
    expect(startingRuns(groups[1]!, true)).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('never merges corners folded past the centre, though each is the other’s image: one lands on the other', () => {
    const steps = [BL_DEEP, TR_DEEP];
    const { scenes } = fold(steps);
    expect(stepRelation(scenes[0]!, scenes[1]!, scenes[1]!, scenes[2]!)).not.toBeNull();
    expect(foldStepGroups(path(steps, scenes))).toEqual([]);
  });

  it('never merges across a turn', () => {
    const steps: Step[] = [HALF, BOTTOM, 'turn', TOP];
    const { scenes } = fold(steps);
    expect(foldStepGroups(path(steps, scenes))).toEqual([]);
  });

  it('folds every merged group the same in any order', () => {
    const cases: [Step[], number, number][] = [
      // The steps, then the first and last of the group.
      [[HALF, BOTTOM, TOP], 1, 2],
      [[BR_CREASE, TL_CREASE, BR, BL, TL, TR], 2, 5],
      [[BOTTOM, TOP, LEFT_END, RIGHT_END], 2, 3],
    ];
    for (const [steps, first, last] of cases) {
      const { states, scenes } = fold(steps);
      const backwards = land(states[first]!, steps.slice(first, last + 1).reverse());
      expect(sameLanding(engine!.scene(backwards.at(-1)!), scenes[last + 1]!)).toBe(true);
    }
  });
});
