import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createFoldReplayer } from '../document/foldReplay';
import { sequenceOf, step } from '../document/foldSequence.fixtures';
import { readFoldSequence, writeFoldSequence } from '../document/foldSequenceFile';
import {
  SQUARE_PAPER,
  type FoldPaper,
  type FoldPlainOp,
  type FoldRabbitEarOp,
  type FoldSquashOp,
  type FoldStep,
  type FoldSwivelOp,
  type SheetPoint,
} from '../document/foldSequenceDocument';
import { createFoldEngineCalls, type FoldEngineCalls } from './foldEngineCalls';
import { createFoldEnginePort } from './foldEnginePort';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from './foldEngineCompoundCalls';
import {
  compoundStoredChoices,
  type FoldCompoundAnalysisOf,
  type FoldCompoundReport,
  type FoldCompoundReportOf,
} from './foldEngineCompoundWire';
import { createFoldEngineVertexCalls, type FoldEngineVertexCalls } from './foldEngineSquashCalls';
import {
  FOLD_REFUSAL_CODES,
  type FoldEngineOp,
  type FoldEngineOutcome,
  type FoldEngineRefused,
} from './foldEngineWire';

/**
 * The vertex folds over the real bridge, in-process: exactly what
 * `workers/foldSequenceWorker.ts` runs beside the step calls, on one engine.
 *
 * The crates' tests prove the folds natively; what they do not cover is
 * TypeScript's side of the boundary — a document op crossing as it is
 * stored, the compound question tagged `vertex`, a stored one replaying
 * through the ordinary `step` call with its report as the step's
 * `compound`, and a choice held, picked and stored as the document's
 * `completion`, which `step` then replays to the state picked.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const FOLD_WASM = resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(FOLD_WASM);

interface Engine {
  version: number;
  calls: FoldEngineCalls;
  vertex: FoldEngineVertexCalls;
  question: FoldEngineCompoundCalls;
}

async function makeEngine(): Promise<Engine> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(FOLD_WASM) });
  const fold = new wasm.FoldEngine();
  return {
    version: wasm.fold_engine_version(),
    calls: createFoldEngineCalls(fold),
    vertex: createFoldEngineVertexCalls(fold),
    question: createFoldEngineCompoundCalls(fold),
  };
}

function landed<T>(outcome: FoldEngineOutcome<T>): T {
  if (outcome.status !== 'ok') throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome;
}

/** A step's compound report, which must be a vertex fold's. */
function vertexOf(report: FoldCompoundReport | undefined): FoldCompoundReportOf<'vertex'> {
  if (report?.family !== 'vertex') throw new Error(`no vertex report: ${JSON.stringify(report)}`);
  return report;
}

function refused<T>(outcome: FoldEngineOutcome<T>): FoldEngineRefused {
  if (outcome.status !== 'refused') throw new Error('landed');
  return outcome;
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('did not throw');
}

/** A valley through every layer on `moving`'s side of the line through two sheet points. */
function valley(through: readonly [SheetPoint, SheetPoint], moving: SheetPoint): FoldPlainOp {
  return { kind: 'valley', line: { via: 'free', through }, moving, seed: { scope: 'all' } };
}

