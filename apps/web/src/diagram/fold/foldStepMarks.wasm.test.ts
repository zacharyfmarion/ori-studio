import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { creasePatternPaperScene, FOLD_PANE_DISPLAY_DEFAULT } from '../../fold/canvas/foldPaneScenes';
import type { FoldOp, FoldPointRef, FoldRef } from '../../fold/document/foldSequenceDocument';
import { isLockedStep, SQUARE_PAPER } from '../../fold/document/foldSequenceDocument';
import { readFoldSequences } from '../../fold/document/foldSequenceFile';
import { parseNativeProjectFile } from '../../lib/nativeProjectFile';
import { createFoldEngineCalls } from '../../fold/engine/foldEngineCalls';
import { createFoldEngineCompoundCalls } from '../../fold/engine/foldEngineCompoundCalls';
import type { FoldActionGeometry, FoldScene } from '../../fold/engine/foldEngineWire';
import { foldStepCreaseDiagram } from '../../fold/io/foldStepPages';
import { prepareRepeat, type RepeatSourceStep } from '../../fold/repeat/repeatPreparation';
import { foldStateFrame, sheetToScene } from '../../fold/sequence/foldStateFrame';
import type { Point } from '../../lib/geometry';
import { FOLD_PULL_RENDER } from './foldPull';
import { foldStepAction } from './foldStepMarkPlan';
import { foldStepPicture } from './foldStepPicture';

/**
 * A Fold step's marks in the Diagram drawn from the real engine's picture of
 * it and the real states either side: a rabbit ear's every crease and the
 * flap swung over, a petal fold's every crease, the circles and arrows the axioms place, and a Repeat's
 * every crease as its crease pattern's instruction. Skipped when the bridge
 * has not been built.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const FIXTURES = resolve(process.cwd(), '../../tests/fixtures/fold-examples');
const available = existsSync(WASM);

async function engine() {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const raw = new wasm.FoldEngine();
  return { ...createFoldEngineCalls(raw), ...createFoldEngineCompoundCalls(raw) };
}
type Engine = Awaited<ReturnType<typeof engine>>;

function landed<T extends { status: string }>(outcome: T): Extract<T, { status: 'ok' }> {
  if (outcome.status !== 'ok') throw new Error(JSON.stringify(outcome));
  return outcome as Extract<T, { status: 'ok' }>;
}

/** One step of `state`, with its picture and the states either side: an axiom's line at the root nearest `near` (a line's normal). */
function stepOf(calls: Engine, state: number, op: FoldOp, near?: readonly [number, number]) {
  let choices;
  if ('line' in op && op.line.via === 'axiom') {
    const { candidates } = landed(calls.axiomCandidates(state, op.line));
    const score = (n: readonly [number, number]) => (near ? Math.abs(n[0] * near[0] + n[1] * near[1]) : 0);
    choices = { root: [...candidates].sort((a, b) => score(b.line.n) - score(a.line.n))[0]!.line };
  }
  const child = landed(calls.step(state, op, choices));
  const action = landed(calls.stepAction(child.state)).action as FoldActionGeometry;
  const parent = calls.scene(state);
  return { state: child.state, parent, child: calls.scene(child.state), action, summary: child.summary };
}

/**
 * Every step of an example project replayed from its parent with its stored
 * choices: its op, the engine's picture of it, and the states either side.
 */
function exampleSteps(calls: Engine, name: string) {
  const project = parseNativeProjectFile(readFileSync(resolve(FIXTURES, name), 'utf8'));
  const [held] = readFoldSequences(project.workspace.foldSequences);
  const sheet = landed(calls.sheet(held!.document.paper)).state;
  const states = new Map<string, number>();
  return held!.document.steps.map((node) => {
    if (isLockedStep(node)) throw new Error(`${name}: ${node.id} is locked`);
    const before = node.parent ? states.get(node.parent)! : sheet;
    const parent = calls.scene(before);
    const child = landed(calls.step(before, node.op, node.choices));
    states.set(node.id, child.state);
    const acted = calls.stepAction(child.state);
    const action = acted.status === 'ok' ? (acted.action as FoldActionGeometry | null) : null;
    return { op: node.op, parent, child: calls.scene(child.state), action: action!, summary: child.summary };
  });
}

