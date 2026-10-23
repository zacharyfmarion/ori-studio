import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import type { Point } from '../../../lib/geometry';
import { foldPickIndex, resolveFoldPick, type FoldPick, type FoldPickIndex } from '../../canvas/foldPicking';
import { createFoldReplayer } from '../../document/foldReplay';
import { sequenceOf, step } from '../../document/foldSequence.fixtures';
import type { FoldChoices, FoldCrimpKind, FoldOp, FoldStep } from '../../document/foldSequenceDocument';
import { readFoldSequence, writeFoldSequence } from '../../document/foldSequenceFile';
import { createFoldEngineCalls, type FoldEngineCalls } from '../../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from '../../engine/foldEngineCompoundCalls';
import type { FoldCompoundAnalysisOf } from '../../engine/foldEngineCompoundWire';
import { createFoldEngineCrimpTuckCalls, type FoldEngineCrimpTuckCalls } from '../../engine/foldEngineCrimpTuckCalls';
import { createFoldEnginePort, type FoldEngineSource } from '../../engine/foldEnginePort';
import type { FoldEngineOutcome } from '../../engine/foldEngineWire';
import { foldSentenceStepOf } from '../../sequence/foldSentenceStep';
import { foldStepSentence } from '../../stepSentence';
import { buildFoldStep } from '../foldStepBuilder';
import { lineModeInput, nextStep } from '../foldToolRegistry';
import { foldRefusalNotice } from '../refusalNotice';
import { chosenAt, reverseOpenWays } from '../reverse/reverseStep';
import { buildCrimpStep, crimpKindToFold } from './crimpStep';

