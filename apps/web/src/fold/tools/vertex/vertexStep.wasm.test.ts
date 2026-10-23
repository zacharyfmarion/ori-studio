import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Point } from '../../../lib/geometry';
import { applyIsometry, invertIsometry, lineThrough, sideOf } from '../../canvas/foldCanvasGeometry';
import { foldPickIndex, foldStackAt, topSheetPointAt, type FoldPick, type FoldPickIndex } from '../../canvas/foldPicking';
import type { FoldChoices, FoldOp, FoldVertexOp } from '../../document/foldSequenceDocument';
import { createFoldEngineCalls, type FoldEngineCalls } from '../../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from '../../engine/foldEngineCompoundCalls';
import type { FoldVertexAnalysed } from '../../engine/foldEngineSquashWire';
import type { FoldEngineOutcome, FoldEngineRefused } from '../../engine/foldEngineWire';
import i18n from '../../../i18n';
import { foldVertexWindowView } from '../../canvas/foldCanvasModel';
import type { FoldToolPreview } from '../../canvas/useFoldToolPreview';
import { freeLineThrough, movingPoint } from '../foldStepBuilder';
import { FOLD_TOOL_INITIAL, type FoldToolState } from '../foldToolState';
import type { FoldToolHost, FoldToolWindowVerbs } from '../foldToolWindow';
import {
  fanHasNoFourth,
  fanAnchorAlternative,
  landingFourths,
  layerSheetPointAt,
  vertexAskedOp,
  vertexChosenOp,
  vertexStepFrom,
  withEmergent,
  type FoldVertexBuilt,
  type FoldVertexIntent,
  type FoldVertexTaken,
} from './vertexStep';
import { vertexControls } from './vertexToolWindow';
import { fanGivenCreases } from './fanGeometry';
import { fanGiven } from './vertexStep';

/**
 * Each vertex fold over the real bridge, in-process, as its tool folds it:
 * the clicks on the folded pane read into the op the engine describes first
 * (the compound question), the folder's choices taken of what that lists —
 * asked again when they make it another fold — and the step built from the
 * answers (`vertexChosenOp`, `vertexStepFrom`: the very functions the tool's
 * hook runs), which then lands through `step`, as a preview, a commit and a
 * replay land it. From the square: two squashes to the preliminary base, two
 * petal folds to the bird base (the vertex spike's route, research §5.3, in
 * the engine's frame: `crates/oristudio-fold/tests/vertex/cases.rs`); a
 * rabbit ear on the two-layer triangle and on the flat square with its
 * diagonal precreased, each one ear whose three corner creases share a letter
 * and whose fourth has the other; a swivel by its edge on the square with its
 * diagonal precreased, its ridge stepped. A petal fold's hinge is clicked as
 * the precrease it is, or by its two ends, which the fold creases.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

interface Engine {
  calls: FoldEngineCalls;
  compound: FoldEngineCompoundCalls;
}

async function engine(): Promise<Engine> {
  const wasm = await import('../../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const fold = new wasm.FoldEngine();
  return { calls: createFoldEngineCalls(fold), compound: createFoldEngineCompoundCalls(fold) };
}

function landed<T>(outcome: FoldEngineOutcome<T>): T {
  if (outcome.status !== 'ok') throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome;
}

const indexOf = (calls: FoldEngineCalls, state: number): FoldPickIndex =>
  foldPickIndex(calls.scene(state), calls.landmarks(state, []), []);

const p = (x: number, y: number): Point => ({ x, y });

const free = (at: Point): FoldPick => ({ kind: 'free', pane: 'folded', scene: at, sheet: null });

/** A point landmark at a scene point, named by `sheet`. */
const landmark = (at: Point, sheet: [number, number]): FoldPick => ({
  kind: 'point',
  provenance: 'vertex',
  sheet,
  mark: null,
  scene: at,
});

const NONE: FoldVertexTaken = { squashTarget: null, emergent: null, order: 0 };

const intent = (extra: Partial<FoldVertexIntent>): FoldVertexIntent => ({
  tool: 'squash',
  petalHinge: 'crease',
  swivelTarget: 'crease',
  picks: [],
  direction: 'valley',
  fanLayers: null,
  ...extra,
});

