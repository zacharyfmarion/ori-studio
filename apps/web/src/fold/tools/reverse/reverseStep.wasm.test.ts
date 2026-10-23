import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Point } from '../../../lib/geometry';
import { foldPickIndex, resolveFoldPick, type FoldPick, type FoldPickIndex } from '../../canvas/foldPicking';
import { createFoldReplayer } from '../../document/foldReplay';
import { sequenceOf, step } from '../../document/foldSequence.fixtures';
import type { FoldChoices, FoldOp, FoldReverseKind, FoldStep } from '../../document/foldSequenceDocument';
import { readFoldSequence, writeFoldSequence } from '../../document/foldSequenceFile';
import { createFoldEngineCalls, type FoldEngineCalls } from '../../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from '../../engine/foldEngineCompoundCalls';
import type { FoldCompoundAnalysisOf } from '../../engine/foldEngineCompoundWire';
import { createFoldEngineIoCalls, type FoldEngineIoCalls } from '../../engine/foldEngineIoCalls';
import { createFoldEnginePort, type FoldEngineSource } from '../../engine/foldEnginePort';
import type { FoldEngineOp, FoldEngineOutcome } from '../../engine/foldEngineWire';
import { buildFoldStep } from '../foldStepBuilder';
import { lineModeInput, nextStep } from '../foldToolRegistry';
import { buildReverseStep, chosenAt, reverseKindToFold, reverseOpenWays, reverseOrdersOf } from './reverseStep';

/**
 * The reverse fold over the real bridge, in-process, as the tools fold it:
 * the line clicked on the folded pane, the tip described by the compound
 * question, the kind that lands taken and the step built from them — the step a
 * preview lands and a commit stores — and that step replayed through the
 * document. And the crane's neck, tail and head on a bird base Import CP
 * lands from Beloch's crease pattern (`tests/fixtures/fold-crane`, which the
 * engine's crane test keeps to what it folds).
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const FIXTURES = resolve(ROOT, '../../tests/fixtures');
const available = existsSync(WASM);

interface Engine {
  calls: FoldEngineCalls;
  io: FoldEngineIoCalls;
  compound: FoldEngineCompoundCalls;
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
    version: wasm.fold_engine_version(),
  };
}

function landed<T>(outcome: FoldEngineOutcome<T>): T {
  if (outcome.status !== 'ok') throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome;
}

const indexOf = (calls: FoldEngineCalls, state: number): FoldPickIndex =>
  foldPickIndex(calls.scene(state), calls.landmarks(state, []), []);

const RADII = { point: 0.02, line: 0.02 };
const p = (x: number, y: number): Point => ({ x, y });

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

/**
 * A reverse fold along a free line, as the reverse tool builds it: the tip
 * asked about, the kind that lands taken (or `chosen`), the first opening and
 * order listed. The step it builds and the kinds that land.
 */
function reverseAlong(
  { calls, compound }: Engine,
  state: number,
  from: Point,
  to: Point,
  { chosen = null, swapped = false }: { chosen?: FoldReverseKind | null; swapped?: boolean } = {}
): { op: FoldOp; choices?: FoldChoices; kinds: FoldReverseKind[] } {
  const index = indexOf(calls, state);
  const intent = { lineMode: 'free' as const, picks: freeLine(index, from, to), candidate: null, swapped, seed: { scope: 'all' as const } };
  const tip = buildReverseStep({ ...intent, kind: 'inside', openings: [], completion: null }, index);
  if (tip.status !== 'built') throw new Error(`no tip: ${JSON.stringify(tip)}`);
  const op = tip.op as FoldEngineOp & { kind: 'inside-reverse' };
  // The compound question, which a reverse op's family answers.
  const ask = (choices: FoldChoices | undefined): FoldCompoundAnalysisOf<'reverse'> => {
    const answer = landed(compound.compoundAnalysis(state, op, choices));
    if (answer.family !== 'reverse') throw new Error(`answered for ${answer.family}`);
    return answer;
  };
  let asked = ask(tip.choices);
  const way = chosenAt(reverseOpenWays(asked.analysis), 0);
  if (way) asked = ask({ opening: way.stored });
  const kind = reverseKindToFold(chosen, asked.kinds);
  const built = buildReverseStep(
    { ...intent, kind, openings: way?.stored ?? [], completion: chosenAt(reverseOrdersOf(asked, kind), 0) },
    index
  );
  if (built.status !== 'built') throw new Error(`not built: ${JSON.stringify(built)}`);
  return { op: built.op, ...(built.choices ? { choices: built.choices } : {}), kinds: asked.kinds };
}