/**
 * The crimp over the real bridge, in-process, as the crimp tool folds it:
 * both lines clicked on the folded pane, the tip described by the compound
 * question, the kind that lands taken, the orders listed by the crimp's own
 * call, and the step built from them — the step a preview lands and a commit
 * stores — then asked what it moves and pictured, and replayed through the
 * document.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

interface Engine {
  calls: FoldEngineCalls;
  compound: FoldEngineCompoundCalls;
  crimpTuck: FoldEngineCrimpTuckCalls;
  version: number;
}

async function engine(): Promise<Engine> {
  const wasm = await import('../../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const fold = new wasm.FoldEngine();
  return {
    calls: createFoldEngineCalls(fold),
    compound: createFoldEngineCompoundCalls(fold),
    crimpTuck: createFoldEngineCrimpTuckCalls(fold),
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

/** The square valley-folded along its diagonal from (0, 1) to (1, 0): the triangle b c d, two layers. */
function triangle({ calls }: Engine): { op: FoldOp; state: number } {
  const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
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

/**
 * A crimp along two free lines, as the crimp tool builds it: the tip asked
 * about, the opening taken, the kind that lands taken (or `chosen`), the
 * orders listed by its own call and the first taken. The step it builds,
 * the kinds that land and how many orders were listed.
 */
function crimpAlong(
  { calls, compound, crimpTuck }: Engine,
  state: number,
  first: [Point, Point],
  second: [Point, Point],
  { chosen = null, swapped = false }: { chosen?: FoldCrimpKind | null; swapped?: boolean } = {}
): { op: FoldOp; choices?: FoldChoices; kinds: FoldCrimpKind[]; orders: number } {
  const index = indexOf(calls, state);
  const intent = {
    lineMode: 'free' as const,
    secondLineMode: 'free' as const,
    picks: [...freeLine(index, ...first), ...freeLine(index, ...second)],
    candidate: null,
    swapped,
    seed: { scope: 'all' as const },
  };
  const tip = buildCrimpStep({ ...intent, kind: 'inside', openings: [], completion: null }, index);
  if (tip.status !== 'built' || tip.op.kind !== 'crimp') throw new Error(`no tip: ${JSON.stringify(tip)}`);
  const op = tip.op;
  const ask = (choices: FoldChoices | undefined): FoldCompoundAnalysisOf<'crimp'> => {
    const answer = landed(compound.compoundAnalysis(state, op, choices));
    if (answer.family !== 'crimp') throw new Error(`answered for ${answer.family}`);
    return answer;
  };
  let asked = ask(tip.choices);
  const way = chosenAt(reverseOpenWays(asked.analysis.tip), 0);
  if (way) asked = ask({ opening: way.stored });
  const kinds = asked.kinds ?? [];
  const kind = crimpKindToFold(chosen, kinds);
  // The orders, from the crimp's own call; every state it landed let go.
  const tried = landed(crimpTuck.crimp(state, { ...op, crimp: kind }, way ? { opening: way.stored } : undefined));
  const listed =
    tried.outcome === 'choose_order' ? tried.candidates.flatMap((candidate) => candidate.stored.completion ?? []) : [];
  calls.release(tried.outcome === 'landed' ? [tried.state] : tried.outcome === 'choose_order' ? tried.candidates.map((c) => c.state) : []);
  const built = buildCrimpStep(
    { ...intent, kind, openings: way?.stored ?? [], completion: chosenAt(listed, 0) },
    index
  );
  if (built.status !== 'built') throw new Error(`not built: ${JSON.stringify(built)}`);
  return { op: built.op, ...(built.choices ? { choices: built.choices } : {}), kinds, orders: listed.length };
}

/** A `t` that answers with the English default, interpolated: the notice's words as a folder reads them. */
const t = ((key: string, second?: unknown, third?: unknown) => {
  const options = (typeof second === 'object' && second !== null ? second : third) as Record<string, unknown> | undefined;
  const text = typeof second === 'string' ? second : String(options?.defaultValue_other ?? options?.defaultValue ?? key);
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
}) as unknown as TFunction;

describe.skipIf(!available)('the crimp over the real bridge', () => {
  it('crimps the triangle’s corner along two parallel lines, either kind, and replays it from the document', async () => {
    const engined = await engine();
    const { calls, version } = engined;
    const tri = triangle(engined);
    expect(calls.summary(tri.state).faces).toBe(2);

    // The first line square to the spine, the second parallel beyond it, the
    // smaller side — the corner d — the tip: both kinds land, inside taken.
    const crimp = crimpAlong(engined, tri.state, [p(0.45, 0.65), p(0.75, 0.95)], [p(0.3, 0.8), p(0.45, 0.95)]);
    expect(crimp.kinds).toEqual(['inside', 'outside']);
    expect(crimp.orders).toBe(0);
    expect(crimp.op).toMatchObject({
      kind: 'crimp',
      crimp: 'inside',
      line: { via: 'free' },
      second: { via: 'free' },
      seed: { scope: 'all' },
    });

    // What it moves, as the layer picker reads it: the tip at ℓ1, both layers.
    const analysed = landed(calls.analyse(tri.state, crimp.op, crimp.choices)).analysis;
    expect(analysed.moving.length).toBe(2);
    expect(analysed.flaps.length).toBeGreaterThan(0);
    // Its picture before it lands: ℓ1, no grip, the pleat across both lines.
    const pictured = landed(calls.action(tri.state, crimp.op, crimp.choices)).action;
    expect(pictured.line).not.toBeNull();
    expect(pictured.grip).toBeNull();
    expect(pictured.pleat?.kinks).toBe(1);

    const folded = landed(calls.step(tri.state, crimp.op, crimp.choices));
    expect(folded.compound).toMatchObject({ family: 'crimp', kind: 'inside' });
    expect(folded.compound?.motion.legs.length).toBeGreaterThan(0);
    // The step's picture is the preview's.
    expect(landed(calls.stepAction(folded.state)).action).toEqual(pictured);
    expect(landed(calls.stepSummary(folded.state)).summary?.diff.added.length).toBe(4);
    // Its sentence names both lines, and the layers it takes.
    expect(foldStepSentence(t, foldSentenceStepOf(crimp.op, { parent: null, child: null, report: null }))).toBe(
      'Inside crimp along the line drawn, then back along a second line drawn beyond it, through all layers.'
    );

    // The outside crimp lands too, as the other kind the control offers.
    const outside = crimpAlong(engined, tri.state, [p(0.45, 0.65), p(0.75, 0.95)], [p(0.3, 0.8), p(0.45, 0.95)], {
      chosen: 'outside',
    });
    expect(landed(calls.step(tri.state, outside.op, outside.choices)).compound).toMatchObject({ kind: 'outside' });

    // Stored as the document stores it, written and read back, and replayed.
    const steps: FoldStep[] = [
      step('fstep-1', null, tri.op),
      step('fstep-2', 'fstep-1', crimp.op, crimp.choices ? { choices: crimp.choices } : {}),
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
    const replayed = done?.steps.get('fstep-2');
    expect(replayed?.status).toBe('ok');
    expect(replayed?.fingerprint).toBe(calls.fingerprint(folded.state));
  });

  it('takes the one kind that lands, and words the other’s refusal with the kind that fits as its fix', async () => {
    const engined = await engine();
    const { calls } = engined;
    const tri = triangle(engined);
    // Spike case 3, "perp": ℓ1 square to the spine, ℓ2 at 36.87° through
    // (0.62, 0.38), the corner b the tip (swapped to it): only inside lands.
    const angle = (36.87 * Math.PI) / 180;
    const along = (t0: number) => p(0.62 + t0 * Math.cos(angle), 0.38 + t0 * Math.sin(angle));
    const crimp = crimpAlong(engined, tri.state, [p(0.45, 0.65), p(0.75, 0.95)], [along(0.05), along(0.3)], {
      chosen: 'outside',
      swapped: true,
    });
    expect(crimp.kinds).toEqual(['inside']);
    // The folder's outside does not land, so the one that does is taken.
    expect(crimp.op).toMatchObject({ kind: 'crimp', crimp: 'inside' });
    expect(landed(calls.step(tri.state, crimp.op, crimp.choices)).compound).toMatchObject({ family: 'crimp' });

    // Asked for outside regardless, it is refused, offering the inside crimp.
    if (crimp.op.kind !== 'crimp') throw new Error('not a crimp');
    const refused = calls.step(tri.state, { ...crimp.op, crimp: 'outside' }, crimp.choices);
    if (refused.status !== 'refused') throw new Error('the outside crimp landed');
    expect(refused.refusal.code).toBe('crimp_kind_infeasible');
    const otherKind = vi.fn();
    const notice = foldRefusalNotice(
      t,
      refused,
      { kind: 'crimp', readOnly: false, flapNumber: (flap) => flap + 1, flapOf: null },
      { includeFlaps: vi.fn(), foldOtherWay: vi.fn(), pickFlap: vi.fn(), useLine: vi.fn(), otherKind }
    );
    expect(notice.title).toBe('It cannot crimp round the outside');
    expect(notice.text).toBe('No way of stacking the layers lets the tip turn this way on both lines. The other kind of crimp may fit.');
    expect(notice.actions.map((action) => action.label)).toEqual(['Inside crimp instead']);
    notice.actions[0]?.run();
    expect(otherKind).toHaveBeenCalledWith('inside');
  });

  it('refuses lines that cross over the flap, in a folder’s words', async () => {
    const engined = await engine();
    const { calls } = engined;
    const tri = triangle(engined);
    const index = indexOf(calls, tri.state);
    const built = buildCrimpStep(
      {
        lineMode: 'free',
        secondLineMode: 'free',
        picks: [...freeLine(index, p(0.45, 0.65), p(0.75, 0.95)), ...freeLine(index, p(0.3, 0.9), p(0.95, 0.85))],
        candidate: null,
        swapped: false,
        seed: { scope: 'all' },
        kind: 'inside',
        openings: [],
        completion: null,
      },
      index
    );
    if (built.status !== 'built') throw new Error('no crimp');
    const asked = engined.compound.compoundAnalysis(tri.state, built.op as FoldOp & { kind: 'crimp' });
    if (asked.status !== 'refused') throw new Error('the crossing lines were asked about');
    expect(asked.refusal.code).toBe('crimp_lines_meet');
    const notice = foldRefusalNotice(
      t,
      asked,
      { kind: 'crimp', readOnly: false, flapNumber: (flap) => flap + 1, flapOf: null },
      { includeFlaps: vi.fn(), foldOtherWay: vi.fn(), pickFlap: vi.fn(), useLine: vi.fn() }
    );
    expect(notice.title).toBe('The lines meet');
    expect(notice.actions).toEqual([]);
  });
});