const pt = (x: number, y: number): FoldPointRef => ({ kind: 'point', at: [x, y] });
const edge = (a: [number, number], b: [number, number]): FoldRef => ({ kind: 'edge', a, b });
const all = { scope: 'all' } as const;
const at = (scene: FoldScene, x: number, y: number): Point => {
  const point = sheetToScene(foldStateFrame(scene), [x, y])!;
  return { x: point[0], y: point[1] };
};
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
const length = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

describe.skipIf(!available)('a Fold step’s marks in the Diagram, from the real engine', () => {
  it('draws every crease of a rabbit ear — three valley folds to the corners, the mountain fold to the edge — and the ear swung over', async () => {
    const calls = await engine();
    const whale = JSON.parse(readFileSync(resolve(FIXTURES, 'rabbit-ear-precreased-whale.json'), 'utf8'));
    let state = landed(calls.sheet(whale.paper)).state;
    for (const step of whale.steps) state = landed(calls.step(state, step.op, step.choices)).state;
    const ear = stepOf(calls, state, whale.op);
    // The engine draws one crease of it.
    expect(ear.action.spans).toHaveLength(1);
    const placed = foldStepAction(ear.action, { op: whale.op, parent: ear.parent, child: ear.child });
    const directions = placed.spans.map((span) => span.direction);
    expect(directions.filter((direction) => direction === 'valley')).toHaveLength(3);
    expect(directions.filter((direction) => direction === 'mountain')).toHaveLength(1);
    expect(placed.spans.every((span) => !span.hidden)).toBe(true);
    // Every one meets the others at the incenter; each valley runs on to a corner of the triangle.
    const corners = (whale.op.corners as [number, number][]).map(([x, y]) => at(ear.parent, x, y));
    const ends = placed.spans.flatMap((span) => [span.from, span.to]);
    const centre = ends.find((end) => ends.filter((other) => near(other, end)).length === 4)!;
    expect(centre).toBeDefined();
    for (const span of placed.spans.filter((each) => each.direction === 'valley')) {
      const far = near(span.from, centre) ? span.to : span.from;
      expect(corners.some((corner) => near(corner, far))).toBe(true);
    }
    // The arrow: from the corner that moves — the ear's tip, which its valley ridge runs to — to where it lands.
    const tip = corners.find((corner) => near(corner, placed.grip!.at));
    expect(tip).toBeDefined();
    expect(length(placed.grip!.at, placed.grip!.image)).toBeGreaterThan(0.5);
    const marks = foldStepPicture(
      { shown: ear.parent, own: { scene: ear.child, step: ear.summary.step, sheet: ear.summary.sheet }, moment: 'before', action: placed },
      FOLD_PULL_RENDER
    ).marks;
    // Seen from the back of the paper, as the whale starts: valleys and the mountain, as Lang draws a rabbit ear.
    expect(marks.map((mark) => mark.kind).sort()).toEqual(['mountain-line', 'valley-arrow', 'valley-line', 'valley-line', 'valley-line']);
  });

  it('draws every crease of a petal fold — the hinge and the two kite creases its sides fold in along — and keeps the engine’s arrow', async () => {
    const calls = await engine();
    const petal = exampleSteps(calls, 'petal-fold.osf').find((step) => step.op.kind === 'petal')!;
    const { op } = petal;
    // The engine draws the hinge alone.
    expect(petal.action.spans).toHaveLength(1);
    const placed = foldStepAction(petal.action, { op, parent: petal.parent, child: petal.child });
    expect(placed.grip).toEqual(petal.action.grip);
    // The hinge a valley, as the petal lifts toward the viewer; the kite creases mountains, its sides folding in behind it.
    expect(placed.spans.map((span) => span.direction).sort()).toEqual(['mountain', 'mountain', 'valley']);
    expect(placed.spans.every((span) => !span.hidden)).toBe(true);
    const [hinge] = placed.spans.filter((span) => span.direction === 'valley');
    const kites = placed.spans.filter((span) => span.direction === 'mountain');
    // The triangle the petal lifts from: each kite crease runs from an end of the hinge to the corner the two share.
    for (const kite of kites) expect([hinge!.from, hinge!.to].some((end) => near(end, kite.from) || near(end, kite.to))).toBe(true);
    expect([kites[0]!.from, kites[0]!.to].some((end) => near(end, kites[1]!.from) || near(end, kites[1]!.to))).toBe(true);
    const marks = foldStepPicture(
      { shown: petal.parent, own: { scene: petal.child, step: petal.summary.step, sheet: petal.summary.sheet }, moment: 'before', action: placed },
      FOLD_PULL_RENDER
    ).marks;
    expect(marks.map((mark) => mark.kind).sort()).toEqual(['mountain-line', 'mountain-line', 'valley-arrow', 'valley-line']);
  });

  it('draws every crease of a squash — the top layer’s, the one under it hidden there, and a hinge it folds — and keeps the engine’s arrows', async () => {
    const calls = await engine();
    const squashes = [...exampleSteps(calls, 'petal-fold.osf'), ...exampleSteps(calls, 'swivel-on-edge.osf')].filter((step) => step.op.kind === 'squash');
    expect(squashes).toHaveLength(3);
    const letters: string[][] = [];
    for (const squash of squashes) {
      // The engine draws one line: where the flap's layers crease.
      expect(squash.action.spans).toHaveLength(1);
      const placed = foldStepAction(squash.action, { op: squash.op, parent: squash.parent, child: squash.child });
      expect(placed.grip).toEqual(squash.action.grip);
      expect(placed.push).toEqual(squash.action.push);
      expect(placed.spans.every((span) => !span.hidden)).toBe(true);
      // That line is the top layer's crease, its front outside the fold: a mountain as the viewer sees it. The
      // lower layer's, a valley, lies under it there, so it is not drawn.
      const [engineLine] = squash.action.spans;
      const line = placed.spans.find((span) => [span.from, span.to].every((end) => near(end, engineLine!.from) || near(end, engineLine!.to)));
      expect(line?.direction).toBe('mountain');
      letters.push(placed.spans.map((span) => span.direction!).sort());
    }
    // A hinge an earlier squash left flat is folded again: a valley.
    expect(letters).toEqual([['mountain'], ['mountain', 'valley'], ['mountain', 'valley']]);
  });

  it('draws every crease of a swivel by its edge: the four meeting at its vertex, its ridge the other way', async () => {
    const calls = await engine();
    const swivels = exampleSteps(calls, 'swivel-fold.osf').filter((step) => step.op.kind === 'swivel');
    // Two branches: the ridge square to the edge, and toward its end.
    const ridges: Point[] = [];
    for (const swivel of swivels) {
      expect(swivel.action.spans).toHaveLength(1);
      const placed = foldStepAction(swivel.action, { op: swivel.op, parent: swivel.parent, child: swivel.child });
      expect(placed.grip).toEqual(swivel.action.grip);
      expect(placed.spans).toHaveLength(4);
      expect(placed.spans.map((span) => span.direction).sort()).toEqual(['mountain', 'valley', 'valley', 'valley']);
      const vertex = placed.spans[0]!.from;
      expect(placed.spans.every((span) => near(span.from, vertex) || near(span.to, vertex))).toBe(true);
      const ridge = placed.spans.find((span) => span.direction === 'mountain')!;
      ridges.push(near(ridge.from, vertex) ? ridge.to : ridge.from);
    }
    expect(ridges).toHaveLength(2);
    expect(near(ridges[0]!, ridges[1]!)).toBe(false);
  });

  it('draws a swivel on a folded edge by its valley and mountain, and the crease of the layer behind only past the one in front', async () => {
    const calls = await engine();
    // Where its creases meet on the kite's folded edge, the flap's corner and the model's tip.
    const V = { x: -0.1464466094067262, y: 0.3535533905932738 };
    const CORNER = { x: 0.2071067811865476, y: 0.2071067811865476 };
    const TIP = { x: 0, y: 0 };
    const along = (span: { from: Point; to: Point }, a: Point, b: Point) =>
      [span.from, span.to].every((end) => Math.abs((end.x - a.x) * (b.y - a.y) - (end.y - a.y) * (b.x - a.x)) < 1e-9);
    const drawn = (name: string) => {
      const swivel = exampleSteps(calls, name).find((step) => step.op.kind === 'swivel')!;
      const placed = foldStepAction(swivel.action, { op: swivel.op, parent: swivel.parent, child: swivel.child });
      expect(placed.grip).toEqual(swivel.action.grip);
      expect(placed.spans.every((span) => !span.hidden)).toBe(true);
      return placed.spans;
    };
    // Open: the valley to the flap's corner and the mountain toward the tip, on the layer in front; past where
    // that layer ends, the valley of the layer behind runs on to the tip. Under the mountain it is not drawn.
    const open = drawn('swivel-on-edge.osf');
    expect(open.map((span) => span.direction).sort()).toEqual(['mountain', 'valley', 'valley']);
    const corner = open.find((span) => along(span, V, CORNER))!;
    expect(corner.direction).toBe('valley');
    const toTip = open.filter((span) => along(span, V, TIP));
    const mountain = toTip.find((span) => span.direction === 'mountain')!;
    const behind = toTip.find((span) => span.direction === 'valley')!;
    const end = near(mountain.from, V) ? mountain.to : mountain.from;
    expect([behind.from, behind.to].some((point) => near(point, end))).toBe(true);
    expect([behind.from, behind.to].some((point) => near(point, TIP))).toBe(true);
    // Inside: the valley through the tip, both layers' as one line, and the mountain to the corner.
    const inside = drawn('swivel-inside.osf');
    expect(inside).toHaveLength(2);
    expect(inside.find((span) => along(span, V, TIP))?.direction).toBe('valley');
    expect(inside.find((span) => along(span, V, CORNER))?.direction).toBe('mountain');
  });

  it('draws a pinch as its crease and the rest of its line across the paper dotted, the two apart', async () => {
    const calls = await engine();
    const sheet = landed(calls.sheet(SQUARE_PAPER)).state;
    // The square folded in half along its diagonal: the bottom-right triangle, two layers.
    const half = stepOf(calls, sheet, { kind: 'valley', line: { via: 'free', through: [[0, 0], [1, 1]] }, moving: [0.1, 0.9], seed: all });
    // Pinched where the other diagonal crosses the triangle's middle, both layers.
    const op: FoldOp = {
      kind: 'precrease', direction: 'valley', line: { via: 'free', through: [[1, 0], [0.5, 0.5]] }, moving: [0.9, 0.6], seed: all,
      extent: { kind: 'pinch', at: pt(0.75, 0.25), length: 0.1 },
    };
    const pinch = stepOf(calls, half.state, op);
    const placed = foldStepAction(pinch.action, { op, parent: pinch.parent, child: pinch.child });
    // The pinch as the engine draws it: its line is the mark.
    expect(placed.spans).toEqual(pinch.action.spans);
    const [a, b] = pinch.action.line!;
    expect(length(a, b)).toBeCloseTo(0.1, 6);
    // The rest, either side of it, across the triangle: from its edge to the diagonal, √½ in all.
    const rest = placed.uncreased!;
    expect(rest).toHaveLength(2);
    const u = { x: (b.x - a.x) / length(a, b), y: (b.y - a.y) / length(a, b) };
    const t = (p: Point) => (p.x - a.x) * u.x + (p.y - a.y) * u.y;
    for (const stretch of rest) {
      // On the pinch's line, and clear of it.
      for (const end of [stretch.from, stretch.to]) expect(Math.abs((end.x - a.x) * u.y - (end.y - a.y) * u.x)).toBeLessThan(1e-9);
      const [lo, hi] = [t(stretch.from), t(stretch.to)].sort((x, y) => x - y) as [number, number];
      expect(hi <= 1e-9 || lo >= length(a, b) - 1e-9).toBe(true);
    }
    const total = rest.reduce((sum, stretch) => sum + length(stretch.from, stretch.to), 0) + length(a, b);
    expect(total).toBeCloseTo(Math.SQRT1_2, 6);
    const marks = foldStepPicture(
      { shown: pinch.parent, own: { scene: pinch.child, step: pinch.summary.step, sheet: pinch.summary.sheet }, moment: 'before', action: placed },
      FOLD_PULL_RENDER
    ).marks;
    expect(marks.map((mark) => mark.kind).sort()).toEqual(['fold-unfold-arrow', 'uncreased-line', 'uncreased-line', 'valley-line']);
  });

  it('draws no crease the viewer cannot see, in any step of the examples', async () => {
    const calls = await engine();
    let lines = 0;
    for (const name of ['petal-fold.osf', 'swivel-fold.osf', 'swivel-on-edge.osf', 'swivel-inside.osf', 'crimp.osf']) {
      for (const step of exampleSteps(calls, name)) {
        const placed = step.action && foldStepAction(step.action, { op: step.op, parent: step.parent, child: step.child });
        expect(placed?.spans.some((span) => span.hidden) ?? false).toBe(false);
        const marks = foldStepPicture(
          { shown: step.parent, own: { scene: step.child, step: step.summary.step, sheet: step.summary.sheet }, moment: 'before', action: placed },
          FOLD_PULL_RENDER
        ).marks;
        expect(marks.some((mark) => mark.kind === 'hidden-line'), `${name} step ${step.summary.step}`).toBe(false);
        lines += marks.filter((mark) => mark.kind === 'valley-line' || mark.kind === 'mountain-line').length;
      }
    }
    expect(lines).toBeGreaterThan(20);
  });

  it('circles a segment through two points at its ends and draws no arrow; a point onto a point circled and joined', async () => {
    const calls = await engine();
    const sheet = landed(calls.sheet(SQUARE_PAPER)).state;
    const segment: FoldOp = {
      kind: 'precrease', direction: 'valley', line: { via: 'axiom', axiom: 1, inputs: [pt(1, 1), pt(0.5, 0)] },
      moving: [0.9, 0.2], seed: all, extent: { kind: 'segment', from: pt(1, 1), to: pt(0.5, 0) },
    };
    const one = stepOf(calls, sheet, segment);
    const drawn = foldStepAction(one.action, { op: segment, parent: one.parent, child: one.child });
    expect(drawn.grip).toBeNull();
    expect(drawn.rings).toHaveLength(2);
    expect(drawn.rings!.some((ring) => near(ring.at, at(one.parent, 1, 1)))).toBe(true);
    expect(drawn.rings!.some((ring) => near(ring.at, at(one.parent, 0.5, 0)))).toBe(true);
    const marks = foldStepPicture({ shown: one.parent, own: { scene: one.child, step: 1, sheet: one.summary.sheet }, moment: 'before', action: drawn }, FOLD_PULL_RENDER).marks;
    expect(marks.map((mark) => mark.kind)).toEqual(['valley-line', 'circle', 'circle']);

    // The bottom-left corner onto the middle: both circled, the arrow from one to the other.
    const corner: FoldOp = { kind: 'valley', line: { via: 'axiom', axiom: 2, inputs: [pt(0, 0), pt(0.5, 0.5)] }, seed: all };
    const two = stepOf(calls, sheet, corner);
    const placed = foldStepAction(two.action, { op: corner, parent: two.parent, child: two.child });
    expect(near(placed.grip!.at, at(two.parent, 0, 0))).toBe(true);
    expect(near(placed.grip!.image, at(two.parent, 0.5, 0.5))).toBe(true);
    expect(placed.rings!.map((ring) => ring.at)).toEqual([placed.grip!.at, placed.grip!.image]);
    // The corner lands on top: nothing over it there.
    expect(placed.grip!.hidden_image).toBe(0);
  });

  it('puts a bisector’s arrow halfway along the shorter edge, and a parallel one from line to line', async () => {
    const calls = await engine();
    const sheet = landed(calls.sheet(SQUARE_PAPER)).state;
    const diagonal = stepOf(calls, sheet, { kind: 'precrease', direction: 'valley', line: { via: 'axiom', axiom: 2, inputs: [pt(0, 0), pt(1, 1)] }, seed: all });
    // The right edge onto the diagonal from the bottom-right corner: the bisector of its 45°.
    const kite: FoldOp = {
      kind: 'precrease', direction: 'valley', line: { via: 'axiom', axiom: 3, inputs: [edge([1, 0], [1, 1]), edge([1, 0], [0, 1])] },
      moving: [0.95, 0.5], seed: all,
    };
    const bisector = stepOf(calls, diagonal.state, kite, [Math.cos(Math.PI / 8), Math.sin(Math.PI / 8)]);
    const placed = foldStepAction(bisector.action, { op: kite, parent: bisector.parent, child: bisector.child });
    // The edge is 1 long and the diagonal √2: halfway along the edge from the corner, onto the diagonal as far out.
    expect(near(placed.grip!.at, at(bisector.parent, 1, 0.5))).toBe(true);
    expect(near(placed.grip!.image, at(bisector.parent, 1 - 0.5 * Math.SQRT1_2, 0.5 * Math.SQRT1_2))).toBe(true);
    expect(length(placed.grip!.at, placed.grip!.image)).toBeGreaterThan(length(bisector.action.grip!.at, bisector.action.grip!.image));

    // The bottom edge onto the top: from one to the other, the whole way.
    const book: FoldOp = {
      kind: 'precrease', direction: 'valley', line: { via: 'axiom', axiom: 3, inputs: [edge([0, 0], [1, 0]), edge([0, 1], [1, 1])] },
      moving: [0.5, 0.1], seed: all,
    };
    const parallel = stepOf(calls, sheet, book);
    const across = foldStepAction(parallel.action, { op: book, parent: parallel.parent, child: parallel.child });
    expect(length(across.grip!.at, across.grip!.image)).toBeCloseTo(1, 6);
    expect(near(across.grip!.at, at(parallel.parent, 0.5, 0))).toBe(true);
  });

  it('draws every crease a Repeat of several operations made as the instruction of its crease pattern', async () => {
    const calls = await engine();
    const sheet = landed(calls.sheet(SQUARE_PAPER));
    const ops: FoldOp[] = [
      { kind: 'valley', line: { via: 'free', through: [[0, 0.4], [0.4, 0]] }, moving: [0.05, 0.05], seed: all },
      { kind: 'valley', line: { via: 'free', through: [[0.6, 0], [1, 0.4]] }, moving: [0.95, 0.05], seed: all },
    ];
    const steps: RepeatSourceStep[] = [];
    let current = sheet.state;
    for (const [index, op] of ops.entries()) {
      const next = landed(calls.step(current, op));
      steps.push({ id: `source-${index}`, before: current, after: next.state, op });
      current = next.state;
    }
    const recipe = prepareRepeat(calls, { parent: current, steps, axis: { n: [0, 1], d: 0.5 }, source: { first: 'source-0', last: 'source-1', revision: 'test' } });
    if (recipe.status !== 'ready') throw new Error(JSON.stringify(recipe));
    const before = calls.summary(current).step;
    const repeated = landed(calls.step(current, recipe.op));
    const scene = calls.scene(repeated.state);
    const { step } = repeated.summary;
    expect(step - before).toBe(2);
    const instructions = (since?: number) =>
      creasePatternPaperScene(scene, { display: FOLD_PANE_DISPLAY_DEFAULT, sheet: repeated.summary.sheet, step, ...(since !== undefined ? { since } : {}) })
        .items.filter((item) => item.kind === 'line' && item.role.startsWith('diagram-')).length;
    // Its last operation's crease alone, as `made_at === step` drew it; both, from the state before it.
    expect(instructions()).toBe(1);
    expect(instructions(before)).toBe(2);
    const page = foldStepCreaseDiagram(scene.creases, repeated.summary.sheet, step, before);
    expect(page.primitives.filter((primitive) => primitive.kind === 'line' && primitive.style === 'valley')).toHaveLength(2);
  });
});
