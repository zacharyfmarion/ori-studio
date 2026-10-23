import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import type { Point } from '../../../lib/geometry';
import { foldPickIndex, resolveFoldPick, type FoldPick, type FoldPickIndex } from '../../canvas/foldPicking';
import { createFoldReplayer } from '../../document/foldReplay';
import { sequenceOf, step } from '../../document/foldSequence.fixtures';
import type { FoldDirection, FoldOp, FoldStep } from '../../document/foldSequenceDocument';
import { readFoldSequence, writeFoldSequence } from '../../document/foldSequenceFile';
import { createFoldEngineCalls, type FoldEngineCalls } from '../../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from '../../engine/foldEngineCompoundCalls';
import type { FoldEngineTuckOp, FoldTuckAnalysis } from '../../engine/foldEngineCrimpTuckWire';
import { createFoldEnginePort, type FoldEngineSource } from '../../engine/foldEnginePort';
import type { FoldEngineOp, FoldEngineOutcome } from '../../engine/foldEngineWire';
import { buildFoldStep, type FoldLocateIntent } from '../foldStepBuilder';
import type { FoldToolSeed } from '../foldToolState';
import { lineModeInput, nextStep } from '../foldToolRegistry';
import { foldRefusalNotice } from '../refusalNotice';
import { buildTuckStep, tuckTargetChosen, tuckTargetsOf } from './tuckStep';

/**
 * The tuck over the real bridge, in-process, as the tuck tool folds it: the
 * line clicked on the folded pane, the layers it can go against listed by
 * the compound question — only those offered, never a free pick — the first
 * taken, and the step built against it; then asked what it moves, pictured,
 * and replayed through the document. And a tuck against a layer it does not
 * fit, refused with the layers that do as its fixes, which act.
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
  version: number;
}

async function engine(): Promise<Engine> {
  const wasm = await import('../../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const fold = new wasm.FoldEngine();
  return {
    calls: createFoldEngineCalls(fold),
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

/** The square valley-folded along a free line through `from` and `to`, the smaller side moving. */
function folded({ calls }: Engine, from: Point, to: Point, swapped = false): { op: FoldOp; state: number } {
  const sheet = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
  const index = indexOf(calls, sheet);
  const built = buildFoldStep(
    {
      kind: 'valley',
      lineMode: 'free',
      picks: freeLine(index, from, to),
      candidate: null,
      swapped,
      seed: { scope: 'all' },
      precreaseDirection: 'valley',
    },
    index
  );
  if (built.status !== 'built') throw new Error('not folded');
  return { op: built.op, state: landed(calls.step(sheet, built.op)).state };
}

/** What the tools list for a tuck's line, side and seed: the compound question's answer. */
function listing({ calls, compound }: Engine, state: number, intent: FoldLocateIntent, direction: FoldDirection): FoldTuckAnalysis {
  const index = indexOf(calls, state);
  const unaimed = buildTuckStep({ ...intent, direction, target: null, completion: null }, index);
  if (unaimed.status !== 'built' || unaimed.op.kind !== 'tuck') throw new Error(`not located: ${JSON.stringify(unaimed)}`);
  const answer = landed(compound.compoundAnalysis(state, unaimed.op, unaimed.choices));
  if (answer.family !== 'tuck') throw new Error(`answered for ${answer.family}`);
  return answer.analysis;
}

/** A `t` that answers with the English default, interpolated: the notice's words as a folder reads them. */
const t = ((key: string, second?: unknown, third?: unknown) => {
  const options = (typeof second === 'object' && second !== null ? second : third) as Record<string, unknown> | undefined;
  const text = typeof second === 'string' ? second : String(options?.defaultValue_other ?? options?.defaultValue ?? key);
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
}) as unknown as TFunction;

