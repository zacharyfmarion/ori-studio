import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Point } from '../../lib/geometry';
import { foldPickIndex, resolveFoldPick, sheetToScene, type FoldPick, type FoldPickIndex } from '../canvas/foldPicking';
import type { SheetPoint } from '../document/foldSequenceDocument';
import { createFoldEngineCalls, type FoldEngineCalls } from '../engine/foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from '../engine/foldEngineCompoundCalls';
import type { FoldEngineCompoundOp } from '../engine/foldEngineCompoundWire';
import { createFoldEngineIoCalls } from '../engine/foldEngineIoCalls';
import { FOLD_SAMPLES, foldSampleSource } from '../engine/foldEngineIoSamples';
import type { FoldAxiomCandidate, FoldEngineOp, FoldEngineOutcome } from '../engine/foldEngineWire';
import { buildCrimpStep } from './crimp/crimpStep';
import { axiomLineOfPicks, buildFoldStep, type FoldLocateIntent, type FoldStepBuild } from './foldStepBuilder';
import type { FoldKind, FoldLineModeId } from './foldToolCatalog';
import { lineModeInput, nextStep } from './foldToolRegistry';
import { buildReverseStep } from './reverse/reverseStep';
import { buildSinkStep } from './sink/sinkStep';
import { buildTuckStep } from './tuck/tuckStep';

/**
 * Swap, over the real bridge, in every line mode and for every op whose
 * window offers it: the step a swapped intent builds names the other side,
 * and the engine folds that side — the side a step names beats the side its
 * axiom implies (`State::resolve_anchored`), for the plain folds and the
 * compound folds along a line alike. Each case clicks the folded pane as the
 * canvas resolves a click, takes the axiom's first root as the canvas does,
 * and asks the engine what the plain and the swapped step move.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(WASM);

async function engine() {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  const fold = new wasm.FoldEngine();
  return {
    calls: createFoldEngineCalls(fold),
    io: createFoldEngineIoCalls(fold),
    compound: createFoldEngineCompoundCalls(fold),
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

/** The clicks a line mode takes, at these points of the folded pane, as the canvas resolves them. */
function clicks(index: FoldPickIndex, mode: FoldLineModeId, at: readonly Point[], first = 0): FoldPick[] {
  const model = lineModeInput(mode);
  return at.map((point, k) => {
    const step = nextStep(model, first + k);
    if (!step) throw new Error('too many clicks');
    const pick = resolveFoldPick(index, 'folded', point, RADII, { snap: step.snap, edges: step.edges, free: false });
    if (!pick) throw new Error(`nothing to pick at ${point.x}, ${point.y}`);
    return pick;
  });
}

/** The axiom's first root, as the canvas takes it before the folder steps through them; null for another mode. */
function rootOf(calls: FoldEngineCalls, state: number, mode: FoldLineModeId, picks: readonly FoldPick[]): FoldAxiomCandidate | null {
  const line = axiomLineOfPicks(mode, picks);
  if (!line) return null;
  const [first] = landed(calls.axiomCandidates(state, line)).candidates;
  if (!first) throw new Error(`${mode}: no root`);
  return first;
}

/** A located line, plain and swapped, as the tools hold it. */
function intents(calls: FoldEngineCalls, state: number, mode: FoldLineModeId, picks: FoldPick[]): [FoldLocateIntent, FoldLocateIntent] {
  const candidate = rootOf(calls, state, mode, picks);
  const plain: FoldLocateIntent = { lineMode: mode, picks, candidate, swapped: false, seed: { scope: 'all' } };
  return [plain, { ...plain, swapped: true }];
}

function built(build: FoldStepBuild): Extract<FoldStepBuild, { status: 'built' }> {
  if (build.status !== 'built') throw new Error(`not built: ${JSON.stringify(build)}`);
  return build;
}

type Built = Extract<FoldStepBuild, { status: 'built' }>;

/** The side of its line the engine moves for a plain fold: what the canvas lights, and what lands. */
function plainSide(calls: FoldEngineCalls, state: number, step: Built): string {
  return landed(calls.analyse(state, step.op as FoldEngineOp, step.choices)).analysis.side;
}

