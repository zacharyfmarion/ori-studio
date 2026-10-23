import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNativeProjectFile } from '../../lib/nativeProjectFile';
import { createFoldEngineCalls } from '../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls } from '../engine/foldEngineCompoundCalls';
import {
  isLockedStep,
  type FoldChoices,
  type FoldModelLine,
  type FoldOp,
  type FoldSequenceDocument,
  type FoldStep,
} from '../document/foldSequenceDocument';
import { readFoldSequences } from '../document/foldSequenceFile';
import { polygonCentroid, toPair } from '../canvas/foldCanvasGeometry';
import { prepareRepeat, type RepeatSourceStep } from './repeatPreparation';
import { correspondingFrame, reflection, repeatSymmetries, sheetRing, verifiedSymmetry } from './repeatGeometry';
import { verifyMaterial } from './repeatVerification';

const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const EXAMPLES = resolve(ROOT, '../../tests/fixtures/fold-examples');
const REGRESSION = resolve(ROOT, '../../tests/fixtures/fold-regressions/repeat-behind-diagonal.osf');
const CRANE = '/Users/zacharymarion/Documents/open source/origami-designer/test_files/folding/crane_new.osf';

type Engine = Awaited<ReturnType<typeof engine>>;

async function engine() {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const raw = new wasm.FoldEngine();
  return { ...createFoldEngineCalls(raw), ...createFoldEngineCompoundCalls(raw) };
}

function opened(path: string): FoldSequenceDocument {
  const project = parseNativeProjectFile(readFileSync(path, 'utf8'));
  const [held] = readFoldSequences(project.workspace.foldSequences);
  if (!held) throw new Error('no sequence');
  return held.document;
}

/** The sequence's one path, folded: its steps, each with the states before and after it. */
/** Replays the document's steps, through index `last` when given (an owner's copy may go on past what a test needs). */
function replayed(e: Engine, document: FoldSequenceDocument, last?: number): { steps: FoldStep[]; states: number[] } {
  const all = document.steps.filter((s): s is FoldStep => !isLockedStep(s));
  const steps = last === undefined ? all : all.slice(0, last + 1);
  const sheet = e.sheet(document.paper);
  if (sheet.status !== 'ok') throw new Error('sheet');
  const states = [sheet.state];
  for (const [i, step] of steps.entries()) {
    expect(step.parent, `${document.title}: one path`).toBe(i === 0 ? null : steps[i - 1]!.id);
    const r = e.step(states.at(-1)!, step.op, step.choices);
    if (r.status !== 'ok') throw new Error(`${step.op.kind}: ${JSON.stringify(r)}`);
    expect(r.fingerprint, `${step.op.kind} replays to its stored fingerprint`).toBe(step.expect);
    states.push(r.state);
  }
  return { steps, states };
}

/** Steps `from`..`to` (0-based, inclusive) as a repeat's source. */
function source(steps: FoldStep[], states: number[], from: number, to: number): RepeatSourceStep[] {
  return steps.slice(from, to + 1).map((step, k) => ({
    id: step.id,
    op: step.op,
    ...(step.choices ? { choices: step.choices } : {}),
    before: states[from + k]!,
    after: states[from + k + 1]!,
  }));
}

/** Fold `ops` from `state` in turn; the last state. */
function fold(e: Engine, state: number, ops: readonly (FoldOp | { op: FoldOp; choices?: FoldChoices })[]): number {
  let current = state;
  for (const each of ops) {
    const { op, choices } = 'op' in each ? each : { op: each, choices: undefined };
    const r = e.step(current, op, choices);
    if (r.status !== 'ok') throw new Error(`${op.kind}: ${JSON.stringify(r)}`);
    current = r.state;
  }
  return current;
}

const behindAxis = (e: Engine, state: number): FoldModelLine => {
  const behind = repeatSymmetries(e.scene(state), e.summary(state).sheet).filter((axis) => axis.side === 'behind');
  expect(behind).toHaveLength(1);
  return behind[0]!.sheet;
};