describe.skipIf(!available)('the tuck over the real bridge', () => {
  it('tucks the bottom layer’s corner under the top one — the one layer listed — and replays it from the document', async () => {
    const engined = await engine();
    const { calls, version } = engined;
    // The book fold, the left half over the right: two layers on [½, 1] × [0, 1].
    const book = folded(engined, p(0.5, 1), p(0.5, 0));
    const index = indexOf(calls, book.state);
    const picks = freeLine(index, p(0.7, 0.02), p(0.98, 0.3));
    const all: FoldLocateIntent = { lineMode: 'free', picks, candidate: null, swapped: false, seed: { scope: 'all' } };

    // Every layer at the corner: the block would land on top of everything, so no layer takes it under.
    expect(tuckTargetsOf(listing(engined, book.state, all, 'valley'))).toEqual([]);

    // The bottom layer's corner alone, as the picker narrows to its flap: the top layer takes it.
    const plain = landed(calls.analyse(book.state, plainAlong(all, index)));
    const bottom = plain.analysis.flaps.at(-1);
    if (!bottom) throw new Error('no flaps');
    const seed: FoldToolSeed = { scope: 'flaps', flaps: [bottom] };
    const narrowed: FoldLocateIntent = { ...all, seed };
    const analysis = listing(engined, book.state, narrowed, 'valley');
    expect(analysis.placement).toBe('under');
    const targets = tuckTargetsOf(analysis);
    expect(targets).toHaveLength(1);
    // Every layer the block lands on is listed by the engine; only the one that takes the tuck is offered.
    expect(analysis.targets.every((target) => target.feasible !== null)).toBe(true);
    const target = tuckTargetChosen(targets, null);
    if (!target) throw new Error('no target');
    const built = buildTuckStep({ ...narrowed, direction: 'valley', target: target.at, completion: null }, index);
    if (built.status !== 'built') throw new Error('not built');
    expect(built.op).toMatchObject({ kind: 'tuck', direction: 'valley', target: target.at, seed: { scope: 'flaps' } });

    // What it moves against T: the bottom corner alone.
    const moving = landed(calls.analyse(book.state, built.op, built.choices)).analysis.moving;
    expect(moving).toHaveLength(1);
    const pictured = landed(calls.action(book.state, built.op, built.choices)).action;
    expect(pictured.grip).not.toBeNull();
    expect(pictured.direction).toBe('valley');

    const tucked = landed(calls.step(book.state, built.op, built.choices));
    expect(tucked.compound).toMatchObject({ family: 'tuck', placement: 'under', target: target.face });
    // Under the top layer: one layer over the corner where it lands.
    expect(landed(calls.stepAction(tucked.state)).action?.grip?.hidden_image).toBe(1);

    const steps: FoldStep[] = [step('fstep-1', null, book.op), step('fstep-2', 'fstep-1', built.op)];
    const held = readFoldSequence(JSON.parse(JSON.stringify(writeFoldSequence({ document: sequenceOf(steps), readOnlyRaw: null }))));
    if (!held) throw new Error('not read back');
    const source: FoldEngineSource = {
      generation: () => 0,
      sheet: async (paper) => calls.sheet(paper),
      step: async (state, op, choices) => calls.step(state, op, choices),
      release: async (states) => calls.release(states),
    };
    const done = await createFoldReplayer(createFoldEnginePort(source, version)).run({ loadId: 1, sequence: held.document });
    expect(done?.steps.get('fstep-2')?.fingerprint).toBe(calls.fingerprint(tucked.state));
  });

  it('refuses a tuck against a layer it does not fit, its fixes the layers that do, which act', async () => {
    const { calls, compound } = await engine();
    // The tuck campaign's first draw of seed 1 (`oristudio-fold`'s tuck test):
    // three plain folds, then a mountain tuck of one layer over a layer it
    // does not fit — never one the tools offer, but a stored step can name it.
    let state = landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
    for (const op of CAMPAIGN_FOLDS) state = landed(calls.step(state, op)).state;
    const listed = landed(compound.compoundAnalysis(state, CAMPAIGN_TUCK));
    if (listed.family !== 'tuck') throw new Error(`answered for ${listed.family}`);
    const analysis = listed.analysis;
    const refused = calls.step(state, CAMPAIGN_TUCK);
    if (refused.status !== 'refused') throw new Error('the tuck landed');
    expect(refused.refusal).toMatchObject({ code: 'tuck_infeasible', placement: 'over' });
    const target = refused.refusal.code === 'tuck_infeasible' ? refused.refusal.target : null;
    // Never offered by the tools: only the layers that take it are.
    expect(analysis.targets.find((listedTarget) => listedTarget.face === target)?.feasible).toBe(false);
    expect(tuckTargetsOf(analysis).some((offered) => offered.face === target)).toBe(false);
    const intent = { op: CAMPAIGN_TUCK, under: false };

    const offered = tuckTargetsOf(analysis).map((listedTarget) => listedTarget.face);
    const tuckTarget = vi.fn();
    const notice = foldRefusalNotice(
      t,
      refused,
      {
        kind: 'tuck',
        readOnly: false,
        flapNumber: (flap) => flap + 1,
        flapOf: null,
        tuck: { under: intent.under, targetNumber: (face) => (offered.includes(face) ? offered.indexOf(face) + 1 : null) },
      },
      { includeFlaps: vi.fn(), foldOtherWay: vi.fn(), pickFlap: vi.fn(), useLine: vi.fn(), tuckTarget }
    );
    expect(notice.title).toBe('It cannot be tucked over that layer');
    expect(notice.text).toBe('No way of stacking the layers puts the flap right against that layer. Another layer here takes it.');
    const fixes = refused.fixes.flatMap((fix) => (fix.fix === 'tuck_target' ? [fix] : []));
    expect(fixes.length).toBeGreaterThan(0);
    // Every fix the engine offers is a button, naming the layer by its place in the tools' list.
    expect(notice.actions).toHaveLength(fixes.length);
    for (const [k, fix] of fixes.entries()) {
      expect(offered).toContain(fix.face);
      expect(notice.actions[k]?.label).toBe(`Tuck over listed layer ${offered.indexOf(fix.face) + 1} instead`);
      notice.actions[k]?.run();
      expect(tuckTarget).toHaveBeenLastCalledWith(fix.face);
      // And the tuck against the layer it names, as the tools would build it, lands.
      const at = analysis.targets.find((listedTarget) => listedTarget.face === fix.face)?.at;
      if (!at) throw new Error('fixed target not listed');
      expect(calls.step(state, { ...intent.op, target: at }).status).toBe('ok');
    }
  });
});