/**
 * The side a compound fold's family takes as its tip, as its compound
 * question answers it — what the window describes and the canvas lights —
 * or the refusal's code when that side has no tip to fold.
 */
function compoundSide(compound: FoldEngineCompoundCalls, state: number, step: Built): string {
  const answer = compound.compoundAnalysis(state, step.op as FoldEngineCompoundOp, step.choices);
  if (answer.status !== 'ok') return `refused:${answer.refusal.code}`;
  switch (answer.family) {
    case 'reverse':
    case 'tuck':
    case 'sink':
      return answer.analysis.side;
    case 'crimp':
      return answer.analysis.tip.side;
    default:
      throw new Error(`answered for ${answer.family}`);
  }
}

/** The plain and the swapped step: the swap names the other side with a point on it. */
function expectOtherSide(plain: Built, swapped: Built) {
  expect(swapped.movingSign).toBe(-plain.movingSign);
  expect(swapped.op).toHaveProperty('moving');
}

const other = (side: string) => (side === 'positive' ? 'negative' : 'positive');

function sheetOf(calls: FoldEngineCalls): number {
  return landed(calls.sheet({ shape: { kind: 'square' }, startSide: 'front' })).state;
}

/**
 * Every line mode's clicks on the flat square, at points of the folded pane
 * (the sheet's own frame): two that imply a side and one that does not for
 * the axioms; the existing crease is a precrease along x = 0.3, made first.
 */
const SQUARE_CLICKS: Record<Exclude<FoldLineModeId, 'crease'>, Point[]> = {
  // Through a corner and the right edge's middle.
  'axiom-1': [p(0, 0), p(1, 0.5)],
  // The top-left corner onto the bottom-right one.
  'axiom-2': [p(0, 1), p(1, 0)],
  // The bottom edge onto the left one.
  'axiom-3': [p(0.5, 0), p(0, 0.5)],
  // Square to the bottom edge, through the top edge's middle.
  'axiom-4': [p(0.5, 0), p(0.5, 1)],
  // The top-left corner onto the right edge, through the bottom edge's middle.
  'axiom-5': [p(0, 1), p(0.5, 0), p(1, 0.5)],
  // The bottom edge's middle onto the right edge, the left edge's onto the top.
  'axiom-6': [p(0.5, 0), p(1, 0.5), p(0, 0.5), p(0.5, 1)],
  // The top-left corner onto the right edge, square to the top edge.
  'axiom-7': [p(0, 1), p(1, 0.5), p(0.5, 1)],
  free: [p(0.3, -0.05), p(0.3, 1.05)],
};

const KINDS: readonly FoldKind[] = ['valley', 'mountain', 'precrease'];

