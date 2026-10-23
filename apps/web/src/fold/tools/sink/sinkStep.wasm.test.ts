import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Point } from '../../../lib/geometry';
import { transformLine } from '../../canvas/foldCanvasGeometry';
import { foldPickIndex, resolveFoldPick, sheetToScene, type FoldPick, type FoldPickIndex } from '../../canvas/foldPicking';
import { createFoldReplayer } from '../../document/foldReplay';
import { sequenceOf, step } from '../../document/foldSequence.fixtures';
import type { FoldChoices, FoldSinkOp, SheetPoint } from '../../document/foldSequenceDocument';
import { createFoldEngineCalls, type FoldEngineCalls } from '../../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from '../../engine/foldEngineCompoundCalls';
import type { FoldCompoundAnalysisOf, FoldCompoundReport } from '../../engine/foldEngineCompoundWire';
import { createFoldEngineIoCalls, type FoldEngineIoCalls } from '../../engine/foldEngineIoCalls';
import { FOLD_SAMPLES, foldSampleSource } from '../../engine/foldEngineIoSamples';
import { createFoldEnginePort, type FoldEngineSource } from '../../engine/foldEnginePort';
import { createFoldEngineSinkCalls, type FoldEngineSinkCalls } from '../../engine/foldEngineSinkCalls';
import type { FoldFix, FoldEngineOutcome, FoldEngineRefused } from '../../engine/foldEngineWire';
import { freeLineThrough, movingPoint } from '../foldStepBuilder';
import { lineModeInput, nextStep } from '../foldToolRegistry';
import type { FoldSinkToolId } from '../foldToolCatalog';
import { buildSinkStep, pocketNames, sinkOrderPicks, type FoldSinkIntent } from './sinkStep';

/**
 * The sinks over the real bridge, in-process, as the sink tools fold them:
 * the square base Fold ships as a sample, its sink line clicked on the folded
 * pane, the point described by the compound question, the step built with
 * the pocket taken — the step a preview lands and a commit stores — and that
 * step replayed through the document; a tilted line refused, its square line
 * and the other sink both landing as the window's fixes fold them; and the
 * unsink of the sunk point the engine finds along the ring.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

interface Engine {
  calls: FoldEngineCalls;
  io: FoldEngineIoCalls;
  compound: FoldEngineCompoundCalls;
  sinks: FoldEngineSinkCalls;
  version: number;
}

async function engine(): Promise<Engine> {
  const wasm = await import('../../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const fold = new wasm.FoldEngine();
  return {
    calls: createFoldEngineCalls(fold),
    io: createFoldEngineIoCalls(fold),
    compound: createFoldEngineCompoundCalls(fold),
    sinks: createFoldEngineSinkCalls(fold),
    version: wasm.fold_engine_version(),
  };
}

function landed<T>(outcome: FoldEngineOutcome<T>): T {
  if (outcome.status !== 'ok') throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome;
}

function refused<T>(outcome: FoldEngineOutcome<T>): FoldEngineRefused {
  if (outcome.status !== 'refused') throw new Error('landed');
  return outcome;
}

function sinkReport(report: FoldCompoundReport | undefined): Extract<FoldCompoundReport, { family: 'sink' }> {
  if (report?.family !== 'sink') throw new Error(`no sink report: ${JSON.stringify(report)}`);
  return report;
}

/** The square base, as Import CP lands its sample: the step that imports it, and its state. */
function squareBase({ io }: Engine) {
  const sample = FOLD_SAMPLES.find((each) => each.id === 'preliminary-base');
  if (!sample) throw new Error('no square base sample');
  const opened = landed(io.importCp(foldSampleSource(sample), { kind: 'empty', startSide: 'front' }));
  return landed(io.importPick(opened.import, []));
}

const indexOf = (calls: FoldEngineCalls, state: number): FoldPickIndex =>
  foldPickIndex(calls.scene(state), calls.landmarks(state, []), []);

const RADII = { point: 0.02, line: 0.02 };

/** Where a sheet point lies on the folded pane. */
function onPane(index: FoldPickIndex, sheet: SheetPoint): Point {
  const scene = sheetToScene(index.scene, sheet);
  if (!scene) throw new Error(`${sheet.join(', ')} is not on the paper`);
  return scene;
}

/** A free line's two ends clicked on the folded pane, as the canvas resolves them. */
function freeLine(index: FoldPickIndex, from: Point, to: Point): FoldPick[] {
  const model = lineModeInput('free');
  return [from, to].map((point, k) => {
    const click = nextStep(model, k);
    const pick = click && resolveFoldPick(index, 'folded', point, RADII, { snap: click.snap, edges: click.edges, free: false });
    if (!pick) throw new Error(`nothing to pick at ${point.x}, ${point.y}`);
    return pick;
  });
}