describe.skipIf(!existsSync(WASM))('the repeat-behind regression (tests/fixtures/fold-regressions)', () => {
  it('replays the saved repeat behind across the diagonal, and prepares it again the same, every mirrored step passing', async () => {
    const e = await engine();
    const document = opened(REGRESSION);
    const { steps, states } = replayed(e, document);
    const saved = steps.at(-1)!.op;
    if (saved.kind !== 'repeat') throw new Error('the last step is no repeat');
    expect(saved.side).toBe('behind');
    // The diagonal from the bottom left corner to the top right, as the crease pattern shows the sheet.
    expect(Math.abs(saved.axis.n[0] + saved.axis.n[1]) < 1e-9 && Math.abs(saved.axis.d) < 1e-9).toBe(true);
    // What Repeat refused before: the diagonal takes the model to itself, every layer pair reversed — no reflection.
    const start = states[5]!;
    const frame = correspondingFrame(e.scene(start), e.scene(start), reflection(saved.axis), toPair(polygonCentroid(sheetRing(e.scene(start), 0))));
    expect(frame.map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([1, 0, 0, 0, 1, 0]);
    expect(verifiedSymmetry(e.scene(start), saved.axis)).toEqual({ sheet: saved.axis, side: 'behind' });
    // Offered, and prepared again from its source steps: behind, each mirror as predicted and passing Repeat's test.
    const prepared = prepareRepeat(e, {
      parent: states[8]!,
      axis: behindAxis(e, start),
      steps: source(steps, states, 5, 7),
      source: saved.source,
    });
    if (prepared.status !== 'ready') throw new Error(JSON.stringify(prepared));
    expect(prepared.op.side).toBe('behind');
    expect(prepared.matched).toEqual([0, 0, 0]);
    expect(prepared.op.steps.map((step) => step.expect)).toEqual(saved.steps.map((step) => step.expect));
    // Each saved step, folded again from the one before it, is the mirror of its source on the paper.
    let before = states[8]!;
    for (const [k, entry] of saved.steps.entries()) {
      const landed = e.step(before, entry.op, entry.choices);
      if (landed.status !== 'ok') throw new Error(JSON.stringify(landed));
      expect(() =>
        verifyMaterial(e.scene(states[5 + k]!), e.scene(states[6 + k]!), e.scene(before), e.scene(landed.state), reflection(saved.axis), 'behind')
      ).not.toThrow();
      before = landed.state;
    }
  });
});

describe.skipIf(!existsSync(WASM))('Repeat behind', () => {
  it.skipIf(!existsSync(CRANE))(
    "repeats crane_new's front kite precreases and petal fold behind, across the bottom-left to top-right diagonal, as the same steps folded on the back by hand",
    async () => {
      const e = await engine();
      // The front flap's kites and petal, wherever the owner's copy has them now (it is edited over time),
      // replayed through the petal only: later steps are the owner's, not this test's.
      const document = opened(CRANE);
      const listed = document.steps.filter((s): s is FoldStep => !isLockedStep(s));
      const k = listed.findIndex((_, i) => listed.slice(i, i + 3).map((step) => step.op.kind).join() === 'precrease,precrease,petal');
      expect(k).toBeGreaterThanOrEqual(0);
      const { steps, states } = replayed(e, document, k + 2);
      const start = states[k]!;
      const axes = repeatSymmetries(e.scene(start), e.summary(start).sheet);
      const diagonal = axes.find((axis) => Math.abs(axis.sheet.n[0] + axis.sheet.n[1]) < 1e-9 && Math.abs(axis.sheet.d) < 1e-9);
      expect(diagonal?.side).toBe('behind');
      // The other diagonal mirrors the front flap onto itself: the other side of it.
      expect(axes.find((axis) => axis !== diagonal)?.side).toBe('same');
      const parent = states[k + 3]!;
      const prepared = prepareRepeat(e, {
        parent,
        axis: diagonal!.sheet,
        steps: source(steps, states, k, k + 2),
        source: { first: steps[k]!.id, last: steps[k + 2]!.id, revision: 'test' },
      });
      if (prepared.status !== 'ready') throw new Error(JSON.stringify(prepared));
      expect(prepared.op.side).toBe('behind');
      // Every mirror passed as predicted, folded the other way as the viewer sees it.
      expect(prepared.matched).toEqual([0, 0, 0]);
      expect(prepared.op.steps.map((step) => ('direction' in step.op ? step.op.direction : null))).toEqual(['mountain', 'mountain', 'mountain']);

      // By hand: turn over, the same three folds on the back flap, turn back.
      const mirror = ([x, y]: readonly [number, number]) => [y, x] as const;
      const [kiteA, kiteB, petal] = steps.slice(k, k + 3).map((step) => step.op);
      if (kiteA?.kind !== 'precrease' || kiteB?.kind !== 'precrease' || petal?.kind !== 'petal' || !('ends' in petal)) throw new Error('kinds');
      const turned = fold(e, parent, [{ kind: 'turn', axis: 'vertical' }]);
      /** A kite precrease on the back, its root the one whose crease is the mirrored one. */
      const kite = (op: typeof kiteA, at: number, sourceAfter: number): number => {
        if (op.line.via !== 'axiom') throw new Error('axiom');
        const line = { ...op.line, inputs: op.line.inputs.map((input) => (input.kind === 'edge' ? { kind: 'edge' as const, a: mirror(input.a), b: mirror(input.b) } : input)) };
        const seed = op.seed.scope === 'flaps' ? { scope: 'flaps' as const, at: op.seed.at.map(mirror) } : op.seed;
        const roots = e.axiomCandidates(at, line);
        if (roots.status !== 'ok') throw new Error('roots');
        const wanted = newest(e, sourceAfter).map(([a, b]) => [mirror(a), mirror(b)] as const);
        for (const root of roots.candidates) {
          const r = e.step(at, { ...op, line, seed, direction: 'valley' }, { root: root.line });
          if (r.status === 'ok' && sameSegments(newest(e, r.state), wanted)) return r.state;
        }
        throw new Error('no root folds the mirrored kite');
      };
      const a = kite(kiteA, turned, states[k + 1]!);
      const b = kite(kiteB, a, states[k + 2]!);
      const petalled = fold(e, b, [{ kind: 'petal', ends: [mirror(petal.ends[0]), mirror(petal.ends[1])], petal: mirror(petal.petal), direction: 'valley' }]);
      const byHand = fold(e, petalled, [{ kind: 'turn', axis: 'vertical' }]);
      expect(e.fingerprint(byHand)).toBe(prepared.op.steps.at(-1)!.expect);
    }
  );

  // petal-fold.osf, made with the tools: the squash on the front, turned
  // over, the squash on the back; then the kites and petal fold on the
  // front, turned over, and the same on the back. Each back half, turned
  // back, is the front half repeated behind.
  it.each([
    { what: 'the squash', range: [2, 2], byHand: [3, 4] },
    { what: 'the kite precreases and the petal fold', range: [5, 7], byHand: [8, 11] },
  ])("repeats petal-fold.osf's $what behind as the author folded it on the back", async ({ range, byHand }) => {
    const e = await engine();
    const { steps, states } = replayed(e, opened(resolve(EXAMPLES, 'petal-fold.osf')));
    const [from, to] = range as [number, number];
    const parent = states[to + 1]!;
    expect(states[byHand[0]!]).toBe(parent);
    const prepared = prepareRepeat(e, {
      parent,
      axis: behindAxis(e, states[from]!),
      steps: source(steps, states, from, to),
      source: { first: steps[from]!.id, last: steps[to]!.id, revision: 'test' },
    });
    if (prepared.status !== 'ready') throw new Error(JSON.stringify(prepared));
    expect(prepared.op.side).toBe('behind');
    expect(prepared.matched.every((variant) => variant === 0)).toBe(true);
    const author = states[byHand[1]! + 1]!;
    const turnedBack = fold(e, author, [{ kind: 'turn', axis: 'vertical' }]);
    expect(e.fingerprint(turnedBack)).toBe(prepared.op.steps.at(-1)!.expect);
  });

  describe.skipIf(!existsSync(CRANE))("on crane_new's preliminary base", () => {
    const diagonal: FoldModelLine = { n: [Math.SQRT1_2, -Math.SQRT1_2], d: 0 };
    const mirror = ([x, y]: readonly [number, number]) => [y, x] as const;
    /** The front flap's bottom corner, folded up along the line through two points on its raw edges. */
    const corner = (kind: 'valley' | 'mountain', flip = false): FoldOp => {
      const at = (p: readonly [number, number]) => (flip ? mirror(p) : p);
      return { kind, line: { via: 'free', through: [at([0, 0.75]), at([0.25, 1])] }, seed: { scope: 'flaps', at: [at([0.05, 0.9])] }, landing: { kind: 'outer' } };
    };

    it('repeats a valley on the front flap behind as the same valley folded on the back by hand', async () => {
      const e = await engine();
      const { states } = replayed(e, opened(CRANE), 9); // through the preliminary base (states[10])
      const prelim = states[10]!;
      const op = corner('valley');
      const after = fold(e, prelim, [op]);
      const prepared = prepareRepeat(e, { parent: after, axis: diagonal, steps: [{ id: 'v', op, before: prelim, after }], source: { first: 'v', last: 'v', revision: 'test' } });
      if (prepared.status !== 'ready') throw new Error(JSON.stringify(prepared));
      expect(prepared.matched).toEqual([0]);
      expect(prepared.op.steps[0]!.op.kind).toBe('mountain');
      const byHand = fold(e, after, [{ kind: 'turn', axis: 'vertical' }, corner('valley', true), { kind: 'turn', axis: 'vertical' }]);
      expect(e.fingerprint(byHand)).toBe(prepared.op.steps[0]!.expect);
    });

    it('repeats a mountain on the back flap behind, onto the front flap, as the valley folded there by hand', async () => {
      const e = await engine();
      const { states } = replayed(e, opened(CRANE), 9); // through the preliminary base (states[10])
      const prelim = states[10]!;
      const op = corner('mountain', true);
      const after = fold(e, prelim, [op]);
      const prepared = prepareRepeat(e, { parent: after, axis: diagonal, steps: [{ id: 'm', op, before: prelim, after }], source: { first: 'm', last: 'm', revision: 'test' } });
      if (prepared.status !== 'ready') throw new Error(JSON.stringify(prepared));
      expect(prepared.matched).toEqual([0]);
      expect(prepared.op.steps[0]!.op.kind).toBe('valley');
      expect(e.fingerprint(fold(e, after, [corner('valley')]))).toBe(prepared.op.steps[0]!.expect);
    });
  });

  it.skipIf(!existsSync(CRANE))(
    "repeats an inside reverse fold of a waterbomb base's front flap behind as the same reverse fold made on the back by hand",
    async () => {
      const e = await engine();
      const { states } = replayed(e, opened(CRANE), 9); // through the preliminary base (states[10])
      // crane_new's precreases, then a book fold and its two top corners reversed in: a waterbomb base.
      const waterbomb = fold(e, states[7]!, [
        { kind: 'valley', line: { via: 'free', through: [[0, 0.5], [1, 0.5]] }, moving: [0.5, 0.9], seed: { scope: 'all' }, landing: { kind: 'outer' } },
        { kind: 'inside-reverse', line: { via: 'free', through: [[0.5, 0.5], [0.2, 0.8]] }, moving: [0.05, 0.9], seed: { scope: 'all' } },
        { kind: 'inside-reverse', line: { via: 'free', through: [[0.5, 0.5], [0.8, 0.8]] }, moving: [0.95, 0.9], seed: { scope: 'all' } },
      ]);
      const axis = behindAxis(e, waterbomb);
      expect(axis).toEqual({ n: [0, 1], d: 0.5 });
      const flip = ([x, y]: readonly [number, number]) => [x, 1 - y] as const;
      const reverse = (at: (p: readonly [number, number]) => readonly [number, number]): FoldOp => ({
        kind: 'inside-reverse',
        line: { via: 'free', through: [at([0, 0.75]), at([0.125, 0.875])] },
        moving: at([0.03, 0.95]),
        seed: { scope: 'flaps', at: [at([0.03, 0.95])] },
      });
      const op = reverse((p) => p);
      const after = fold(e, waterbomb, [op]);
      const prepared = prepareRepeat(e, { parent: after, axis, steps: [{ id: 'r', op, before: waterbomb, after }], source: { first: 'r', last: 'r', revision: 'test' } });
      if (prepared.status !== 'ready') throw new Error(JSON.stringify(prepared));
      expect(prepared.matched).toEqual([0]);
      const byHand = fold(e, after, [{ kind: 'turn', axis: 'vertical' }, reverse(flip), { kind: 'turn', axis: 'vertical' }]);
      expect(e.fingerprint(byHand)).toBe(prepared.op.steps[0]!.expect);
    }
  );
});

type Segment = readonly [readonly [number, number], readonly [number, number]];

/** The creases the step that landed `state` made, as sheet segments. */
function newest(e: Engine, state: number): Segment[] {
  const scene = e.scene(state);
  const all = [...scene.creases.filter((c) => c.kind !== 'border'), ...(scene.crease_marks ?? [])];
  const last = Math.max(...all.map((c) => c.made_at));
  return all.filter((c) => c.made_at === last).map((c) => [[c.from.x, c.from.y], [c.to.x, c.to.y]] as const);
}

function sameSegments(a: readonly Segment[], b: readonly Segment[]): boolean {
  const near = (p: readonly [number, number], q: readonly [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
  const same = (s: Segment, t: Segment) => (near(s[0], t[0]) && near(s[1], t[1])) || (near(s[0], t[1]) && near(s[1], t[0]));
  return a.length === b.length && a.every((s) => b.some((t) => same(s, t)));
}