describe.skipIf(!available)('Swap over the real bridge', () => {
  describe('the plain folds, every line mode', () => {
    it.each(Object.entries(SQUARE_CLICKS) as [Exclude<FoldLineModeId, 'crease'>, Point[]][])(
      '%s: the other side moves, for a valley, a mountain and a precrease',
      async (mode, at) => {
        const { calls } = await engine();
        const sheet = sheetOf(calls);
        const index = indexOf(calls, sheet);
        const [plain, swapped] = intents(calls, sheet, mode, clicks(index, mode, at));
        for (const kind of KINDS) {
          const step = (intent: FoldLocateIntent) =>
            built(buildFoldStep({ ...intent, kind, precreaseDirection: 'valley' }, index));
          const [before, after] = [step(plain), step(swapped)];
          expectOtherSide(before, after);
          expect(plainSide(calls, sheet, after), kind).toBe(other(plainSide(calls, sheet, before)));
          const [one, two] = [landed(calls.step(sheet, before.op, before.choices)), landed(calls.step(sheet, after.op, after.choices))];
          expect(two.report?.side, kind).toBe(other(one.report?.side ?? ''));
          // A precrease lands as it started, whichever side swung; a fold lands the other part over.
          if (kind !== 'precrease') expect(two.fingerprint, kind).not.toBe(one.fingerprint);
        }
      }
    );

    it('crease: the other side moves along a precrease refolded, or precreased again', async () => {
      const { calls } = await engine();
      const sheet = sheetOf(calls);
      const precrease = built(
        buildFoldStep(
          {
            kind: 'precrease',
            precreaseDirection: 'valley',
            lineMode: 'free',
            picks: clicks(indexOf(calls, sheet), 'free', SQUARE_CLICKS.free),
            candidate: null,
            swapped: false,
            seed: { scope: 'all' },
          },
          indexOf(calls, sheet)
        )
      );
      const creased = landed(calls.step(sheet, precrease.op, precrease.choices)).state;
      const index = indexOf(calls, creased);
      const [plain, swapped] = intents(calls, creased, 'crease', clicks(index, 'crease', [p(0.3, 0.5)]));
      for (const kind of KINDS) {
        const step = (intent: FoldLocateIntent) =>
          built(buildFoldStep({ ...intent, kind, precreaseDirection: 'valley' }, index));
        const [before, after] = [step(plain), step(swapped)];
        expect(before.op.kind).toBe(kind);
        expectOtherSide(before, after);
        expect(plainSide(calls, creased, after), kind).toBe(other(plainSide(calls, creased, before)));
        const [one, two] = [
          landed(calls.step(creased, before.op, before.choices)),
          landed(calls.step(creased, after.op, after.choices)),
        ];
        expect(two.report?.side, kind).toBe(other(one.report?.side ?? ''));
        if (kind !== 'precrease') expect(two.fingerprint, kind).not.toBe(one.fingerprint);
      }
    });
  });

  describe('the compound folds along a line', () => {
    /** The square valley-folded along its diagonal from (0, 1) to (1, 0): the triangle b c d, two layers. */
    function triangle(calls: FoldEngineCalls): number {
      const sheet = sheetOf(calls);
      const index = indexOf(calls, sheet);
      const step = built(
        buildFoldStep(
          {
            kind: 'valley',
            precreaseDirection: 'valley',
            lineMode: 'free',
            picks: clicks(index, 'free', [p(0, 1), p(1, 0)]),
            candidate: null,
            swapped: false,
            seed: { scope: 'all' },
          },
          index
        )
      );
      return landed(calls.step(sheet, step.op, step.choices)).state;
    }

    /**
     * On the triangle: a free line across it near the corner d = (0, 1), and
     * an axiom that implies its side — d onto c = (1, 1), the line x = ½.
     */
    const TRIANGLE_LINES: [FoldLineModeId, Point[]][] = [
      ['free', [p(0.2, 1.05), p(0.45, 0.5)]],
      ['axiom-2', [p(0, 1), p(1, 1)]],
    ];

    it.each(TRIANGLE_LINES)('inside and outside reverse, %s: the other side is the tip', async (mode, at) => {
      const { calls, compound } = await engine();
      const state = triangle(calls);
      const index = indexOf(calls, state);
      const [plain, swapped] = intents(calls, state, mode, clicks(index, mode, at));
      for (const kind of ['inside', 'outside'] as const) {
        const step = (intent: FoldLocateIntent) =>
          built(buildReverseStep({ ...intent, kind, openings: [], completion: null }, index));
        const [before, after] = [step(plain), step(swapped)];
        expect(before.op.kind).toBe(`${kind}-reverse`);
        expectOtherSide(before, after);
        expect(compoundSide(compound, state, after), kind).toBe(other(compoundSide(compound, state, before)));
      }
    });

    it.each(TRIANGLE_LINES)('crimp, its first line %s: the other side is the tip, which the second line must cross', async (mode, at) => {
      const { calls, compound } = await engine();
      const state = triangle(calls);
      const index = indexOf(calls, state);
      const first = clicks(index, mode, at);
      // The first line's clicks, then the second's, drawn freely: beyond the
      // first on the corner d's side, or on the other.
      const crimps = (second: [Point, Point]) => {
        const picks = [...first, ...clicks(index, 'free', second)];
        return intents(calls, state, mode, first).map((intent) =>
          built(
            buildCrimpStep(
              { ...intent, picks, secondLineMode: 'free', kind: 'inside', openings: [], completion: null },
              index
            )
          )
        ) as [Built, Built];
      };
      const nearD = crimps([p(0.05, 1.05), p(0.15, 0.8)]);
      const nearC = crimps([p(0.8, 1.05), p(0.8, 0.15)]);
      for (const [before, after] of [nearD, nearC]) {
        expect(before.op.kind).toBe('crimp');
        expectOtherSide(before, after);
      }
      // The corner d's side is the tip unswapped: a second line there crimps it, one beyond c misses it.
      const tipSide = compoundSide(compound, state, nearD[0]);
      expect(tipSide).toMatch(/^(positive|negative)$/);
      expect(compoundSide(compound, state, nearC[0])).toBe('refused:crimp_misses_tip');
      // Swapped, the other side is the tip: the line beyond c crimps it, the one by d misses it.
      expect(compoundSide(compound, state, nearC[1])).toBe(other(tipSide));
      expect(compoundSide(compound, state, nearD[1])).toBe('refused:crimp_misses_tip');
    });

    it.each(TRIANGLE_LINES)('tuck, %s: the other side turns', async (mode, at) => {
      const { calls, compound } = await engine();
      const state = triangle(calls);
      const index = indexOf(calls, state);
      const [plain, swapped] = intents(calls, state, mode, clicks(index, mode, at));
      for (const direction of ['valley', 'mountain'] as const) {
        const step = (intent: FoldLocateIntent) =>
          built(buildTuckStep({ ...intent, direction, target: null, completion: null }, index));
        const [before, after] = [step(plain), step(swapped)];
        expect(before.op.kind).toBe('tuck');
        expectOtherSide(before, after);
        expect(compoundSide(compound, state, after), direction).toBe(other(compoundSide(compound, state, before)));
      }
    });

    it('the sinks, along a line square to the square base’s point: the other side is no closed point', async () => {
      const { calls, io, compound } = await engine();
      const sample = FOLD_SAMPLES.find((each) => each.id === 'preliminary-base');
      if (!sample) throw new Error('no square base sample');
      const opened = landed(io.importCp(foldSampleSource(sample), { kind: 'empty', startSide: 'front' }));
      const base = landed(io.importPick(opened.import, [])).state;
      const builds = (state: number, tool: 'open-sink' | 'closed-sink' | 'unsink') => {
        const index = indexOf(calls, state);
        // The ring at 0.3 of the point's centre line, as the sink tests draw it.
        const onPane = (sheet: SheetPoint): Point => {
          const at = sheetToScene(index.scene, sheet);
          if (!at) throw new Error(`${sheet.join(', ')} is not on the paper`);
          return at;
        };
        const picks = clicks(index, 'free', [onPane([0.35, 0.35]), onPane([0.5, 0.2])]);
        return intents(calls, state, 'free', picks).map((intent) =>
          buildSinkStep({ ...intent, tool, pocket: null, completion: null, sunk: null }, index)
        ) as [FoldStepBuild, FoldStepBuild];
      };
      const sinks = (state: number, tool: 'open-sink' | 'closed-sink' | 'unsink') =>
        builds(state, tool).map(built) as [Built, Built];
      for (const tool of ['open-sink', 'closed-sink'] as const) {
        const [before, after] = sinks(base, tool);
        expect(before.op.kind).toBe(tool);
        expectOtherSide(before, after);
        expect(compoundSide(compound, base, before), tool).toMatch(/^(positive|negative)$/);
        // Its open end: the four raw corners, which no sink takes.
        expect(compoundSide(compound, base, after), tool).toMatch(/^refused:/);
      }
      // The point sunk, then pulled back out along the same ring: the side
      // with more paper, where the sunk point lies inside the paper round it.
      // Swapped, the side beyond the ring, where nothing is left once the
      // point is sunk: the tools say so before the engine is asked.
      const [open] = sinks(base, 'open-sink');
      const sunk = landed(calls.step(base, open.op, open.choices)).state;
      const [before, after] = builds(sunk, 'unsink');
      expect(built(before).op.kind).toBe('unsink');
      expect(after).toMatchObject({ status: 'refused', refused: { refusal: { code: 'no_moving_side' } } });
    });
  });
});