const C: SheetPoint = [0.5, 0.5];
const at = (p: SheetPoint, toward: SheetPoint, t: number): SheetPoint => [
  p[0] + t * (toward[0] - p[0]),
  p[1] + t * (toward[1] - p[1]),
];

/**
 * The square base's sink line at depth `f` of its point's centre line: the
 * sheet points where it crosses the centre crease and a side, as the folded
 * pane shows them — square to the point.
 */
function ring(index: FoldPickIndex, f: number): [Point, Point] {
  return [onPane(index, at(C, [0, 0], f)), onPane(index, at(C, [0, 0.5], 2 * f))];
}

/** A sink tool's intent along a free line, nothing chosen yet. */
function intent(tool: FoldSinkToolId, picks: FoldPick[], made: Partial<FoldSinkIntent> = {}): FoldSinkIntent {
  return {
    tool,
    lineMode: 'free',
    picks,
    candidate: null,
    swapped: false,
    seed: { scope: 'all' },
    pocket: null,
    completion: null,
    sunk: null,
    ...made,
  };
}

function built(intended: FoldSinkIntent, index: FoldPickIndex): { op: FoldSinkOp; choices?: FoldChoices } {
  const made = buildSinkStep(intended, index);
  if (made.status !== 'built') throw new Error(`not built: ${JSON.stringify(made)}`);
  return { op: made.op as FoldSinkOp, ...(made.choices ? { choices: made.choices } : {}) };
}

/** The compound question, which a sink op's family answers. */
function pointOf({ compound }: Engine, state: number, op: FoldSinkOp): FoldCompoundAnalysisOf<'sink'> {
  const answer = landed(compound.compoundAnalysis(state, { ...op, kind: 'open-sink' }));
  if (answer.family !== 'sink') throw new Error(`answered for ${answer.family}`);
  return answer;
}