/** The compound question of a vertex op: its family's answer, or why it refused. */
function ask({ compound }: Engine, state: number, op: FoldVertexOp): FoldVertexAnalysed | FoldEngineRefused {
  const answer = compound.compoundAnalysis(state, op);
  if (answer.status !== 'ok') return answer;
  if (answer.family !== 'vertex') throw new Error(`answered for ${answer.family}`);
  return answer;
}

/** An answer that must describe the fold: an answer that did not throws, naming the refusal. */
function described(answer: FoldVertexAnalysed | FoldEngineRefused): FoldVertexAnalysed {
  if ('refusal' in answer) throw new Error(`refused: ${JSON.stringify(answer.refusal)}`);
  return answer;
}

interface Folded {
  base: FoldVertexOp;
  first: FoldVertexAnalysed;
  answer: FoldVertexAnalysed;
  built: FoldVertexBuilt;
  /** Whether the choices made it another fold, asked again. */
  again: boolean;
  /** A fan's fourth ray taken, by index into the candidates. */
  emergent: number | null;
}

/** A vertex fold as its tool builds it (see the module docs). */
function vertexFold(engined: Engine, state: number, wanted: FoldVertexIntent, taken: FoldVertexTaken = NONE): Folded {
  let base = vertexAskedOp(wanted, indexOf(engined.calls, state));
  if (!base || 'status' in base) throw new Error(`no op: ${JSON.stringify(base)}`);
  let first = described(ask(engined, state, base));
  if (fanHasNoFourth(first)) {
    const alternative = fanAnchorAlternative(wanted, indexOf(engined.calls, state), base);
    if (alternative) {
      const answer = described(ask(engined, state, alternative));
      if (!fanHasNoFourth(answer)) { base = alternative; first = answer; }
    }
  }
  const chosen = vertexChosenOp(base, first, taken);
  if (!chosen) throw new Error('no fourth crease lands');
  const answer = chosen.again ? described(ask(engined, state, chosen.op)) : first;
  return { base, first, answer, built: vertexStepFrom(chosen.op, answer, taken), again: chosen.again, emergent: chosen.emergent };
}

/** Land a built step as a preview, a commit and a replay land it. */
function land({ calls }: Engine, state: number, step: { op: FoldOp; choices?: FoldChoices }) {
  const folded = landed(calls.step(state, step.op, step.choices));
  expect(folded.compound?.family).toBe('vertex');
  return folded;
}

/** A plain fold along the free line through two sheet points, `toward`'s side moving. */
const valley = (through: [[number, number], [number, number]], moving: [number, number]): FoldOp => ({
  kind: 'valley',
  line: { via: 'free', through },
  moving,
  seed: { scope: 'all' },
});

const TURN: FoldOp = { kind: 'turn', axis: 'vertical' };

/** The vertex spike's small triangle: the square folded on bd onto a, then on ac (four layers). */
function smallTriangle({ calls }: Engine): number {
  const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
  const half = landed(calls.step(sheet, valley([[1, 0], [0, 1]], [1, 1]))).state;
  return landed(calls.step(half, valley([[0, 0], [0.5, 0.5]], [0.9, 0.1]))).state;
}

const t22 = Math.tan(Math.PI / 8) * 0.5;
/** The petal fold's landmarks on the preliminary base, in the model frame (`cases.rs` `petal_marks`). */
const MARKS = {
  t: [0.5, 0.5],
  open: [0, 0],
  ends: [
    [t22, 0.5],
    [0.5, t22],
  ],
  near: [
    [0.03, 0.44],
    [0.44, 0.03],
  ],
  petal: [0.26, 0.2],
} as const;

/** A model point in the scene frame: the view's mirror, x ↦ −x, when turned over. */
const sceneOf = (flipped: boolean, [x, y]: readonly [number, number]): Point => p(flipped ? -x : x, y);

