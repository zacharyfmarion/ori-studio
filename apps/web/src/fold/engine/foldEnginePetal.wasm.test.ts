import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseNativeProjectFile } from '../../lib/nativeProjectFile';
import { createFoldReplayer } from '../document/foldReplay';
import {
  isLockedStep,
  petalHinge,
  petalOp,
  type FoldPetalOp,
  type FoldSequenceDocument,
  type FoldStep,
  type SheetPoint,
} from '../document/foldSequenceDocument';
import { readFoldSequence, readFoldSequences, writeFoldSequence } from '../document/foldSequenceFile';
import { createFoldEngineCalls, type FoldEngineCalls } from './foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from './foldEngineCompoundCalls';
import type { FoldCompoundReport, FoldCompoundReportOf } from './foldEngineCompoundWire';
import { createFoldEnginePort, type FoldEngineSource } from './foldEnginePort';
import { createFoldEngineVertexCalls, type FoldEngineVertexCalls } from './foldEngineSquashCalls';
import type { FoldPetalAnalysis } from './foldEngineSquashWire';
import type { FoldEngineOutcome, FoldModelPoint, FoldSceneCrease } from './foldEngineWire';

/**
 * The petal fold with H named by its two ends, over the real bridge: the
 * bird-base example (`tests/fixtures/fold-examples/petal-fold.osf`, built in
 * the app with each H by its ends over precreased kites) folded again from
 * its preliminary base with no precrease at all — the example's own two petal
 * ops, unchanged — crossing the boundary as the document stores it, answering
 * the compound question with what it creases (the kites now too), and landing
 * the same folded creases as the example; then the whole path replayed from
 * the document, every step ok.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const EXAMPLE = resolve(ROOT, '../../tests/fixtures/fold-examples/petal-fold.osf');
const available = existsSync(WASM) && existsSync(EXAMPLE);

interface Engine {
  calls: FoldEngineCalls;
  vertex: FoldEngineVertexCalls;
  question: FoldEngineCompoundCalls;
  version: number;
}

async function makeEngine(): Promise<Engine> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
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

function vertexOf(report: FoldCompoundReport | undefined): FoldCompoundReportOf<'vertex'> {
  if (report?.family !== 'vertex') throw new Error(`no vertex report: ${JSON.stringify(report)}`);
  return report;
}

/** The example's one sequence, its steps in order (it is one chain). */
function example(): { document: FoldSequenceDocument; steps: FoldStep[] } {
  const project = parseNativeProjectFile(readFileSync(EXAMPLE, 'utf8'));
  const [held] = readFoldSequences(project.workspace.foldSequences);
  if (!held) throw new Error('no sequence');
  const steps = held.document.steps.map((node) => {
    if (isLockedStep(node)) throw new Error(`${node.id} is locked`);
    return node;
  });
  return { document: held.document, steps };
}