describe.skipIf(!available)('the sink tools over the real bridge', () => {
  it('open-sinks the square base’s point along a line square to it, and replays the step from the document', async () => {
    const e = await engine();
    const base = squareBase(e);
    const index = indexOf(e.calls, base.state);
    const { op, choices } = built(intent('open-sink', freeLine(index, ...ring(index, 0.3))), index);
    // The tip side moves: the side with less paper, every layer of the one point there.
    expect(op).toMatchObject({ kind: 'open-sink', line: { via: 'free' }, seed: { scope: 'all' } });
    expect(choices).toBeUndefined();
    const { analysis, open } = pointOf(e, base.state, op);
    expect(open).toBeNull();
    expect(analysis.exterior).toBe('mountain');
    expect(analysis.square).not.toBeNull();
    // Decided: one order, nothing to pick.
    expect(sinkOrderPicks(landed(e.sinks.sinkOrders(base.state, op)))).toEqual([]);
    const sunk = landed(e.calls.step(base.state, op, choices));
    expect(sinkReport(sunk.compound)).toMatchObject({ step: 'open', stored: {} });

    const source: FoldEngineSource = {
      generation: () => 0,
      sheet: async (paper) => e.calls.sheet(paper),
      step: async (state, stepOp, stepChoices) => e.calls.step(state, stepOp, stepChoices),
      release: async (states) => e.calls.release(states),
    };
    const sequence = sequenceOf([
      step('fstep-1', null, base.op, { expect: base.fingerprint }),
      step('fstep-2', 'fstep-1', op, { expect: sunk.fingerprint }),
    ]);
    const done = await createFoldReplayer(createFoldEnginePort(source, e.version)).run({ loadId: 1, sequence });
    expect(done?.steps.get('fstep-2')?.status).toBe('ok');
  });

  it('closed-sinks it into its front pocket and its back one, each its own state, the pocket stored', async () => {
    const e = await engine();
    const base = squareBase(e);
    const index = indexOf(e.calls, base.state);
    const picks = freeLine(index, ...ring(index, 0.3));
    const { op } = built(intent('closed-sink', picks), index);
    // Two pockets and none chosen: the step asks for one.
    expect(refused(e.calls.step(base.state, op)).refusal).toEqual({ code: 'choice_needed', choice: 'pocket' });
    const { pockets } = pointOf(e, base.state, op).analysis;
    expect(pockets).toHaveLength(2);
    expect(new Set(pocketNames(pockets, false))).toEqual(new Set(['front', 'back']));
    // Turned over, the viewer sees the other pocket in front.
    expect(pocketNames(pockets, true)).toEqual([...pocketNames(pockets, false)].reverse());
    const fingerprints = pockets.map((pocket) => {
      const chosen = built(intent('closed-sink', picks, { pocket: pocket.stored }), index);
      expect(chosen.choices?.pocket).toEqual([pocket.stored.above, pocket.stored.below]);
      const sunk = landed(e.calls.step(base.state, chosen.op, chosen.choices));
      expect(sinkReport(sunk.compound).stored.pocket).toEqual(pocket.stored);
      return sunk.fingerprint;
    });
    expect(new Set(fingerprints).size).toBe(2);
    // The open sink stores no pocket, though one is named.
    const open = built(intent('open-sink', picks, { pocket: pockets[0]!.stored }), index);
    expect(open.choices).toBeUndefined();
  });

  it('refuses a tilted open sink with the square line and the closed sink, and lands each fix as the window folds it', async () => {
    const e = await engine();
    const base = squareBase(e);
    const index = indexOf(e.calls, base.state);
    const [a, b] = ring(index, 0.3);
    // ℓ turned 5° about its point on the centre line.
    const turn = (5 * Math.PI) / 180;
    const tilted: Point = {
      x: a.x + (b.x - a.x) * Math.cos(turn) - (b.y - a.y) * Math.sin(turn),
      y: a.y + (b.x - a.x) * Math.sin(turn) + (b.y - a.y) * Math.cos(turn),
    };
    const { op } = built(intent('open-sink', freeLine(index, a, tilted)), index);
    const refusal = refused(e.calls.step(base.state, op));
    expect(refusal.refusal.code).toBe('sink_line_tilted');
    expect(refusal.fixes.map((fix) => fix.fix)).toEqual(['use_line', 'other_sink']);
    expect(pointOf(e, base.state, op).open?.refusal.code).toBe('sink_line_tilted');

    // The square line, as the canvas's useLine puts it in place of the picks':
    // the free line through it, the same side moving.
    const square = refusal.fixes[0] as Extract<FoldFix, { fix: 'use_line' }>;
    const sceneLine = transformLine(index.scene.view_transform, square.line);
    const through = freeLineThrough(index, sceneLine);
    const moving = movingPoint(index, sceneLine, square.side === 'positive' ? 1 : -1);
    if (!through || !moving) throw new Error('the square line misses the paper');
    const along: FoldSinkOp = { ...op, line: { via: 'free', through }, moving: moving.sheet };
    expect(sinkReport(landed(e.calls.step(base.state, along)).compound).step).toBe('open');

    // The closed sink, tilted as it is: either pocket lands.
    expect(refusal.fixes[1]).toEqual({ fix: 'other_sink', kind: 'closed' });
    const closed: FoldSinkOp = { ...op, kind: 'closed-sink' };
    const [pocket] = pointOf(e, base.state, closed).analysis.pockets;
    if (!pocket) throw new Error('no pocket');
    const sunk = landed(e.calls.step(base.state, closed, { pocket: [pocket.stored.above, pocket.stored.below] }));
    expect(sinkReport(sunk.compound).step).toBe('closed');
  });

  it('unsinks the sunk point the engine finds along the ring the sink left, picked as an existing crease', async () => {
    const e = await engine();
    const base = squareBase(e);
    let index = indexOf(e.calls, base.state);
    const { op } = built(intent('open-sink', freeLine(index, ...ring(index, 0.3))), index);
    const sunk = landed(e.calls.step(base.state, op)).state;

    // The ring crease, clicked on the folded pane where the sink left it.
    index = indexOf(e.calls, sunk);
    const ringAt = onPane(index, at(at(C, [0, 0], 0.3), at(C, [0, 0.5], 0.6), 0.5));
    const click = nextStep(lineModeInput('crease'), 0);
    const crease = click && resolveFoldPick(index, 'folded', ringAt, RADII, { snap: click.snap, edges: click.edges, free: false });
    if (!crease) throw new Error('no ring crease under the click');
    const unnamed = built({ ...intent('unsink', [crease]), lineMode: 'crease' }, index);
    // The side with the paper on it, every layer there: the point and the paper round it.
    expect(unnamed.op).toMatchObject({ kind: 'unsink', line: { via: 'crease' }, seed: { scope: 'all' } });
    const { points } = landed(e.sinks.sunkPoints(sunk, unnamed.op));
    expect(points).toHaveLength(1);
    const named = built({ ...intent('unsink', [crease], { sunk: points[0]! }), lineMode: 'crease' }, index);
    expect(named.op.seed).toEqual({ scope: 'flaps', at: [points[0]!.witness] });
    expect(named.op.moving).toBeUndefined();
    const back = landed(e.calls.step(sunk, named.op, named.choices));
    expect(sinkReport(back.compound).step).toBe('unsink');
    expect(back.summary.faces).toBe(16);
  });
});