/** A precrease along the scene line through `a` and `b`, through the top layer at `top`, or every layer on `toward`'s side. */
function precrease(
  { calls }: Engine,
  state: number,
  a: Point,
  b: Point,
  through: { top: Point } | { toward: Point }
): number {
  const index = indexOf(calls, state);
  const line = lineThrough(a, b);
  if (!line) throw new Error('no line');
  const ends = freeLineThrough(index, line);
  if (!ends) throw new Error('the line misses the paper');
  let along: Pick<Extract<FoldOp, { kind: 'precrease' }>, 'seed' | 'moving'>;
  if ('top' in through) {
    const at = layerSheetPointAt(index, through.top, 'valley');
    if (!at) throw new Error('no layer there');
    along = { seed: { scope: 'depth', at, layers: 1 } };
  } else {
    const moving = movingPoint(index, line, sideOf(line, through.toward) > 0 ? 1 : -1);
    if (!moving) throw new Error('no paper on that side');
    along = { seed: { scope: 'all' }, moving: moving.sheet };
  }
  const op: FoldOp = { kind: 'precrease', direction: 'valley', line: { via: 'free', through: ends }, ...along };
  return landed(calls.step(state, op)).state;
}

/** The kite precreases on the flap seen on top: from the open corner to each end of H. */
function kites(engined: Engine, state: number, flipped: boolean): number {
  let s = state;
  for (const k of [0, 1] as const) {
    s = precrease(engined, s, sceneOf(flipped, MARKS.open), sceneOf(flipped, MARKS.ends[k]), {
      top: sceneOf(flipped, MARKS.near[k]),
    });
  }
  return s;
}

/** A point clicked on the folded pane, named by the top layer's sheet point there, as a free point's click is. */
function pointAt(index: FoldPickIndex, at: Point): FoldPick {
  const sheet = topSheetPointAt(index, at);
  if (!sheet) throw new Error(`no paper at ${at.x},${at.y}`);
  return { kind: 'point', provenance: 'free', sheet, mark: null, scene: at };
}

/**
 * A petal fold at the spike's petal point, its hinge named as the tool names
 * it: by its two ends, clicked where the kite creases meet the flap's edges;
 * or by the precrease along the line through them, clicked on the folded pane.
 */
function petal(engined: Engine, state: number, flipped: boolean, hinge: 'points' | 'crease' = 'points'): Folded {
  const index = indexOf(engined.calls, state);
  const [a, b] = MARKS.ends.map((end) => sceneOf(flipped, end)) as [Point, Point];
  const flap = free(sceneOf(flipped, MARKS.petal));
  if (hinge === 'points') {
    return vertexFold(engined, state, intent({ tool: 'petal', petalHinge: 'points', picks: [pointAt(index, a), pointAt(index, b), flap] }));
  }
  const line = lineThrough(a, b);
  const crease = index.folded.segments.find(
    (segment) => segment.segment === 'crease' && line && segment.scene.every((end) => Math.abs(sideOf(line, end)) < 1e-9)
  );
  if (!crease) throw new Error('no precrease along the hinge');
  return vertexFold(engined, state, intent({ tool: 'petal', petalHinge: 'crease', picks: [crease, flap] }));
}

