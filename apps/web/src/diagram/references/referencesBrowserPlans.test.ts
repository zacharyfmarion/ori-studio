import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { plannerSequenceFixture } from '../../cp-workspace/references/__fixtures__/plannerSequence';
import {
  REFERENCES_PLANNER_BUILD,
  referencesPlanCacheKey,
  referencesPlanCacheKeyId,
  type ReferencesCachedPlan,
} from '../../cp-workspace/references/referencesPlanCache';
import type { ReferencesPlanCacheListing } from '../../cp-workspace/references/referencesPlanCacheStore';
import {
  precreaseInputFromTransport,
  type PrecreaseComponent,
  type PrecreaseFrame,
  type SheetAnalysis,
} from '../../cp-workspace/references/sheetFrames';
import { SEG_ATTR_STRIDE, type CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { browserPlanCards, plannedPatterns, sheetPattern, type BrowserPattern } from './referencesBrowserPlans';
import { referencesStepWays } from './referencesStepWays';
import type { PrecreaseWay, PrecreaseWitness } from '../../cp-workspace/references/precreaseSequence';

const t = ((_key: string, fallback: string, values?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name]))) as unknown as TFunction;

function transportOf(segments: readonly number[][]): CpGeometryTransport {
  const segEndpoints = new Float64Array(segments.length * 4);
  const segAttr = new Int32Array(segments.length * SEG_ATTR_STRIDE);
  segments.forEach(([ax, ay, bx, by, colour], index) => {
    segEndpoints.set([ax, ay, bx, by], index * 4);
    segAttr[index * SEG_ATTR_STRIDE] = colour;
  });
  return { segEndpoints, segAttr } as CpGeometryTransport;
}

/** Two square sheets side by side, the right one with more creases: References lists it first. */
const geometry = transportOf([
  [0, 0, 10, 0, 0],
  [0, 0, 10, 10, 1],
  [20, 0, 30, 0, 0],
  [20, 0, 30, 10, 2],
  [20, 10, 30, 0, 2],
]);
const input = precreaseInputFromTransport(geometry);
const frameAt = (x: number): PrecreaseFrame => ({ origin: [x, 10], x_axis: [1, 0], y_axis: [0, -1], width: 10, height: 10 });
function sheet(id: number, x: number, creases: number[]): PrecreaseComponent {
  return {
    id,
    frame: frameAt(x),
    rf_rect: { width: 1, height: 1 } as unknown as PrecreaseComponent['rf_rect'],
    affines: null,
    outline: [
      [x, 0],
      [x + 10, 0],
      [x + 10, 10],
      [x, 10],
    ],
    outline_residual: 0,
    is_fallback: false,
    border_segment_indices: [],
    segment_indices: creases,
    unit_segments: [],
    aux_segment_indices: [],
    aux_unit_segments: [],
    merged_lines: [],
    exactness: null,
    refused: null,
  };
}
const analysis: SheetAnalysis = {
  components: [sheet(0, 0, [0, 1]), sheet(1, 20, [2, 3, 4])],
  unassigned_segments: [],
  warnings: [],
  segment_count: 5,
  tol: 1e-9,
  snap_radius: 1e-6,
};
const SETTINGS = { precreaseGrid: true, gridWhereNeeded: false, allowDanglingFolds: true, mergeSymmetricSteps: true };
const keyOf = (x: number) =>
  referencesPlanCacheKey(input, { bounds: { minX: x, minY: 0, maxX: x + 10, maxY: 10 }, frame: frameAt(x) }, SETTINGS);
const listed = (key: ReturnType<typeof keyOf>): ReferencesPlanCacheListing => ({ key, ways: {}, payload: 'packed' });

describe('plannedPatterns', () => {
  it('lists the sheets whose plan is this planner’s and fits their creases now, numbered as References numbers them', () => {
    const left = keyOf(0);
    const right = keyOf(20);
    const patterns = plannedPatterns(analysis, [listed(left), listed(right)], input);
    // The right sheet has more creases: References' Pattern 1.
    expect(patterns.map((pattern) => [pattern.number, pattern.component.id])).toEqual([
      [1, 1],
      [2, 0],
    ]);
    expect(patterns[0]!.id).toBe(referencesPlanCacheKeyId(right));
  });

  it('leaves out a sheet edited since its plan, and one planned by another build', () => {
    const stale = { ...keyOf(0), sheet: { ...keyOf(0).sheet, fingerprint: 'ps1:before' } };
    const other = { ...keyOf(20), planner: `${REFERENCES_PLANNER_BUILD}-older` };
    expect(plannedPatterns(analysis, [listed(stale), listed(other)], input)).toEqual([]);
  });
});

describe('browserPlanCards', () => {
  const sequence = plannerSequenceFixture();
  const plan = {
    result: { info: { component: 0 }, stopReason: 'complete' },
    plain: sequence,
    hoisted: sequence,
    durationMs: 5,
  } as unknown as ReferencesCachedPlan;

  it('draws the plan’s cards as References does, each fold the step it would become', () => {
    const [pattern] = plannedPatterns(analysis, [listed(keyOf(20))], input);
    const { cards, finished, settings } = browserPlanCards(t, plan, pattern!, geometry, false, 'rev-1');
    expect(finished).toBe(true);
    expect(settings).toEqual(SETTINGS);
    expect(cards.map((card) => card.index)).toEqual(cards.map((_, index) => index));
    const folds = cards.filter((card) => card.kind === 'fold');
    expect(folds.length).toBeGreaterThan(0);
    for (const fold of folds) {
      expect(fold.number).not.toBeNull();
      expect(fold.step?.picture).toMatchObject({ kind: 'step-diagram', mirrored: expect.any(Boolean) });
      expect(fold.step?.card.line).not.toBeNull();
    }
    expect(cards.at(-1)?.kind).toBe('done');
  });

  it('offers the Finished card only for a plan that ran to its end', () => {
    const [pattern] = plannedPatterns(analysis, [listed(keyOf(20))], input);
    const stopped = { ...plan, result: { ...plan.result, stopReason: 'budget' } } as ReferencesCachedPlan;
    expect(browserPlanCards(t, stopped, pattern!, geometry, false, 'rev-1').finished).toBe(false);
  });
});

