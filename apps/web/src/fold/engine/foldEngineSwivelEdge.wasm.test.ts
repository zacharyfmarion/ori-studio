import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createFoldReplayer } from '../document/foldReplay';
import { sequenceOf, step } from '../document/foldSequence.fixtures';
import {
  isLockedStep,
  withSwivelKind,
  type FoldPrecreaseOp,
  type FoldSequenceDocument,
  type FoldSwivelEdgeOp,
  type FoldSwivelOnFoldOp,
} from '../document/foldSequenceDocument';
import { readFoldSequence, writeFoldSequence } from '../document/foldSequenceFile';
import { createFoldEngineCalls, type FoldEngineCalls } from './foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from './foldEngineCompoundCalls';
import { createFoldEnginePort, type FoldEngineSource } from './foldEnginePort';
import { createFoldEngineVertexCalls, type FoldEngineVertexCalls } from './foldEngineSquashCalls';
import type { FoldSwivelEdgeAnalysis } from './foldEngineSquashWire';
import type { FoldEngineOutcome } from './foldEngineWire';

/**
 * The swivel's edge form (`FoldSwivelEdgeOp`, engine `compound::swivel`)
 * over the real bridge, in-process: the document op crosses as it is stored,
 * the compound question answers `swivel-by-edge` (its vertex, its creases
 * with their letters as the diagram pens draw them, where the edge lands,
 * its ridges and which land), a stored step lands through `step` with its
 * ridge as stored, a saved sequence replays to `ok`, and one that does not
 * read is locked rather than folded.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const FOLD_WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(FOLD_WASM);

interface Engine {
  calls: FoldEngineCalls;
  vertex: FoldEngineVertexCalls;
  question: FoldEngineCompoundCalls;
  version: number;
}

async function makeEngine(): Promise<Engine> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(FOLD_WASM) });
  const fold = new wasm.FoldEngine();
  return {
    calls: createFoldEngineCalls(fold),
    vertex: createFoldEngineVertexCalls(fold),
    question: createFoldEngineCompoundCalls(fold),
    version: wasm.fold_engine_version(),
  };
}

function landed<T>(outcome: FoldEngineOutcome<T>): T {
  if (outcome.status !== 'ok') throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome;
}

/** The square's diagonal a c precreased: a centre crease to swivel an edge onto. */
const diagonal: FoldPrecreaseOp = {
  kind: 'precrease',
  line: {
    via: 'free',
    through: [
      [0, 0],
      [1, 1],
    ],
  },
  direction: 'valley',
  moving: [0, 1],
  seed: { scope: 'all' },
};

/** The bottom edge onto the diagonal, pivoting on the bisector from a past the incenter. */
const swivel: FoldSwivelEdgeOp = {
  kind: 'swivel',
  via: 'edge',
  pivot: [0.8, 0.8 * Math.tan(Math.PI / 8)],
  edge: [0.5, 0],
  target: { via: 'crease', at: [0.5, 0.5] },
  seed: { scope: 'all' },
  direction: 'valley',
};