describe.skipIf(!available)('the petal fold by its ends over the bridge', () => {
  let engine: Engine;

  beforeAll(async () => {
    engine = await makeEngine();
  });

  function petalAnalysis(state: number, op: FoldPetalOp): FoldPetalAnalysis {
    const answer = landed(engine.question.compoundAnalysis(state, op));
    if (answer.family !== 'vertex' || answer.analysis.kind !== 'petal') {
      throw new Error(`not a petal fold's answer: ${JSON.stringify(answer)}`);
    }
    return answer.analysis;
  }

  /**
   * The sheet point under the model point `p` on the layer the viewer sees
   * on top at `near`: the face's isometry, sampled there, taken to `p`. For
   * a point on a fold, where no one layer is on top.
   */
  function sheetOnTopNear(state: number, p: FoldModelPoint, near: FoldModelPoint): SheetPoint {
    const h = 1e-3;
    const at = (q: FoldModelPoint) => {
      const top = engine.calls.topVisibleAt(state, q);
      if (!top) throw new Error(`nothing on top at ${q.join()}`);
      return top;
    };
    const [o, x, y] = [at(near), at([near[0] + h, near[1]]), at([near[0], near[1] + h])];
    expect(new Set([o.face, x.face, y.face]).size).toBe(1);
    const ex = [(x.sheet[0] - o.sheet[0]) / h, (x.sheet[1] - o.sheet[1]) / h];
    const ey = [(y.sheet[0] - o.sheet[0]) / h, (y.sheet[1] - o.sheet[1]) / h];
    const [dx, dy] = [p[0] - near[0], p[1] - near[1]];
    return [o.sheet[0] + ex[0]! * dx + ey[0]! * dy, o.sheet[1] + ex[1]! * dx + ey[1]! * dy];
  }

  /** H through the ends `analysis` found, as sheet points on the top layer of `state`. */
  function endsOn(state: number, analysis: FoldPetalAnalysis): [SheetPoint, SheetPoint] {
    const [a, b] = analysis.ends;
    const inside: FoldModelPoint = [
      (a[0] + b[0] + analysis.corner[0]) / 3,
      (a[1] + b[1] + analysis.corner[1]) / 3,
    ];
    const toward = (end: FoldModelPoint): FoldModelPoint => [
      end[0] + 0.1 * (inside[0] - end[0]),
      end[1] + 0.1 * (inside[1] - end[1]),
    ];
    return [sheetOnTopNear(state, a, toward(a)), sheetOnTopNear(state, b, toward(b))];
  }

  /** Whether every folded crease of `ours` lies along folded creases of `theirs` with its letter. */
  function foldedAlong(ours: FoldSceneCrease[], theirs: FoldSceneCrease[]): boolean {
    const folds = (creases: FoldSceneCrease[]) => creases.filter((crease) => crease.kind === 'fold');
    const on = (p: { x: number; y: number }, c: FoldSceneCrease) => {
      const [dx, dy] = [c.to.x - c.from.x, c.to.y - c.from.y];
      const length = Math.hypot(dx, dy);
      const off = ((p.x - c.from.x) * dy - (p.y - c.from.y) * dx) / length;
      const along = ((p.x - c.from.x) * dx + (p.y - c.from.y) * dy) / length;
      return Math.abs(off) < 1e-7 && along > -1e-7 && along < length + 1e-7;
    };
    return folds(ours).every((crease) =>
      [0.25, 0.5, 0.75].every((t) => {
        const p = { x: crease.from.x + t * (crease.to.x - crease.from.x), y: crease.from.y + t * (crease.to.y - crease.from.y) };
        return folds(theirs).some((other) => other.letter === crease.letter && on(p, other));
      })
    );
  }

  it('folds the example’s bird base again with no precrease, its H by the same ends, and replays it from the document', async () => {
    const { document, steps } = example();
    expect(steps.map((step) => step.op.kind)).toEqual([
      'valley',
      'valley',
      'squash',
      'turn',
      'squash',
      'precrease',
      'precrease',
      'petal',
      'turn',
      'precrease',
      'precrease',
      'petal',
    ]);
    // The example as saved: H by its ends, creased by the fold; the kites precreased.
    const states = [landed(engine.calls.sheet(document.paper)).state];
    for (const step of steps) states.push(landed(engine.calls.step(states.at(-1)!, step.op, step.choices)).state);
    const [byEnds, byEndsBack] = [steps[7]!.op, steps[11]!.op];
    if (byEnds.kind !== 'petal' || byEndsBack.kind !== 'petal') throw new Error('no petal folds');
    expect(petalHinge(byEnds).kind).toBe('points');
    expect(Object.keys(byEnds)).toEqual(['kind', 'ends', 'petal', 'direction']);
    const overKites = petalAnalysis(states[7]!, byEnds);
    expect([overKites.scores_line, overKites.scores_kites]).toEqual([true, [false, false]]);

    // From the preliminary base, nothing precreased: the same op.
    const base = states[5]!;
    const asked = petalAnalysis(base, byEnds);
    expect(asked.scores_line).toBe(true);
    expect(asked.scores_kites).toEqual([true, true]);
    // The same two ends, in whichever order each finds them, and the same corner.
    for (const end of asked.ends) {
      const nearest = Math.min(...overKites.ends.map((other) => Math.hypot(end[0] - other[0], end[1] - other[1])));
      expect(nearest).toBeLessThan(1e-9);
    }
    expect(Math.hypot(asked.corner[0] - overKites.corner[0], asked.corner[1] - overKites.corner[1])).toBeLessThan(1e-9);

    const front = landed(engine.calls.step(base, byEnds));
    const report = vertexOf(front.compound);
    expect(report.kind).toBe('petal');
    // H in the top layer, twice (either side of the flap's centre crease),
    // and the four kite creases in the top two layers; the folded edges below
    // H's ends unfold.
    expect([report.created.length, report.unfolded.length]).toEqual([6, 2]);
    const tried = landed(engine.vertex.vertexFold(base, byEnds));
    expect(tried.result).toBe('landed');
    if (tried.result === 'landed') expect(tried.fingerprint).toEqual(front.fingerprint);

    // Turned over, the back flap the same way: the example's own op again.
    const turned = landed(engine.calls.step(front.state, steps[8]!.op)).state;
    const bird = landed(engine.calls.step(turned, byEndsBack));
    expect(vertexOf(bird.compound).created).toHaveLength(6);

    // The example's folded creases, letter for letter, whether the kites
    // were precreased first or creased by the petal fold.
    const ours = engine.calls.scene(bird.state).creases;
    const theirs = engine.calls.scene(states[12]!).creases;
    expect(foldedAlong(ours, theirs)).toBe(true);
    expect(foldedAlong(theirs, ours)).toBe(true);
    expect(engine.calls.summary(bird.state).faces).toBe(engine.calls.summary(states[12]!).faces);

    // The path as a document stores it — written, read back — replays every
    // step to ok through the document's replayer.
    const path: FoldStep[] = [
      ...steps.slice(0, 5),
      { id: 'petal-front', parent: steps[4]!.id, op: byEnds },
      { id: 'turn-back', parent: 'petal-front', op: steps[8]!.op },
      { id: 'petal-back', parent: 'turn-back', op: byEndsBack },
    ];
    const written = writeFoldSequence({ document: { ...document, steps: path }, readOnlyRaw: null });
    const held = readFoldSequence(JSON.parse(JSON.stringify(written)));
    if (!held) throw new Error('the path did not read back');
    expect(held.document.steps.map((node) => isLockedStep(node))).toEqual(path.map(() => false));
    const source: FoldEngineSource = {
      generation: () => 0,
      sheet: async (paper) => engine.calls.sheet(paper),
      step: async (state, op, choices) => engine.calls.step(state, op, choices),
      release: async (released) => engine.calls.release(released),
    };
    const replayed = await createFoldReplayer(createFoldEnginePort(source, engine.version)).run({
      loadId: 1,
      sequence: held.document,
    });
    if (!replayed) throw new Error('superseded');
    for (const node of path) expect(replayed.steps.get(node.id)?.status, node.id).toBe('ok');
    expect(replayed.steps.get('petal-back')?.fingerprint).toBe(bird.fingerprint);
  });

  it('refuses ends too near the closed point with the detail that says so, and ends together as a free line’s', () => {
    const { document, steps } = example();
    let state = landed(engine.calls.sheet(document.paper)).state;
    for (const step of steps.slice(0, 5)) state = landed(engine.calls.step(state, step.op, step.choices)).state;
    const first = steps[7]!.op;
    if (first.kind !== 'petal') throw new Error('no petal fold');
    // The closed point, where the two folded edges meet: each edge is H
    // reflected in the kite crease at its end. Ends most of the way to it
    // put the kite creases' corner inside the flap.
    let over = state;
    for (const step of steps.slice(5, 7)) over = landed(engine.calls.step(over, step.op, step.choices)).state;
    const found = petalAnalysis(over, first);
    const [a, b] = found.ends;
    const unit = (v: FoldModelPoint): FoldModelPoint => [v[0] / Math.hypot(...v), v[1] / Math.hypot(...v)];
    const edge = (end: FoldModelPoint, other: FoldModelPoint): FoldModelPoint => {
      const u = unit([other[0] - end[0], other[1] - end[1]]);
      const k = unit([found.corner[0] - end[0], found.corner[1] - end[1]]);
      const d = 2 * (u[0] * k[0] + u[1] * k[1]);
      return [d * k[0] - u[0], d * k[1] - u[1]];
    };
    const [wa, wb] = [edge(a, b), edge(b, a)];
    const s = (wb[0] * (b[1] - a[1]) - wb[1] * (b[0] - a[0])) / (wb[0] * wa[1] - wa[0] * wb[1]);
    const closed: FoldModelPoint = [a[0] + s * wa[0], a[1] + s * wa[1]];
    const high = (end: FoldModelPoint): FoldModelPoint => [end[0] + 0.7 * (closed[0] - end[0]), end[1] + 0.7 * (closed[1] - end[1])];
    const near = endsOn(state, { ...found, ends: [high(a), high(b)] });
    const refused = engine.calls.step(state, petalOp({ kind: 'points', from: near[0], to: near[1] }, first.petal, first.direction));
    if (refused.status !== 'refused') throw new Error('landed');
    expect(refused.refusal).toMatchObject({ code: 'petal_no_flap', cause: 'no_corner', detail: { kind: 'past_corner' } });
    const together = engine.calls.step(state, petalOp({ kind: 'points', from: near[0], to: near[0] }, first.petal, first.direction));
    if (together.status !== 'refused') throw new Error('landed');
    expect(together.refusal.code).toBe('free_line_too_short');
  });
});