describe.skipIf(!available)('the vertex folds over the real bridge, as their tools build them', () => {
  it('squashes the small triangle front and back into the preliminary base, a spine aimed off its hinge too', async () => {
    const engined = await engine();
    const { calls } = engined;
    const tri = smallTriangle(engined);
    expect(calls.summary(tri).faces).toBe(4);

    // The flap clicked: one order, on its hinge, nothing more to ask.
    const front = vertexFold(engined, tri, intent({ picks: [free(p(0.1, 0.5))] }));
    expect(front.again).toBe(false);
    expect(front.first.analysis.kind).toBe('squash');
    expect(front.first.orders).toBeNull();
    expect(front.built.step.op).toMatchObject({ kind: 'squash', direction: 'valley' });
    expect(front.built.step.choices).toBeUndefined();
    const one = land(engined, tri, front.built.step);

    // Pictured as the tool previews it and as the step keeps it: its crease
    // from the vertex, its arrow, and the push onto its spine.
    const previewed = landed(calls.action(tri, front.built.step.op, front.built.step.choices)).action;
    expect(previewed).toMatchObject({ kind: 'fold', direction: 'valley' });
    expect(previewed.line).not.toBeNull();
    expect(previewed.spans.length).toBeGreaterThan(0);
    expect(previewed.grip).not.toBeNull();
    expect(previewed.push).toBeDefined();
    expect(previewed.pleat).toBeUndefined();
    const kept = landed(calls.stepAction(one.state)).action;
    expect(kept?.line).toEqual(previewed.line);
    expect(kept?.push).toEqual(previewed.push);

    // Aimed off its hinge, inside its wedge: asked again, and it lands; outside, refused.
    const analysis = front.first.analysis;
    if (analysis.kind !== 'squash') throw new Error('not a squash');
    const [hx, hy] = analysis.hinge_direction;
    const [sx, sy] = analysis.spine_direction;
    const inside: [number, number] = [hx + 0.3 * sx, hy + 0.3 * sy];
    const aimed = vertexFold(engined, tri, intent({ picks: [free(p(0.1, 0.5))] }), { ...NONE, squashTarget: inside });
    expect(aimed.again).toBe(true);
    if (aimed.answer.analysis.kind !== 'squash') throw new Error('not a squash');
    expect(Math.abs(aimed.answer.analysis.share)).toBeGreaterThan(0.05);
    land(engined, tri, aimed.built.step);
    const outside = vertexAskedOp(intent({ picks: [free(p(0.1, 0.5))] }), indexOf(calls, tri));
    if (!outside || 'status' in outside) throw new Error('no op');
    const refused = ask(engined, tri, { ...outside, kind: 'squash', target: [-sx, -sy] } as FoldVertexOp);
    expect(refused).toMatchObject({ status: 'refused', refusal: { code: 'squash_target_outside' } });

    // Turned over, the back flap: the preliminary base.
    const turned = landed(calls.step(one.state, TURN)).state;
    const back = vertexFold(engined, turned, intent({ picks: [free(sceneOf(true, [0.1, 0.7]))] }));
    const base = land(engined, turned, back.built.step);
    expect(base.summary.faces).toBe(8);

    // A single layer: no flap, under the engine's code, before anything folds.
    const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    const flat = vertexAskedOp(intent({ picks: [free(p(0.3, 0.3))] }), indexOf(calls, sheet));
    if (!flat || 'status' in flat) throw new Error('no op');
    expect(ask(engined, sheet, flat)).toMatchObject({
      status: 'refused',
      refusal: { code: 'squash_no_flap', cause: 'single_layer' },
    });
  });

  /** The preliminary base: the small triangle squashed front and back. */
  function preliminaryBase(engined: Engine): number {
    const { calls } = engined;
    const tri = smallTriangle(engined);
    const front = land(engined, tri, vertexFold(engined, tri, intent({ picks: [free(p(0.1, 0.5))] })).built.step);
    const turned = landed(calls.step(front.state, TURN)).state;
    const back = vertexFold(engined, turned, intent({ picks: [free(sceneOf(true, [0.1, 0.7]))] }));
    return land(engined, turned, back.built.step).state;
  }

  it('petal folds the preliminary base front and back into the bird base over its precreases, the hinge clicked', async () => {
    const engined = await engine();
    const { calls } = engined;
    const base = preliminaryBase(engined);
    // The kites and the hinge precreased: the hinge clicked as the crease it is.
    const [a, b] = MARKS.ends;
    const kited = kites(engined, base, true);
    const ready = precrease(engined, kited, sceneOf(true, a), sceneOf(true, b), { toward: sceneOf(true, MARKS.t) });
    const first = petal(engined, ready, true, 'crease');
    if (first.first.analysis.kind !== 'petal') throw new Error('not a petal fold');
    // Over precreases, it creases nothing itself.
    expect(first.first.analysis.scores_line).toBe(false);
    expect(first.first.analysis.scores_kites).toEqual([false, false]);
    expect(first.built.step.op).toMatchObject({ kind: 'petal', direction: 'valley' });
    expect(first.built.step.op).toHaveProperty('crease');
    const petalled = land(engined, ready, first.built.step);

    // Turned over, the kites again (the hinge runs through every layer), the second petal fold: the bird base.
    const over = kites(engined, landed(calls.step(petalled.state, TURN)).state, false);
    const bird = land(engined, over, petal(engined, over, false, 'crease').built.step);
    expect(bird.summary.faces).toBe(24);
  });

  it('petal folds by the hinge’s two ends, creasing the hinge through the top layer as it lifts', async () => {
    const engined = await engine();
    const { calls } = engined;
    // Only the kites precreased: the hinge by its ends, which the fold creases.
    const kited = kites(engined, preliminaryBase(engined), true);
    const first = petal(engined, kited, true);
    if (first.first.analysis.kind !== 'petal') throw new Error('not a petal fold');
    expect(first.built.step.op).toHaveProperty('ends');
    expect(first.first.analysis.scores_line).toBe(true);
    expect(first.first.analysis.scores_kites).toEqual([false, false]);
    const petalled = land(engined, kited, first.built.step);
    // The other side the same way: both petals lifted.
    const over = kites(engined, landed(calls.step(petalled.state, TURN)).state, false);
    const second = petal(engined, over, false);
    if (second.first.analysis.kind !== 'petal') throw new Error('not a petal fold');
    expect(second.first.analysis.scores_line).toBe(true);
    land(engined, over, second.built.step);
  });

  /**
   * The creases a step made, grouped by the sheet vertex they meet at: per
   * group, the letter each has and whether it runs to one of `corners`.
   */
  function earCreases(
    { calls }: Engine,
    state: number,
    corners: readonly (readonly [number, number])[]
  ): { letter: string | null; toCorner: boolean }[][] {
    const scene = calls.scene(state);
    const made = Math.max(...scene.creases.map((crease) => crease.made_at));
    const fresh = scene.creases.filter((crease) => crease.made_at === made);
    const key = (q: Point) => `${q.x.toFixed(6)},${q.y.toFixed(6)}`;
    const ends = new Map<string, number>();
    for (const crease of fresh) for (const end of [crease.from, crease.to]) ends.set(key(end), (ends.get(key(end)) ?? 0) + 1);
    const corner = (q: Point) => corners.some(([x, y]) => Math.hypot(q.x - x, q.y - y) < 1e-6);
    // Each layer's four creases meet at its image of the incenter.
    return [...ends.entries()]
      .filter(([, count]) => count === 4)
      .map(([center]) =>
        fresh
          .filter((crease) => key(crease.from) === center || key(crease.to) === center)
          .map((crease) => ({
            letter: crease.letter,
            toCorner: corner(key(crease.from) === center ? crease.to : crease.from),
          }))
      );
  }

  /** The rabbit ear's rule in each layer: the three creases to its corners share a letter, the fourth has the other. */
  function expectEarLetters(groups: { letter: string | null; toCorner: boolean }[][], layers: number) {
    expect(groups).toHaveLength(layers);
    for (const group of groups) {
      const corners = group.filter((crease) => crease.toCorner);
      const fourth = group.filter((crease) => !crease.toCorner);
      expect(corners).toHaveLength(3);
      expect(fourth).toHaveLength(1);
      expect(new Set(corners.map((crease) => crease.letter)).size).toBe(1);
      expect(fourth[0]!.letter).not.toBe(corners[0]!.letter);
    }
  }

  it('rabbit-ears the two-layer triangle: one ear, its fourth crease the ridge, no ridge to choose', async () => {
    const engined = await engine();
    const { calls } = engined;
    const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    const tri = landed(calls.step(sheet, valley([[1, 0], [0, 1]], [1, 1]))).state;
    const picks = [
      landmark(p(0, 0), [0, 0]),
      landmark(p(1, 0), [1, 0]),
      landmark(p(0, 1), [0, 1]),
      free(p(0.1, 0.3)),
    ];
    const ear = vertexFold(engined, tri, intent({ tool: 'rabbit-ear', picks }));
    if (ear.first.analysis.kind !== 'rabbit-ear') throw new Error('not a rabbit ear');
    expect(ear.first.analysis.candidates).toHaveLength(3);
    // The 45° ray splits the paper that stays: it does not fit; the other two do.
    expect(ear.first.emergents.filter(Boolean)).toHaveLength(2);
    // The fourth ray taken is one that lands, and lands alone: nothing to store, no ridge.
    expect(ear.first.emergents[ear.answer.analysis.kind === 'rabbit-ear' ? (ear.answer.analysis.emergent ?? 0) : 0]).toBe(true);
    expect(ear.built.orders).toEqual([]);
    expect(ear.built.step.choices).toBeUndefined();
    expect(ear.built.step.op).not.toHaveProperty('ridge');
    const folded = land(engined, tri, ear.built.step);
    // Both layers: the bottom one's corners as cut, the top one's mirrored across the fold.
    expectEarLetters(
      earCreases(engined, folded.state, [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]),
      2
    );
  });

  it('rabbit-ears the triangle of a square precreased on its diagonal: corner creases valley, the fourth mountain', async () => {
    const engined = await engine();
    const { calls } = engined;
    const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    const precreased = landed(
      calls.step(sheet, {
        kind: 'precrease',
        direction: 'valley',
        line: { via: 'free', through: [[0, 0], [1, 1]] },
        moving: [0, 1],
        seed: { scope: 'all' },
      })
    ).state;
    const picks = [
      landmark(p(0, 0), [0, 0]),
      landmark(p(1, 0), [1, 0]),
      landmark(p(1, 1), [1, 1]),
      free(p(0.9, 0.2)),
    ];
    const corners = [
      [0, 0],
      [1, 0],
      [1, 1],
    ] as const;
    for (const direction of ['valley', 'mountain'] as const) {
      const ear = vertexFold(engined, precreased, intent({ tool: 'rabbit-ear', picks, direction }));
      expect(ear.built.step.choices).toBeUndefined();
      const groups = earCreases(engined, land(engined, precreased, ear.built.step).state, corners);
      expectEarLetters(groups, 1);
      const [group] = groups;
      expect(group!.find((crease) => crease.toCorner)?.letter).toBe(direction);
    }
  });

  it('rabbit-ears the saved Whale prefix through its existing precreases via the same four UI picks', async () => {
    const fixture = JSON.parse(readFileSync(resolve(process.cwd(), '../../tests/fixtures/fold-examples/rabbit-ear-precreased-whale.json'), 'utf8'));
    const engined = await engine();
    const { calls } = engined;
    let state = landed(calls.sheet(fixture.paper)).state;
    for (const step of fixture.steps) state = landed(calls.step(state, step.op, step.choices)).state;
    const direct = landed(calls.step(state, fixture.op));
    const index = indexOf(calls, state);
    const corners = fixture.op.corners as [number, number][];
    // The bridge's rabbit-ear corner anchors are original-sheet points.
    const picks = corners.map(c => {
      const scene = index.toScene(p(c[0], c[1]));
      return landmark(scene, c);
    });
    const selectedRegion = index.toScene(p(0.93, 0.29));
    const wanted = intent({ tool: 'rabbit-ear', picks: [...picks, free(selectedRegion)] });
    const given = fanGiven(wanted)!;
    const pending = fanGivenCreases(index, given, 'valley', null);
    expect(pending).toHaveLength(3);
    for (const segment of pending) {
      expect(Math.hypot(segment.scene[1].x - given.center.x, segment.scene[1].y - given.center.y)).toBeCloseTo(given.limits![segment.ray]!, 8);
    }
    const ear = vertexFold(engined, state, wanted);
    expect(landingFourths(ear.first)).toHaveLength(1);
    const folded = land(engined, state, ear.built.step);
    expect(folded.fingerprint).toBe(direct.fingerprint);
    // Serialization keeps exactly the public operation and choices used by preview.
    const reopened = land(engined, state, JSON.parse(JSON.stringify(ear.built.step)));
    expect(reopened.fingerprint).toBe(folded.fingerprint);
    const fish = landed(calls.step(folded.state, fixture.second));
    // Both ears must match the control that omitted the preparation marks,
    // including which original sheet points and paper sides appear in each layer.
    let control = landed(calls.sheet(fixture.paper)).state;
    for (const step of fixture.steps.slice(0, 2)) control = landed(calls.step(control, step.op)).state;
    control = landed(calls.step(control, fixture.op)).state;
    control = landed(calls.step(control, fixture.second)).state;
    const actualIndex = indexOf(calls, fish.state);
    const controlIndex = indexOf(calls, control);
    let compared = 0;
    for (let x = -12; x <= 12; x += 1) for (let y = 0; y <= 28; y += 1) {
      const point = p(x / 20 + 0.00131, y / 20 + 0.00217);
      const stack = (index: FoldPickIndex) => foldStackAt(index, point).map(f => ({
        material: applyIsometry(invertIsometry(index.scene.face_transforms[f]!), point),
        front: index.scene.faces[f]!.front_up,
      }));
      const actual = stack(actualIndex), expected = stack(controlIndex);
      expect(actual.length).toBe(expected.length);
      actual.forEach((layer, i) => {
        expect(layer.material.x).toBeCloseTo(expected[i]!.material.x, 7);
        expect(layer.material.y).toBeCloseTo(expected[i]!.material.y, 7);
        expect(layer.front).toBe(expected[i]!.front);
        compared += 1;
      });
    }
    expect(compared).toBeGreaterThan(100);
  });

  it('swivels the bottom edge onto the precreased diagonal by its edge, stepping its ridge among those that land', async () => {
    const engined = await engine();
    const { calls } = engined;
    const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    const diagonal = landed(
      calls.step(sheet, {
        kind: 'precrease',
        direction: 'valley',
        line: { via: 'free', through: [[0, 0], [1, 1]] },
        moving: [0, 1],
        seed: { scope: 'all' },
      })
    ).state;
    const index = indexOf(calls, diagonal);
    const edge = index.folded.segments.find((segment) => segment.segment === 'raw_edge' && segment.scene.every((end) => end.y === 0));
    const crease = index.folded.segments.find((segment) => segment.segment === 'crease');
    if (!edge || !crease) throw new Error('no edge or precrease');
    // The pivot past the incenter, a point clicked freely; the edge; the diagonal it lands on.
    const pivot = pointAt(index, p(0.8, 0.3));
    const wanted = intent({ tool: 'swivel', picks: [pivot, edge, crease] });
    const swivel = vertexFold(engined, diagonal, wanted);
    const analysis = swivel.first.analysis;
    if (analysis.kind !== 'swivel-by-edge') throw new Error('not a swivel by its edge');
    // Where the creases meet: the pivot moved onto the bisector from the corner, y = x·tan 22.5°.
    expect(analysis.vertex[1]).toBeCloseTo(analysis.vertex[0] * Math.tan(Math.PI / 8), 9);
    expect(analysis.creases.map((each) => each.ray)).toEqual(['meet', 'foot', 'end', 'hinge']);
    const fourths = landingFourths(swivel.first);
    expect(fourths.length).toBeGreaterThan(0);
    const fingerprints = new Set<string>();
    swivel.first.emergents.forEach((lands, ridge) => {
      // What the question says of each ridge is what landing it does.
      const asIs = calls.step(diagonal, withEmergent(swivel.base, swivel.first, ridge));
      expect(asIs.status === 'ok', `ridge ${ridge}`).toBe(lands);
      // One that does not land is never taken: the first that does is, in its place.
      const stepped = vertexFold(engined, diagonal, wanted, { ...NONE, emergent: ridge });
      expect(stepped.emergent).toBe(lands ? ridge : fourths[0]);
      // The foot's ridge is stored as no ridge at all; the end's by its direction.
      expect('ridge' in stepped.built.step.op).toBe(stepped.emergent === 1);
      const folded = landed(calls.step(diagonal, stepped.built.step.op, stepped.built.step.choices));
      fingerprints.add(folded.fingerprint);
    });
    expect(fingerprints.size).toBe(fourths.length);
  });

  it('uses exactly the hinge region picked, with no separate fourth-crease control', async () => {
    // A square precreased on its diagonal, top left to bottom right; the
    // triangle above it rabbit-eared, its corners clicked as landmarks.
    const engined = await engine();
    const { calls } = engined;
    const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    const precreased = landed(
      calls.step(sheet, {
        kind: 'precrease',
        direction: 'valley',
        line: { via: 'free', through: [[0, 1], [1, 0]] },
        moving: [0, 0],
        seed: { scope: 'all' },
      })
    ).state;
    const corners = [landmark(p(0, 1), [0, 1]), landmark(p(1, 1), [1, 1]), landmark(p(1, 0), [1, 0])];
    const tools: FoldToolState = { ...FOLD_TOOL_INITIAL, tool: 'rabbit-ear' };
    const verbs = { cancel: () => undefined, commit: () => undefined, stepEmergent: () => undefined } as unknown as FoldToolWindowVerbs;
    const host: FoldToolHost = { coarse: false, alt: 'Alt' };
    /** The window's fourth-crease row and note, for the paper that stays clicked at `at`, as the canvas reads the engine's answer. */
    const offered = (at: Point) => {
      const ear = vertexFold(engined, precreased, intent({ tool: 'rabbit-ear', picks: [...corners, free(at)] }));
      if (ear.first.analysis.kind !== 'rabbit-ear') throw new Error('not a rabbit ear');
      const fourths = landingFourths(ear.first);
      const vertex = {
        base: ear.first,
        answer: ear.answer,
        emergent: ear.emergent,
        fourths,
        orders: [],
        order: null,
        layers: 1,
      };
      const preview = { step: { op: ear.built.step.op, key: 'ear' }, vertex } as unknown as FoldToolPreview;
      const view = foldVertexWindowView(tools, preview);
      if (!view) throw new Error('no window view');
      const controls = vertexControls(i18n.t.bind(i18n), view, verbs, false, host, true);
      return { ear, fourths, candidates: ear.first.analysis.candidates.length, controls };
    };

    const fingerprints = new Set<string>();
    for (const at of [p(0.72, 0.9), p(0.9, 0.6)]) {
      const other = offered(at);
      expect(other.fourths, `${at.x},${at.y}`).toHaveLength(1);
      expect(other.controls.emergent).toBeNull();
      expect(other.controls.emergentNote).toBe('The hinge crease lies in the selected region.');
      fingerprints.add(landed(calls.step(precreased, other.ear.built.step.op, other.ear.built.step.choices)).fingerprint);
    }
    expect(fingerprints.size).toBe(2);
    // The lower-left region aims into attached paper. Neither automatic
    // anchor may replace that selected hinge with one of the other rays.
    expect(() => offered(p(0.3, 0.3))).toThrow('no fourth crease lands');
  });

  it('builds no step when no fourth crease lands, and finds none for other paper on the twice-precreased square’s top triangle', async () => {
    // Both diagonals precreased: a ray into either half beside the triangle runs into paper it does not cut.
    const engined = await engine();
    const { calls } = engined;
    const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    const precrease = (through: [[number, number], [number, number]], moving: [number, number]): FoldOp => ({
      kind: 'precrease',
      direction: 'valley',
      line: { via: 'free', through },
      moving,
      seed: { scope: 'all' },
    });
    const once = landed(calls.step(sheet, precrease([[0, 0], [1, 1]], [0, 1]))).state;
    const twice = landed(calls.step(once, precrease([[0, 1], [1, 0]], [0, 0]))).state;
    const index = indexOf(calls, twice);
    const corners = [landmark(p(0, 1), [0, 1]), landmark(p(1, 1), [1, 1]), landmark(p(0.5, 0.5), [0.5, 0.5])];
    const wanted = intent({ tool: 'rabbit-ear', picks: [...corners, free(p(0.5, 0.95))] });
    const base = vertexAskedOp(wanted, index);
    if (!base || 'status' in base) throw new Error(`no op: ${JSON.stringify(base)}`);
    const first = described(ask(engined, twice, base));
    expect(first.analysis.kind === 'rabbit-ear' && first.analysis.candidates.length).toBeGreaterThan(0);
    expect(fanHasNoFourth(first)).toBe(true);
    // No step, so no preview to refuse.
    expect(vertexChosenOp(base, first, NONE)).toBeNull();
    // Nor would the triangle's other regions staying help.
    const elsewhere = fanAnchorAlternative(wanted, index, base);
    expect(elsewhere).not.toBeNull();
    if (elsewhere) expect(fanHasNoFourth(described(ask(engined, twice, elsewhere)))).toBe(true);
  });
});
