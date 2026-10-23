import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFoldReplayer } from '../document/foldReplay';
import { sequenceOf, step } from '../document/foldSequence.fixtures';
import type { FoldChoices, FoldSinkOp, SheetPoint } from '../document/foldSequenceDocument';
import { createFoldEngineCalls, type FoldEngineCalls } from './foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from './foldEngineCompoundCalls';
import {
  compoundStoredChoices,
  type FoldCompoundAnalysis,
  type FoldCompoundAnalysisOf,
  type FoldCompoundReport,
  type FoldCompoundReportOf,
} from './foldEngineCompoundWire';
import { createFoldEngineIoCalls, type FoldEngineIoCalls } from './foldEngineIoCalls';
import { FOLD_SAMPLES, foldSampleSource, type FoldSampleId } from './foldEngineIoSamples';
import type { FoldImportFingerprinted } from './foldEngineIoWire';
import { createFoldEnginePort, type FoldEngineSource } from './foldEnginePort';
import { createFoldEngineSinkCalls, type FoldEngineSinkCalls } from './foldEngineSinkCalls';
import { pocketChoice, sinkStoredChoices } from './foldEngineSinkWire';
import { FOLD_REFUSAL_CODES, type FoldEngineOutcome, type FoldEngineRefused } from './foldEngineWire';

/**
 * The sinks over the real bridge, in-process: what the worker runs. The
 * crate's tests prove the behaviour natively (`crates/oristudio-fold`'s
 * `tests/sink.rs`, the bridge's `tests/sink.rs`); this covers TypeScript's
 * side of the boundary — the document's sink ops landing through `step` on a
 * sample as Import CP lands it, their reports as the step's `compound`
 * (`family: 'sink'`), the compound question and the sink tool's queries,
 * what a step stores coming back in the engine's shapes and going into the
 * document's, and a sequence with a sink replayed by the document's
 * replayer.
 *
 * Skipped when the bridge has not been built.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

interface Engine {
  calls: FoldEngineCalls;
  io: FoldEngineIoCalls;
  sinks: FoldEngineSinkCalls;
  question: FoldEngineCompoundCalls;
  version: number;
}

async function makeEngine(): Promise<Engine> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const fold = new wasm.FoldEngine();
  return {
    calls: createFoldEngineCalls(fold),
    io: createFoldEngineIoCalls(fold),
    sinks: createFoldEngineSinkCalls(fold),
    question: createFoldEngineCompoundCalls(fold),
    version: wasm.fold_engine_version(),
  };
}

function landed<T>(outcome: FoldEngineOutcome<T>): T {
  if (outcome.status !== 'ok') throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome;
}

/** A step's compound report, which must be a sink's. */
function sinkOf(report: FoldCompoundReport | undefined): FoldCompoundReportOf<'sink'> {
  if (report?.family !== 'sink') throw new Error(`no sink report: ${JSON.stringify(report)}`);
  return report;
}