describe.skipIf(!available)('the vertex folds over the bridge', () => {
  let engine: Engine;

  beforeAll(async () => {
    engine = await makeEngine();
  });

  /** The compound question of a vertex op: its analysis. */
  function analysed(state: number, op: FoldSquashOp | FoldRabbitEarOp): FoldCompoundAnalysisOf<'vertex'>['analysis'] {
    const answer = landed(engine.question.compoundAnalysis(state, op));
    if (answer.family !== 'vertex') throw new Error(`answered for ${answer.family}`);
    return answer.analysis;
  }

  /** The square folded on a diagonal: a two-layer triangle. */
  function triangle(): number {
    const sheet = landed(engine.calls.sheet(SQUARE_PAPER)).state;
    return landed(engine.calls.step(sheet, valley([[1, 0], [0, 1]], [1, 1]))).state;
  }

  it('squashes the exact Bird pocket from either precreased subdivision and freshly replays both saved branches', async () => {
    const fixture = JSON.parse(readFileSync(resolve(process.cwd(), '../../tests/fixtures/fold-examples/squash-precreased-bird.json'), 'utf8')) as {
      paper: FoldPaper; steps: FoldStep[]; picks: FoldSquashOp[];
    };
    let state = landed(engine.calls.sheet(fixture.paper)).state;
    const nodes: FoldStep[] = fixture.steps.map(node => {
      const result = landed(engine.calls.step(state, node.op, node.choices));
      state = result.state;
      return { ...node, expect: result.fingerprint };
    });
    const baseline = analysed(state, fixture.picks[0]);
    const outcomes = fixture.picks.map((op, i) => {
      expect(analysed(state, op)).toEqual(baseline);
      const preview = landed(engine.vertex.vertexFold(state, op));
      expect(preview.result).toBe('landed');
      const result = landed(engine.calls.step(state, op));
      if (preview.result === 'landed') expect(preview.fingerprint).toBe(result.fingerprint);
      nodes.push(step(`fstep-pocket-${i}`, fixture.steps.at(-1)!.id, op, { expect: result.fingerprint }));
      return result;
    });
    expect(outcomes[1].fingerprint).toBe(outcomes[0].fingerprint);
    // Includes exposed sides, per-face transforms and the full layer order,
    // not just the outline of the landed pocket.
    expect(engine.calls.scene(outcomes[1].state)).toEqual(engine.calls.scene(outcomes[0].state));
    const document = sequenceOf(nodes, fixture.paper);
    const saved = readFoldSequence(JSON.parse(JSON.stringify(writeFoldSequence({ document, readOnlyRaw: null }))))!;
    const fresh = await makeEngine();
    const port = createFoldEnginePort({
      generation: () => 0,
      sheet: async paper => fresh.calls.sheet(paper),
      step: async (parent, op, choices) => fresh.calls.step(parent, op, choices),
      release: async states => fresh.calls.release(states),
    }, fresh.version);
    const replay = await createFoldReplayer(port).run({ loadId: 1, sequence: saved.document });
    expect(replay?.steps.size).toBe(nodes.length);
    for (const node of nodes) {
      expect(replay?.steps.get(node.id)?.status).toBe('ok');
      expect(replay?.steps.get(node.id)?.fingerprint).toBe(node.expect);
    }
  });

  it('lands a stored squash through `step`, with its report and its staged motion', () => {
    const half = triangle();
    const small = landed(engine.calls.step(half, valley([[0, 0], [0.5, 0.5]], [0.9, 0.1]))).state;
    const top = engine.calls.topVisibleAt(small, [0.1, 0.5]);
    if (!top) throw new Error('nothing on top');
    const op: FoldSquashOp = { kind: 'squash', flap: top.sheet, direction: 'valley' };

    const squash = analysed(small, op);
    expect(squash.kind).toBe('squash');
    if (squash.kind === 'squash') expect(squash.share).toBe(0);

    const stepped = landed(engine.calls.step(small, op));
    expect(stepped.report).toBeNull();
    const vertex = vertexOf(stepped.compound);
    expect(vertex.kind).toBe('squash');
    expect(vertex.created).toHaveLength(2);
    expect(vertex.motion.kind).toBe('visual');
    // Two stages, a spread and a close leg each, every leg placing every
    // moving face.
    expect(vertex.motion.legs.map((leg) => leg.stacking)).toEqual(['parent', 'parent', 'parent', 'landed']);
    expect(vertex.stored).toEqual({});
    expect(compoundStoredChoices(vertex)).toEqual({});

    // The tools' call lands the same state, with the same report.
    const tried = landed(engine.vertex.vertexFold(small, op));
    expect(tried.result).toBe('landed');
    if (tried.result === 'landed') {
      expect(tried.fingerprint).toEqual(stepped.fingerprint);
      expect(tried.compound).toEqual(stepped.compound);
    }
  });

  it('lands a rabbit ear as one ear, whatever an older step stored of its ridge or its order', () => {
    const tri = triangle();
    const ear: FoldRabbitEarOp = {
      kind: 'rabbit-ear',
      corners: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      emergent: [-1, 0],
      seed: { scope: 'all' },
      stayer: [0.6, 0.35],
      direction: 'valley',
    };
    const fan = analysed(tri, ear);
    expect(fan.kind).toBe('rabbit-ear');
    if (fan.kind === 'rabbit-ear') expect(fan.candidates).toHaveLength(3);

    // Its fourth crease is its ridge: one ear, nothing to store.
    const tried = landed(engine.vertex.vertexFold(tri, ear));
    if (tried.result !== 'landed') throw new Error('a choice');
    expect(tried.compound.stored).toEqual({});
    const stepped = landed(engine.calls.step(tri, ear));
    expect(stepped.fingerprint).toEqual(tried.fingerprint);
    // An older step's ridge on a corner's crease, and an order it stored: the same ear.
    const older = { ...ear, ridge: [0.6, -0.3] as const };
    expect(landed(engine.calls.step(tri, older)).fingerprint).toEqual(tried.fingerprint);
    for (const s of [1, -1] as const) {
      const completion = {
        faces: [
          [0.2, 0.1],
          [0.1, 0.2],
        ] as const,
        orders: [[0, 1, s] as const],
      };
      expect(landed(engine.calls.step(tri, older, { completion })).fingerprint).toEqual(tried.fingerprint);
    }
  });

  /**
   * Seed 6717's drawn four-layer stack (`crates/oristudio-fold-wasm/tests/vertex.rs`),
   * fold by fold along its model lines, and its swivel through every layer:
   * the rare fan fold whose fourth crease rising still leaves six orders.
   */
  function drawnStack(): { state: number; swivel: FoldSwivelOp } {
    const ops: FoldEngineOp[] = [
      {
        kind: 'mountain',
        line: { via: 'model', line: { n: [0.7071067811865475, 0.7071067811865475], d: 0.7071067811865475 } },
        side: 'positive',
        seed: { scope: 'depth', at: [0.43337668012163094, 0.5851284708994908], layers: 1 },
      },
      {
        kind: 'mountain',
        line: { via: 'model', line: { n: [0.16781781659920522, 0.9858180260229955], d: 0.45135725104893515 } },
        side: 'negative',
        seed: { scope: 'depth', at: [0.5245699051724596, 0.35004875043914585], layers: 1 },
      },
      {
        kind: 'valley',
        line: { via: 'model', line: { n: [0.8089593525382522, -0.5878645812947841], d: -0.49423096652837356 } },
        side: 'negative',
        seed: { scope: 'all' },
      },
      {
        kind: 'mountain',
        line: { via: 'model', line: { n: [0.943674360863751, -0.3308756573826353], d: -0.1514915767545033 } },
        side: 'positive',
        seed: { scope: 'all' },
      },
      {
        kind: 'valley',
        line: { via: 'model', line: { n: [1, -5.799447436887377e-16], d: -4.87572581044147e-16 } },
        side: 'negative',
        seed: { scope: 'depth', at: [0.41780637514775365, 0.1659964283328923], layers: 1 },
      },
    ];
    let state = landed(engine.calls.sheet(SQUARE_PAPER)).state;
    for (const op of ops) state = landed(engine.calls.step(state, op)).state;
    const swivel: FoldSwivelOp = {
      kind: 'swivel',
      vertex: [0.5372621917973273, 0.4193633050052127],
      toward: [
        [0.5375324963819914, 0.36888774237582933],
        [0.526787569333818, 0.46874080769184356],
        [0.698256467658807, 0.4319642531214779],
      ],
      emergent: [0.6707501901150905, 0.7416833437934075],
      seed: { scope: 'all' },
      stayer: [0.5348016974441572, 0.3148855107608072],
      direction: 'mountain',
    };
    return { state, swivel };
  }

  it('holds a swivel’s choice, picks one, and replays the stored completion to it', () => {
    const { state, swivel } = drawnStack();
    const tried = landed(engine.vertex.vertexFold(state, swivel));
    if (tried.result !== 'choose') throw new Error('no choice');
    expect(tried.count).toEqual({ orders: 6, exact: true });
    expect(tried.components).toEqual([6]);

    const picked = landed(engine.vertex.vertexPick(tried.pending, [1]));
    expect(picked.compound.family).toBe('vertex');
    const completion = picked.compound.stored.completion;
    expect(completion?.orders.length).toBeGreaterThan(0);
    // What the step stores, read as every compound family's is.
    expect(compoundStoredChoices(picked.compound)).toEqual({ completion });
    const replayed = landed(engine.calls.step(state, swivel, { completion }));
    expect(replayed.fingerprint).toEqual(picked.fingerprint);
    expect(replayed.compound).toEqual(picked.compound);
    // The other pick is another state.
    const other = landed(engine.vertex.vertexPick(tried.pending, [0]));
    expect(other.fingerprint).not.toEqual(picked.fingerprint);
    expect(engine.vertex.releaseVertexChoices([tried.pending])).toBe(1);

    // A stored step with no choice leaves one it does not store.
    const needed = refused(engine.calls.step(state, swivel));
    expect(needed.refusal).toEqual({ code: 'choice_needed', choice: 'completion' });
    expect(FOLD_REFUSAL_CODES).toContain(needed.refusal.code);
  });

  it('refuses by code, and throws a caller’s mistake', () => {
    const sheet = landed(engine.calls.sheet(SQUARE_PAPER)).state;
    const flat = refused(engine.calls.step(sheet, { kind: 'squash', flap: [0.3, 0.3], direction: 'valley' }));
    expect(flat.refusal.code).toBe('squash_no_flap');
    expect(flat.faces).toEqual([0]);
    expect(thrown(() => engine.vertex.vertexPick(0, [0]))).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => engine.vertex.vertexPick(1, [-1]))).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => engine.vertex.vertexPick(77, [0]))).toMatchObject({ code: 'invalid_input' });
    expect(engine.vertex.releaseVertexChoices([])).toBe(0);
  });
});