/**
 * The tuck campaign's first draw of seed 1 (`random::folded_between` and
 * `random::tuck_fold` on `Rng::new(9001)`), as the bridge takes it: every
 * line in the model frame with its side, as the tools give a model line.
 */
const CAMPAIGN_FOLDS: FoldEngineOp[] = [
  {
    kind: 'mountain',
    line: { via: 'model', line: { n: [0.2015560033549115, 0.9794769918234909], d: 0.8632161569133894 } },
    side: 'positive',
    seed: { scope: 'flaps', at: [[0.5773886087715614, 0.881244287911424]] },
  },
  {
    kind: 'valley',
    line: { via: 'model', line: { n: [0.3009039069033019, 0.9536544651027064], d: 0.6628560809129502 } },
    side: 'negative',
    seed: { scope: 'flaps', at: [[0.8648386315548118, 0.9864041981672111]] },
  },
  {
    kind: 'valley',
    line: { via: 'model', line: { n: [0.9979046178774872, -0.06470219176184315], d: 0.09973517888600814 } },
    side: 'negative',
    seed: { scope: 'all' },
  },
];

const CAMPAIGN_TUCK: FoldEngineTuckOp = {
  kind: 'tuck',
  line: { via: 'model', line: { n: [0.9328485865557615, 0.36026866996856394], d: 0.6701398198454672 } },
  side: 'positive',
  direction: 'mountain',
  seed: { scope: 'depth', at: [0.6282614059617644, 0.585186624282551], layers: 1 },
  target: [0.07536198770004521, 0.7700717472146723],
};

/** The plain valley fold along an intent's line, side and seed: what a tuck's flaps are read from. */
function plainAlong(intent: FoldLocateIntent, index: FoldPickIndex): FoldOp {
  const built = buildFoldStep({ ...intent, kind: 'valley', precreaseDirection: 'valley' }, index);
  if (built.status !== 'built') throw new Error('not located');
  return built.op;
}