describe('a References step’s ways to fold (D23)', () => {
  const witness = (axiom: number, inputs: PrecreaseWitness['inputs'], ease = 0): PrecreaseWitness => ({
    axiom,
    inputs,
    root: 0,
    who_moves: [0],
    hard: false,
    visible: true,
    skinny: false,
    ease,
    err: 0,
  });
  /** The fixture with three ways at step 5, as `referencesWays.test.ts` has it. */
  function planWithWays(): ReferencesCachedPlan {
    const sequence = plannerSequenceFixture();
    const ways: PrecreaseWay[] = [
      { witness: witness(3, [{ kind: 'edge', id: 2, side: 'bottom' }, { kind: 'line', id: 4 }]), kind: 'O3:el' },
      { witness: witness(2, [{ kind: 'corner', id: 0, corner: 'sw' }, { kind: 'point', id: 4 }]), kind: 'O2:cp', decided_by: 'local' },
      { witness: witness(1, [{ kind: 'point', id: 4 }, { kind: 'point', id: 5 }], 7), kind: 'O1:pp', decided_by: 'one_motion' },
    ];
    sequence.steps[4] = { ...sequence.steps[4]!, ways };
    return { result: { info: { component: 0 }, stopReason: 'complete' }, plain: sequence, hoisted: sequence, durationMs: 5 } as unknown as ReferencesCachedPlan;
  }

  it('draws the card under each of its ways, marking the one the step shows', () => {
    const plan = planWithWays();
    const [pattern] = plannedPatterns(analysis, [listed(keyOf(20))], input);
    const { cards } = browserPlanCards(t, plan, pattern!, geometry, false, 'rev-1');
    const card = cards.find((candidate) => candidate.ways === 3)!;
    expect(card.step?.way).toEqual(expect.any(String));
    const result = referencesStepWays(t, plan, pattern!, geometry, 'rev-1', { line: card.step!.card.line, way: card.step!.way! }, card.step!.picture);
    if (result.status !== 'ready') throw new Error('ways');
    expect(result.ways).toHaveLength(3);
    expect(result.current).toBe(0);
    expect(result.ways[0]!.picture.key).toBe(card.step!.picture.key);
    // Each way its own drawing and its own words.
    expect(new Set(result.ways.map((way) => way.signature)).size).toBe(3);
    expect(new Set(result.ways.map((way) => way.picture.key)).size).toBe(3);
  });

  it('keeps the side the step shows, and finds the way it shows by its signature', () => {
    const plan = planWithWays();
    const [pattern] = plannedPatterns(analysis, [listed(keyOf(20))], input);
    const card = browserPlanCards(t, plan, pattern!, geometry, false, 'rev-1').cards.find((candidate) => candidate.ways === 3)!;
    const first = referencesStepWays(t, plan, pattern!, geometry, 'rev-1', { line: card.step!.card.line, way: card.step!.way! }, card.step!.picture);
    if (first.status !== 'ready') throw new Error('ways');
    const third = first.ways[2]!;
    const turned = { ...third.picture, mirrored: !third.picture.mirrored };
    const again = referencesStepWays(t, plan, pattern!, geometry, 'rev-1', { line: card.step!.card.line, way: third.signature }, turned);
    if (again.status !== 'ready') throw new Error('ways');
    expect(again.current).toBe(2);
    expect(again.ways.every((way) => way.picture.mirrored === turned.mirrored)).toBe(true);
  });

  it('offers none for a card with one way, or one the plan does not have', () => {
    const plan = planWithWays();
    const [pattern] = plannedPatterns(analysis, [listed(keyOf(20))], input);
    const one = browserPlanCards(t, plan, pattern!, geometry, false, 'rev-1').cards.find((candidate) => candidate.kind === 'fold' && candidate.ways === null)!;
    expect(referencesStepWays(t, plan, pattern!, geometry, 'rev-1', { line: one.step!.card.line }, one.step!.picture).status).toBe('none');
    expect(referencesStepWays(t, plan, pattern!, geometry, 'rev-1', { line: { n: [0.6, 0.8], d: 99 } }, one.step!.picture).status).toBe('none');
  });
});

describe('the pattern on a sheet', () => {
  const square = (dx: number) => [
    [dx, 0],
    [dx + 100, 0],
    [dx + 100, 100],
    [dx, 100],
  ] as [number, number][];
  const listed = [
    { id: 'plan-a', component: { outline: square(0) } },
    { id: 'plan-b', component: { outline: square(300) } },
  ] as unknown as BrowserPattern[];

  it('finds the listed pattern on the sheet by its rim, from any corner', () => {
    const rim = [[300, 100], [300, 0], [400, 0], [400, 100]].map(([x, y]) => ({ x: x!, y: y! }));
    expect(sheetPattern(listed, [rim])?.id).toBe('plan-b');
  });

  it('finds none for no sheet, or one with no pattern listed', () => {
    expect(sheetPattern(listed, null)).toBeUndefined();
    expect(sheetPattern(listed, [square(900).map(([x, y]) => ({ x, y }))])).toBeUndefined();
  });
});