describe.skipIf(!available)('the swivel’s edge form over the bridge', () => {
  let engine: Engine;
  let parent: number;

  beforeAll(async () => {
    engine = await makeEngine();
    const sheet = landed(engine.calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    parent = landed(engine.calls.step(sheet, diagonal)).state;
  });

  function question(op: FoldSwivelEdgeOp): { analysis: FoldSwivelEdgeAnalysis; emergents: boolean[] } {
    const answer = landed(engine.question.compoundAnalysis(parent, op));
    if (answer.family !== 'vertex') throw new Error(`answered for ${answer.family}`);
    if (answer.analysis.kind !== 'swivel-by-edge') throw new Error(`answered as ${answer.analysis.kind}`);
    return { analysis: answer.analysis, emergents: answer.emergents };
  }

  it('answers the compound question: the vertex, the creases with their letters, the landing, the ridges', () => {
    const { analysis, emergents } = question(swivel);
    expect(analysis.creases.map((crease) => crease.ray)).toEqual(['meet', 'foot', 'end', 'hinge']);
    expect(analysis.creases.map((crease) => crease.letter)).toEqual(['valley', 'mountain', 'valley', 'valley']);
    expect(analysis.creases.map((crease) => crease.ridge)).toEqual([false, true, false, false]);
    // The vertex is on the bisector from a, y = x·tan 22.5°.
    const [x, y] = analysis.vertex;
    expect(y).toBeCloseTo(x * Math.tan(Math.PI / 8), 12);
    // The edge lands on the diagonal.
    for (const [p, q] of analysis.landed) {
      expect(p[0]).toBeCloseTo(p[1], 9);
      expect(q[0]).toBeCloseTo(q[1], 9);
    }
    expect(analysis.ridges).toHaveLength(2);
    expect(analysis.ridge).toBe(0);
    expect(emergents).toEqual([true, true]);
    expect(analysis.regions.map((region) => region.wedge).sort()).toEqual(['beyond', 'near', 'turn']);
  });

  it('lands a stored step through `step` and the tools’ call alike, its ridge as stored', () => {
    const step = landed(engine.calls.step(parent, swivel));
    expect(step.compound?.family).toBe('vertex');
    const tried = landed(engine.vertex.vertexFold(parent, swivel));
    if (tried.result !== 'landed') throw new Error('a choice of orders');
    expect(tried.fingerprint).toBe(step.fingerprint);
    const { analysis } = question(swivel);
    const other = analysis.ridges[1];
    if (!other) throw new Error('no second ridge');
    const byEnd = landed(engine.calls.step(parent, { ...swivel, ridge: other }));
    expect(byEnd.fingerprint).not.toBe(step.fingerprint);
    expect(question({ ...swivel, ridge: other }).analysis.creases.map((crease) => crease.letter)).toEqual([
      'valley',
      'valley',
      'mountain',
      'valley',
    ]);
  });

  it('refuses by code: a point on no edge names the point', () => {
    const outcome = engine.calls.step(parent, { ...swivel, edge: [0.5, 0.3] });
    if (outcome.status !== 'refused') throw new Error('landed');
    expect(outcome.refusal).toEqual({ code: 'swivel_not_an_edge', point: [0.5, 0.3] });
  });

  it('replays a saved sequence to ok, and locks rather than folds an edge form that does not read', async () => {
    const document = sequenceOf([step('a', null, diagonal), step('b', 'a', swivel)]);
    const saved = JSON.parse(JSON.stringify(writeFoldSequence({ document, readOnlyRaw: null }))) as unknown;
    const opened = readFoldSequence(saved);
    if (!opened) throw new Error('no sequence');
    expect(opened.document.steps.map(isLockedStep)).toEqual([false, false]);
    const replayed = await replay(opened.document);
    expect(replayed.steps.get('b')?.status).toBe('ok');

    const broken = JSON.parse(JSON.stringify(saved)) as { steps: { op: Record<string, unknown> }[] };
    const second = broken.steps[1];
    if (!second) throw new Error('no second step');
    second.op.target = { via: 'axiom', axiom: 1, inputs: [] };
    const reopened = readFoldSequence(broken);
    if (!reopened) throw new Error('no sequence');
    expect(reopened.document.steps.map(isLockedStep)).toEqual([false, true]);
    const locked = await replay(reopened.document);
    expect(locked.steps.get('a')?.status).toBe('ok');
    expect(locked.steps.get('b')?.status).toBe('locked');
  });

  async function replay(document: FoldSequenceDocument) {
    const calls = engine.calls;
    const source: FoldEngineSource = {
      generation: () => 0,
      sheet: async (paper) => calls.sheet(paper),
      step: async (state, op, choices) => calls.step(state, op, choices),
      release: async (states) => calls.release(states),
    };
    const replayed = await createFoldReplayer(createFoldEnginePort(source, engine.version)).run({
      loadId: 1,
      sequence: document,
    });
    if (!replayed) throw new Error('the replay was superseded');
    expect(replayed.done).toBe(true);
    return replayed;
  }
});

/**
 * The swivel on a folded edge (`FoldSwivelOnFoldOp`, engine
 * `compound::swivel_on_edge`) over the real bridge: the kite base's right
 * edge above its kite crease onto the diagonal, the creases meeting on that
 * kite crease. Its question names the folded edge, three creases and no
 * ridge, and the directions that land; it lands through `step` and the
 * tools' call alike, and a saved sequence replays to `ok`.
 */
describe.skipIf(!available)('the swivel on a folded edge over the bridge', () => {
  const t = Math.tan(Math.PI / 8);
  const kiteFold = (through: [number, number], moving: [number, number]) => ({
    kind: 'valley' as const,
    line: { via: 'free' as const, through: [[0, 0], through] as [[number, number], [number, number]] },
    moving,
    seed: { scope: 'all' as const },
  });
  const right = kiteFold([1, t], [1, 0]);
  const left = kiteFold([t, 1], [0, 1]);
  const onFold: FoldSwivelOnFoldOp = {
    kind: 'swivel',
    via: 'edge',
    fold: [0.5, t / 2],
    edge: [1, (t + 1) / 2],
    target: { via: 'crease', at: [0.5, 0.5] },
    direction: 'valley',
  };
  let engine: Engine;
  let kite: number;

  beforeAll(async () => {
    engine = await makeEngine();
    const sheet = landed(engine.calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    const precreased = landed(engine.calls.step(sheet, diagonal)).state;
    kite = landed(engine.calls.step(landed(engine.calls.step(precreased, right)).state, left)).state;
  });

  it('answers the question with the folded edge, three creases, no ridge, and the directions that land', () => {
    const answer = landed(engine.question.compoundAnalysis(kite, onFold));
    if (answer.family !== 'vertex' || answer.analysis.kind !== 'swivel-by-edge') throw new Error('not a swivel');
    const { analysis } = answer;
    expect(analysis.fold?.faces).toHaveLength(2);
    expect(analysis.creases.map((crease) => [crease.ray, crease.letter])).toEqual([
      ['meet', 'valley'],
      ['meet', 'mountain'],
      ['hinge', 'valley'],
    ]);
    expect(analysis.ridges).toEqual([]);
    // The vertex where the bisector from c crosses the kite crease: (1/√2, 1 − 1/√2).
    expect(analysis.vertex[0]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(analysis.vertex[1]).toBeCloseTo(1 - Math.SQRT1_2, 9);
    expect(answer.directions).toEqual([true, false]);
    expect(analysis.regions.map((region) => region.wedge).sort()).toEqual(['beyond', 'near', 'turn']);
  });

  it('lands through `step` and the tools’ call alike, and replays saved', async () => {
    const selected = landed(engine.question.orderSelection(kite, onFold, undefined, { index: 0 }));
    expect(selected.count).toEqual({ orders: 2, exact: true });
    if (!selected.completion) throw new Error('the open swivel needs an order');
    const choices = { completion: selected.completion };
    expect(engine.calls.step(kite, onFold).status).toBe('refused');
    const folded = landed(engine.calls.step(kite, onFold, choices));
    expect(folded.compound?.family).toBe('vertex');
    const tried = landed(engine.vertex.vertexFold(kite, onFold, choices));
    if (tried.result !== 'landed') throw new Error('a choice of orders');
    expect(tried.fingerprint).toBe(folded.fingerprint);
    const document = sequenceOf([
      step('a', null, diagonal),
      step('b', 'a', right),
      step('c', 'b', left),
      step('d', 'c', onFold, { choices }),
    ]);
    const saved = JSON.parse(JSON.stringify(writeFoldSequence({ document, readOnlyRaw: null }))) as unknown;
    const opened = readFoldSequence(saved);
    if (!opened) throw new Error('no sequence');
    expect(opened.document.steps.map(isLockedStep)).toEqual([false, false, false, false]);
    const calls = engine.calls;
    const source: FoldEngineSource = {
      generation: () => 0,
      sheet: async (paper) => calls.sheet(paper),
      step: async (state, op, choices) => calls.step(state, op, choices),
      release: async (states) => calls.release(states),
    };
    const replayed = await createFoldReplayer(createFoldEnginePort(source, engine.version)).run({
      loadId: 2,
      sequence: opened.document,
    });
    expect(replayed?.steps.get('d')?.status).toBe('ok');
  });

  it('answers which kinds land, and the inside swivel’s letters: the strip folds the other way', () => {
    const inside = withSwivelKind(onFold, 'inside');
    const answer = landed(engine.question.compoundAnalysis(kite, inside));
    if (answer.family !== 'vertex' || answer.analysis.kind !== 'swivel-by-edge') throw new Error('not a swivel');
    expect(answer.kinds).toEqual([
      [true, false],
      [true, false],
    ]);
    expect(answer.directions).toEqual([true, false]);
    expect(answer.analysis.creases.map((crease) => [crease.ray, crease.letter, crease.ridge])).toEqual([
      ['meet', 'valley', false],
      ['meet', 'valley', false],
      ['hinge', 'mountain', true],
    ]);
    // The strip, where it reaches past the flap over the other one, goes over it or under it: two orders.
    expect(answer.orders?.count.orders).toBe(2);
    const open = landed(engine.question.compoundAnalysis(kite, onFold));
    if (open.family !== 'vertex') throw new Error('not a vertex fold');
    expect(open.kinds).toEqual(answer.kinds);
  });

  it('lands the inside swivel with the order it stores, and replays it saved', async () => {
    const inside = withSwivelKind(onFold, 'inside');
    const answer = landed(engine.question.compoundAnalysis(kite, inside));
    if (answer.family !== 'vertex') throw new Error('not a vertex fold');
    const completion = answer.orders?.orders[1];
    if (!completion) throw new Error('no second order');
    const folded = landed(engine.calls.step(kite, inside, { completion }));
    const openOrder = landed(engine.question.orderSelection(kite, onFold, undefined, { index: 0 }));
    if (!openOrder.completion) throw new Error('no open order');
    const opened = landed(engine.calls.step(kite, onFold, { completion: openOrder.completion }));
    expect(folded.fingerprint).not.toBe(opened.fingerprint);
    // Without its order it cannot land: the step must store one.
    expect(engine.calls.step(kite, inside).status).toBe('refused');
    const document = sequenceOf([
      step('a', null, diagonal),
      step('b', 'a', right),
      step('c', 'b', left),
      step('d', 'c', inside, { choices: { completion } }),
    ]);
    const saved = JSON.parse(JSON.stringify(writeFoldSequence({ document, readOnlyRaw: null }))) as {
      steps: { op: Record<string, unknown> }[];
    };
    expect(saved.steps[3]?.op.swivel).toBe('inside');
    const reopened = readFoldSequence(saved);
    if (!reopened) throw new Error('no sequence');
    expect(reopened.document.steps.map(isLockedStep)).toEqual([false, false, false, false]);
    const calls = engine.calls;
    const source: FoldEngineSource = {
      generation: () => 0,
      sheet: async (paper) => calls.sheet(paper),
      step: async (state, op, choices) => calls.step(state, op, choices),
      release: async (states) => calls.release(states),
    };
    const replayed = await createFoldReplayer(createFoldEnginePort(source, engine.version)).run({
      loadId: 3,
      sequence: reopened.document,
    });
    expect(replayed?.steps.get('d')?.status).toBe('ok');
  });
});