/** The compound question's answer, which must be a sink's. */
function sinkAsked(outcome: FoldEngineOutcome<FoldCompoundAnalysis>): FoldCompoundAnalysisOf<'sink'> {
  const answer = landed(outcome);
  if (answer.family !== 'sink') throw new Error(`answered for ${answer.family}`);
  return answer;
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

/** A sample imported into an empty sequence, its one order picked. */
function importSample({ io }: Engine, id: FoldSampleId): FoldImportFingerprinted {
  const found = FOLD_SAMPLES.find((s) => s.id === id);
  if (!found) throw new Error(`no sample ${id}`);
  const opened = landed(io.importCp(foldSampleSource(found), { kind: 'empty', startSide: 'front' }));
  return landed(io.importPick(opened.import, []));
}

const C: SheetPoint = [0.5, 0.5];
const at = (p: SheetPoint, toward: SheetPoint, t: number): SheetPoint => [
  p[0] + t * (toward[0] - p[0]),
  p[1] + t * (toward[1] - p[1]),
];

/**
 * The preliminary base's sink line at depth `f` of its point's axis, through
 * a sheet point on a half-diagonal (along the axis, folded) and one on a
 * midline half (along a side, where the ring meets it twice as far out), and
 * a sheet point of the tip between them.
 */
function ring(f: number): [SheetPoint, SheetPoint] {
  return [at(C, [0, 0], f), at(C, [0, 0.5], 2 * f)];
}

function tip(f: number): SheetPoint {
  const [a, b] = ring(f);
  return [(C[0] + a[0] + b[0]) / 3, (C[1] + a[1] + b[1]) / 3];
}

function sinkOp(kind: FoldSinkOp['kind'], f: number): FoldSinkOp {
  return { kind, line: { via: 'free', through: ring(f) }, seed: { scope: 'flaps', at: [tip(f)] } };
}

/** The unsink of a sink at depth `f`: along a ring crease, the sunk tip named by the same point. */
function unsinkOp(f: number): FoldSinkOp {
  const [a, b] = ring(f);
  return { kind: 'unsink', line: { via: 'crease', at: at(a, b, 0.5) }, seed: { scope: 'flaps', at: [tip(f)] } };
}

describe.skipIf(!available)('sinks through the built bridge', () => {
  it('open-sinks a sample through step, with its report and motion, and unsinks it back', async () => {
    const engine = await makeEngine();
    const { calls } = engine;
    const base = importSample(engine, 'preliminary-base');
    const sunk = landed(calls.step(base.state, sinkOp('open-sink', 0.3)));
    expect(sunk.report).toBeNull();
    const sink = sinkOf(sunk.compound);
    expect(sink.step).toBe('open');
    expect(sink.ring).toHaveLength(8);
    expect(sink.motion.kind).toBe('visual');
    expect(sink.motion.legs.map((leg) => [leg.name, leg.stacking])).toEqual([
      ['spread', 'parent'],
      ['close', 'landed'],
    ]);
    const close = sink.motion.legs[1]?.groups ?? [];
    expect(close.every((group) => Math.abs(Math.abs(group.to) - Math.PI) < 1e-12)).toBe(true);
    expect(sinkStoredChoices(sink.stored)).toEqual({});
    expect(compoundStoredChoices(sink)).toEqual({});
    expect(sunk.summary.faces).toBe(16);
    expect(sunk.summary.creases.mountain).toBeGreaterThan(base.summary.creases.mountain);
    const summary = landed(calls.stepSummary(sunk.state));
    expect(summary.summary?.diff.added).toHaveLength(8);
    // Pictured as its preview was: pushed in at the tip, seen as a mountain.
    const pictured = landed(calls.stepAction(sunk.state)).action;
    expect(pictured?.direction).toBe('mountain');
    expect(pictured?.push).toEqual(landed(calls.action(base.state, sinkOp('open-sink', 0.3))).action.push);

    const back = landed(calls.step(sunk.state, unsinkOp(0.3)));
    expect(sinkOf(back.compound).step).toBe('unsink');
    expect(landed(calls.stepAction(back.state)).action).toMatchObject({ direction: 'valley' });
    expect(landed(calls.stepAction(back.state)).action?.push).toBeUndefined();
    expect(sinkOf(back.compound).unfolded).toHaveLength(8);
    expect(back.summary.creases.flat).toBe(base.summary.creases.flat * 2 + 8);
  });

  it('asks a closed sink for its pocket, and lands each one the analysis offers as the document stores it', async () => {
    const engine = await makeEngine();
    const { calls, question } = engine;
    const base = importSample(engine, 'preliminary-base');
    const op = sinkOp('closed-sink', 0.3);
    const missing = refused(calls.step(base.state, op));
    expect(missing.refusal).toEqual({ code: 'choice_needed', choice: 'pocket' });

    const { analysis, open } = sinkAsked(question.compoundAnalysis(base.state, op));
    expect(open).toBeNull();
    expect(analysis.exterior).toBe('mountain');
    expect(analysis.outline).toHaveLength(4);
    expect(analysis.pockets).toHaveLength(2);
    const fingerprints = analysis.pockets.map((pocket) => {
      const choices: FoldChoices = { pocket: pocketChoice(pocket.stored) };
      const sunk = landed(calls.step(base.state, op, choices));
      const sink = sinkOf(sunk.compound);
      expect(sink.pocket?.seams).toEqual(pocket.seams);
      // What the step stores comes back as the choices it was given.
      expect(sinkStoredChoices(sink.stored)).toEqual(choices);
      expect(compoundStoredChoices(sink)).toEqual(choices);
      return sunk.fingerprint;
    });
    expect(new Set(fingerprints).size).toBe(2);

    const broken = refused(calls.step(base.state, op, { pocket: [[2, 2], tip(0.3)] }));
    expect(broken.refusal).toMatchObject({ code: 'choice_broken' });
    expect(refused(calls.step(base.state, sinkOp('open-sink', 0.3), { pocket: [tip(0.3), tip(0.3)] })).refusal).toEqual(
      { code: 'unexpected_choice', choice: 'pocket' }
    );
  });

  it('refuses a tilted open sink with the square line and the closed sink, every code a known one', async () => {
    const engine = await makeEngine();
    const { calls, question } = engine;
    const base = importSample(engine, 'preliminary-base');
    // Through the ring's point on the axis and a point off the ring on the side.
    const tilted: FoldSinkOp = {
      ...sinkOp('open-sink', 0.3),
      line: { via: 'free', through: [ring(0.3)[0], at(C, [0, 0.5], 0.66)] },
    };
    const refusal = refused(calls.step(base.state, tilted));
    expect(refusal.refusal.code).toBe('sink_line_tilted');
    expect(refusal.fixes.map((fix) => fix.fix)).toEqual(['use_line', 'other_sink']);
    expect(refusal.faces.length).toBeGreaterThan(0);
    const known: readonly string[] = FOLD_REFUSAL_CODES;
    expect(known).toContain(refusal.refusal.code);
    const square = refusal.fixes[0];
    if (square?.fix !== 'use_line') throw new Error('no square line');
    landed(
      calls.step(base.state, {
        kind: 'open-sink',
        line: { via: 'model', line: square.line },
        side: square.side,
        seed: { scope: 'all' },
      })
    );
    const analysed = sinkAsked(question.compoundAnalysis(base.state, tilted));
    expect(analysed.open?.refusal.code).toBe('sink_line_tilted');
    expect(analysed.analysis.square).toEqual(square.line);
  });

  it('counts one order for a decided sink, and refuses the caller’s mistakes', async () => {
    const engine = await makeEngine();
    const { calls, sinks, question } = engine;
    const base = importSample(engine, 'preliminary-base');
    const op = sinkOp('open-sink', 0.3);
    expect(landed(sinks.sinkOrders(base.state, op))).toMatchObject({
      count: { orders: 1, exact: true },
      components: [],
    });
    expect(landed(sinks.sinkPick(base.state, op, [])).completion).toBeNull();
    const valley = { ...op, kind: 'valley' } as unknown as FoldSinkOp;
    expect(thrown(() => question.compoundAnalysis(base.state, valley))).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => sinks.sinkOrders(base.state, valley))).toMatchObject({ code: 'invalid_input' });
    // An unsink has no point to analyse: the bridge's own mistake to throw.
    const sunk = landed(calls.step(base.state, op)).state;
    expect(thrown(() => question.compoundAnalysis(sunk, unsinkOp(0.3)))).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => sinks.sinkPick(base.state, op, [-1]))).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => sinks.sinkOrders(0, op))).toMatchObject({ code: 'invalid_input' });
    // The sunk points are an unsink's.
    expect(thrown(() => sinks.sunkPoints(base.state, op))).toMatchObject({ code: 'invalid_input' });
  });

  it('answers a sink tool’s preview as a fold along its line: what moves, its picture and push, the depth picker', async () => {
    const engine = await makeEngine();
    const { calls } = engine;
    const base = importSample(engine, 'preliminary-base');
    for (const kind of ['open-sink', 'closed-sink'] as const) {
      const op: FoldSinkOp = { ...sinkOp(kind, 0.3), seed: { scope: 'all' }, moving: tip(0.3) };
      const { analysis } = landed(calls.analyse(base.state, op));
      expect(analysis.flaps).toHaveLength(1);
      expect(analysis.picked).toEqual([0]);
      expect(analysis.moving).toEqual(analysis.flaps[0]?.faces);
      const { action } = landed(calls.action(base.state, op));
      expect(action.direction).toBe('mountain');
      expect(action.line).not.toBeNull();
      expect(action.push).toBeDefined();
      expect(landed(calls.depthChoices(base.state, op, tip(0.3))).choices.length).toBeGreaterThan(0);
    }
  });

  it('names the one sunk point an unsink along the ring can pull out, and pictures it pulled', async () => {
    const engine = await makeEngine();
    const { calls, sinks } = engine;
    const base = importSample(engine, 'preliminary-base');
    const sunk = landed(calls.step(base.state, sinkOp('open-sink', 0.3))).state;
    // The tool's unsink before anything is named: every layer on the side of the ring the paper lies on.
    const unnamed: FoldSinkOp = { ...unsinkOp(0.3), seed: { scope: 'all' }, moving: tip(0.3) };
    const { points } = landed(sinks.sunkPoints(sunk, unnamed));
    expect(points).toHaveLength(1);
    const named: FoldSinkOp = { ...unsinkOp(0.3), seed: { scope: 'flaps', at: points.map((point) => point.witness) } };
    const { analysis } = landed(calls.analyse(sunk, named));
    expect(analysis.moving).toEqual(points[0]?.faces);
    expect(analysis.picked).toHaveLength(1);
    const { action } = landed(calls.action(sunk, named));
    expect(action.direction).toBe('valley');
    expect(action.push).toBeUndefined();
    expect(sinkOf(landed(calls.step(sunk, named)).compound).step).toBe('unsink');
    // Every layer on that side is the sunk tip and the paper round it: nothing would stay.
    expect(refused(calls.analyse(sunk, unnamed)).refusal.code).toBe('nothing_stays');
    // On the base nothing is sunk.
    const onBase: FoldSinkOp = { ...unnamed, line: { via: 'free', through: ring(0.3) } };
    expect(landed(sinks.sunkPoints(base.state, onBase)).points).toEqual([]);
  });

  it('replays a sequence with a sink through the document’s replayer, to the fingerprints the steps landed', async () => {
    const engine = await makeEngine();
    const { calls, version } = engine;
    const base = importSample(engine, 'preliminary-base');
    const sunk = landed(calls.step(base.state, sinkOp('open-sink', 0.3)));
    const source: FoldEngineSource = {
      generation: () => 0,
      sheet: async (paper) => calls.sheet(paper),
      step: async (state, op, choices) => calls.step(state, op, choices),
      release: async (states) => calls.release(states),
    };
    const sequence = sequenceOf([
      step('fstep-1', null, base.op, { expect: base.fingerprint }),
      step('fstep-2', 'fstep-1', sinkOp('open-sink', 0.3), { expect: sunk.fingerprint }),
      step('fstep-3', 'fstep-2', unsinkOp(0.3)),
    ]);
    const done = await createFoldReplayer(createFoldEnginePort(source, version)).run({ loadId: 1, sequence });
    expect(done?.steps.get('fstep-1')?.status).toBe('ok');
    expect(done?.steps.get('fstep-2')?.status).toBe('ok');
    expect(done?.steps.get('fstep-3')?.status).toBe('ok');
  });
});