/** The square valley-folded along its diagonal from (0, 1) to (1, 0), the corner a = (0, 0) onto c = (1, 1). */
function triangle({ calls }: Engine, sheet: number): { op: FoldOp; state: number } {
  const index = indexOf(calls, sheet);
  const built = buildFoldStep(
    {
      kind: 'valley',
      lineMode: 'free',
      picks: freeLine(index, p(0, 1), p(1, 0)),
      candidate: null,
      swapped: false,
      seed: { scope: 'all' },
      precreaseDirection: 'valley',
    },
    index
  );
  if (built.status !== 'built') throw new Error('no triangle');
  return { op: built.op, state: landed(calls.step(sheet, built.op)).state };
}

/** The source of a fixture file, as Import CP reads it. */
const fixture = (path: string) => new Uint8Array(readFileSync(resolve(FIXTURES, path)));

describe.skipIf(!available)('the reverse fold over the real bridge', () => {
  // The preliminary base's silhouette by the triangle's corners b and d
  // reversed inside. It is not the classic base: that also creases the
  // diagonal ac (8 faces), which two reverses of a once-folded triangle
  // leave flat (6 faces).
  it('reverses the triangle’s two corners inside to the preliminary base’s square, and replays it from the document', async () => {
    const engined = await engine();
    const { calls, version } = engined;
    const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    const tri = triangle(engined, sheet);
    expect(calls.summary(tri.state).faces).toBe(2);

    // The corner b below y = ½: only the inside reverse lands, and it is taken.
    const first = reverseAlong(engined, tri.state, p(0.55, 0.5), p(0.95, 0.5));
    expect(first.kinds).toEqual(['inside']);
    expect(first.op).toMatchObject({ kind: 'inside-reverse', line: { via: 'free' }, seed: { scope: 'all' } });
    const one = landed(calls.step(tri.state, first.op, first.choices));
    expect(one.compound).toMatchObject({ family: 'reverse', kind: 'inside' });
    expect(one.summary.faces).toBe(4);

    // The corner d left of x = ½.
    const second = reverseAlong(engined, one.state, p(0.5, 0.55), p(0.5, 0.95));
    expect(second.kinds).toEqual(['inside']);
    const base = landed(calls.step(one.state, second.op, second.choices));
    expect(base.summary.faces).toBe(6);
    expect(base.summary.creases.border).toBe(8);
    expect(base.summary.creases.mountain + base.summary.creases.valley).toBe(6);
    // Its picture pushes the spine in, and its summary reverses it.
    const acted = landed(calls.stepAction(base.state)).action;
    expect(acted?.push).toBeDefined();
    expect(acted?.direction).toBe('mountain');
    expect(landed(calls.stepSummary(base.state)).summary?.diff.reversed.length).toBeGreaterThan(0);

    // Stored as the document stores it, written and read back, and replayed.
    const steps: FoldStep[] = [
      step('fstep-1', null, tri.op),
      step('fstep-2', 'fstep-1', first.op, first.choices ? { choices: first.choices } : {}),
      step('fstep-3', 'fstep-2', second.op, second.choices ? { choices: second.choices } : {}),
    ];
    const held = readFoldSequence(JSON.parse(JSON.stringify(writeFoldSequence({ document: sequenceOf(steps), readOnlyRaw: null }))));
    if (!held) throw new Error('not read back');
    const source: FoldEngineSource = {
      generation: () => 0,
      sheet: async (paper) => calls.sheet(paper),
      step: async (state, op, choices) => calls.step(state, op, choices),
      release: async (states) => calls.release(states),
    };
    const done = await createFoldReplayer(createFoldEnginePort(source, version)).run({ loadId: 1, sequence: held.document });
    const replayed = done?.steps.get('fstep-3');
    expect(replayed?.status).toBe('ok');
    expect(replayed?.fingerprint).toBe(calls.fingerprint(base.state));
  });

  it('takes the outside reverse where only it lands', async () => {
    const engined = await engine();
    const { calls } = engined;
    const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    const tri = triangle(engined, sheet);
    // The corner b right of x = ½, the side with more paper: swapped to it.
    const across = reverseAlong(engined, tri.state, p(0.5, 0.55), p(0.5, 0.95), { swapped: true });
    expect(across.kinds).toEqual(['outside']);
    expect(across.op.kind).toBe('outside-reverse');
    const wrapped = landed(calls.step(tri.state, across.op, across.choices));
    expect(wrapped.compound).toMatchObject({ family: 'reverse', kind: 'outside' });
    // An outside reverse wraps round: no push, a valley as the viewer sees it.
    const acted = landed(calls.stepAction(wrapped.state)).action;
    expect(acted?.push).toBeUndefined();
    expect(acted?.direction).toBe('valley');
    // Asked for inside regardless, it is refused, offering the outside fold.
    const outside = across.op;
    if (outside.kind !== 'outside-reverse') throw new Error('not an outside reverse');
    const inside = calls.step(tri.state, { ...outside, kind: 'inside-reverse' }, across.choices);
    expect(inside).toMatchObject({
      status: 'refused',
      refusal: { code: 'reverse_kind_infeasible', kind: 'inside' },
      fixes: [{ fix: 'other_kind', kind: 'outside' }],
    });
  });

  it('reverses the crane’s neck, tail and head on a bird base imported from Beloch’s crease pattern', async () => {
    const { calls, io } = await engine();
    const crane = JSON.parse(readFileSync(resolve(FIXTURES, 'fold-crane/crane-on-bird-base.json'), 'utf8')) as {
      import: { fixture: string; choice: number[] };
      steps: { name: string; op: FoldEngineOp; choices: FoldChoices; faces: number }[];
    };
    // The CP kernel's reader takes a FOLD file's y-up coordinates as its own
    // y-down ones, so Import CP lands a file mirrored top to bottom; the
    // fixture's steps are in Beloch's own frame, so the file is mirrored
    // first and lands there.
    const file = JSON.parse(new TextDecoder().decode(fixture(crane.import.fixture))) as { vertices_coords: [number, number][] };
    const text = JSON.stringify({ ...file, vertices_coords: file.vertices_coords.map(([x, y]) => [x, 1 - y]) });
    const opened = landed(io.importCp({ format: 'fold', text }, { kind: 'empty', startSide: 'front' }));
    // The bird base's letters decide its order; its flat creases are guides
    // to the CP kernel's reader, so it lands without its precreases.
    expect(opened.count).toEqual({ orders: 1, exact: true });
    const bird = landed(io.importPick(opened.import, crane.import.choice));
    expect(bird.summary.faces).toBe(12);
    let state = bird.state;
    for (const { name, op, choices, faces } of crane.steps) {
      const folded = calls.step(state, op, choices);
      if (folded.status !== 'ok') throw new Error(`${name}: ${JSON.stringify(folded.refusal)}`);
      expect(folded.summary.faces, name).toBe(faces);
      if (op.kind === 'inside-reverse') {
        expect(folded.compound, name).toMatchObject({ family: 'reverse', kind: 'inside' });
        expect(landed(calls.stepAction(folded.state)).action?.push, name).toBeDefined();
      }
      state = folded.state;
    }
    expect(calls.summary(state).faces).toBe(52);
  });
});
