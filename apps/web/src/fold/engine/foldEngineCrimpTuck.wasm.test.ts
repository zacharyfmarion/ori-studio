import { normalizeFoldLandingOp } from '../document/foldLandingMigration';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFoldSequence, writeFoldSequence } from '../document/foldSequenceFile';
import {
  SQUARE_PAPER,
  isLockedStep,
  type FoldChoices,
  type FoldCrimpOp,
  type FoldOp,
  type FoldTuckOp,
} from '../document/foldSequenceDocument';
import { createFoldEngineCalls, type FoldEngineCalls } from './foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from './foldEngineCompoundCalls';
import {
  compoundStoredChoices,
  type FoldCompoundAnalysis,
  type FoldCompoundAnalysisOf,
  type FoldCompoundFamily,
} from './foldEngineCompoundWire';
import { createFoldEngineCrimpTuckCalls, type FoldEngineCrimpTuckCalls } from './foldEngineCrimpTuckCalls';
import { FOLD_REFUSAL_CODES, type FoldEngineOutcome, type FoldEngineRefused } from './foldEngineWire';

/**
 * The crimp and the tuck over the real bridge, in-process: exactly what
 * `workers/foldSequenceWorker.ts` runs beside the step calls, on one engine.
 *
 * The crates' tests prove the behaviour natively; what they do not cover is
 * TypeScript's side of the boundary — the document's ops crossing as they are
 * stored, the compound question tagged by family, a landing reported as the
 * step's `compound` alike whichever call landed it, its `stored` choices
 * written to the project file and read back by the document's reader, then
 * replayed through the ordinary `step` call to the same fingerprint, and
 * every refusal code one this build knows.
 *
 * Skipped when the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const ROOT = process.cwd();
const FOLD_WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(FOLD_WASM);

interface Engine {
  calls: FoldEngineCalls;
  compound: FoldEngineCrimpTuckCalls;
  question: FoldEngineCompoundCalls;
}

async function makeEngine(): Promise<Engine> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(FOLD_WASM) });
  const fold = new wasm.FoldEngine();
  return {
    calls: createFoldEngineCalls(fold),
    compound: createFoldEngineCrimpTuckCalls(fold),
    question: createFoldEngineCompoundCalls(fold),
  };
}

function landed<T>(outcome: FoldEngineOutcome<T>): T {
  if (outcome.status !== 'ok') throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome;
}

/** The compound question's answer, which must be `family`'s. */
function asked<F extends FoldCompoundFamily>(
  outcome: FoldEngineOutcome<FoldCompoundAnalysis>,
  family: F
): FoldCompoundAnalysisOf<F> {
  const answer = landed(outcome);
  if (answer.family !== family) throw new Error(`asked of ${family}, answered for ${answer.family}`);
  return answer as FoldCompoundAnalysisOf<F>;
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

/** A step through the document's own file format: written, read back, its op and choices as replay gets them. */
function throughTheFile(op: FoldOp, choices?: FoldChoices): { op: FoldOp; choices?: FoldChoices } {
  const written = writeFoldSequence({
    document: {
      formatVersion: 1,
      id: 'fold-a',
      title: '',
      paper: SQUARE_PAPER,
      steps: [{ id: 'a', parent: null, op, ...(choices ? { choices } : {}) }],
    },
    readOnlyRaw: null,
  });
  const read = readFoldSequence(JSON.parse(JSON.stringify(written)));
  const [step] = read?.document.steps ?? [];
  if (!step || isLockedStep(step)) throw new Error('the step did not read back');
  return { op: step.op, ...(step.choices ? { choices: step.choices } : {}) };
}

/** The diagonal fold: the square to a triangle, corner (1, 1) over onto (0, 0). */
function triangle(calls: FoldEngineCalls): number {
  const sheet = landed(calls.sheet(SQUARE_PAPER)).state;
  return landed(
    calls.step(sheet, {
      kind: 'valley',
      line: { via: 'free', through: [[1, 0], [0, 1]] },
      moving: [0.1, 0.1],
      seed: { scope: 'all' },
    })
  ).state;
}

/** The triangle's crimp of corner b: ℓ1 square to the spine at (0.4, 0.6), ℓ2 through (0.62, 0.38) at 36.87°. */
function perpCrimp(crimp: 'inside' | 'outside'): FoldCrimpOp {
  const angle = (36.87 * Math.PI) / 180;
  return {
    kind: 'crimp',
    line: { via: 'free', through: [[0.4, 0.6], [0.6, 0.8]] },
    second: {
      via: 'free',
      through: [
        [0.62, 0.38],
        [0.62 + 0.3 * Math.cos(angle), 0.38 + 0.3 * Math.sin(angle)],
      ],
    },
    crimp,
    moving: [0.97, 0.06],
    seed: { scope: 'all' },
  };
}

/** Book fold, book fold again: the strip [0, ¼] × [0, 1] in four layers, whose flap opens two ways. */
function strip(calls: FoldEngineCalls): number {
  const sheet = landed(calls.sheet(SQUARE_PAPER)).state;
  const book = landed(
    calls.step(sheet, {
      kind: 'valley',
      line: { via: 'free', through: [[0.5, 0], [0.5, 1]] },
      moving: [0.9, 0.5],
      seed: { scope: 'all' },
    })
  ).state;
  return landed(
    calls.step(book, {
      kind: 'valley',
      line: { via: 'free', through: [[0.25, 0], [0.25, 1]] },
      moving: [0.4, 0.5],
      seed: { scope: 'all' },
    })
  ).state;
}

const STRIP_CRIMP: FoldCrimpOp = {
  kind: 'crimp',
  line: { via: 'free', through: [[0, 0.5], [0.25, 0.5]] },
  second: { via: 'free', through: [[0, 0.3], [0.25, 0.3]] },
  crimp: 'inside',
  moving: [0.1, 0.2],
  seed: { scope: 'all' },
};

/** The book fold, the right half over the left; its corner flap tucked under the layer at (0.75, 0.5). */
const BOOK_TUCK: FoldTuckOp = {
  kind: 'tuck',
  line: { via: 'free', through: [[0, 0.3], [0.3, 0]] },
  direction: 'valley',
  seed: { scope: 'flaps', at: [[0.05, 0.05]] },
  target: [0.75, 0.5],
};

function book(calls: FoldEngineCalls): number {
  const sheet = landed(calls.sheet(SQUARE_PAPER)).state;
  return landed(
    calls.step(sheet, {
      kind: 'valley',
      line: { via: 'free', through: [[0.5, 0], [0.5, 1]] },
      moving: [0.75, 0.5],
      seed: { scope: 'all' },
    })
  ).state;
}

describe.skipIf(!available)('the crimp and the tuck over the real bridge', () => {
  let engine: Engine;
  beforeAll(async () => {
    engine = await makeEngine();
  });

  it('lands a crimp, replays the stored step to the same fingerprint, and refuses the kind that does not fit', () => {
    const { calls, compound, question } = engine;
    const tri = triangle(calls);
    const op = perpCrimp('inside');
    const analysed = asked(question.compoundAnalysis(tri, op), 'crimp');
    expect(analysed.kinds).toEqual(['inside']);
    expect(analysed.analysis.tip.tip).toHaveLength(2);
    const folded = landed(compound.crimp(tri, op));
    if (folded.outcome !== 'landed') throw new Error(folded.outcome);
    expect(folded.summary.faces).toBe(6);
    expect(folded.stored).toEqual({});
    // A step as `step` lands one: no plain report, the crimp's as `compound`.
    expect(folded.report).toBeNull();
    expect(folded.compound.family).toBe('crimp');
    expect(folded.compound.kind).toBe('inside');
    // Both lines fold together: a spread and a close, the tip carried.
    expect(folded.compound.motion.legs).toHaveLength(2);
    expect(folded.compound.motion.legs[0]!.groups.some((group) => group.carrier !== undefined)).toBe(true);
    expect(compoundStoredChoices(folded.compound)).toEqual(folded.stored);
    expect(folded.fingerprint).toMatch(/^fs1:[0-9a-f]{16}$/);
    // Stored and read back, the step replays through `step` to the same state and report.
    const stored = throughTheFile(op);
    expect(stored.op).toEqual(op);
    const replayed = landed(calls.step(tri, stored.op, stored.choices));
    expect(replayed.fingerprint).toBe(folded.fingerprint);
    expect(replayed.report).toBeNull();
    expect(replayed.compound).toEqual(folded.compound);
    // The other kind does not fit, and offers this one.
    const other = refused(compound.crimp(tri, perpCrimp('outside')));
    expect(other.refusal.code).toBe('crimp_kind_infeasible');
    expect(other.fixes).toEqual([{ fix: 'other_kind', kind: 'inside' }]);
    expect(other.faces.length).toBeGreaterThan(0);
    // A replay of it is refused the same way.
    expect(refused(calls.step(tri, perpCrimp('outside'))).refusal.code).toBe('crimp_kind_infeasible');
  });

  it('asks for a crimp’s opening, and stores what was chosen so the step replays', () => {
    const { calls, compound, question } = engine;
    const at = strip(calls);
    const tried = landed(compound.crimp(at, STRIP_CRIMP));
    if (tried.outcome !== 'choose_opening') throw new Error(tried.outcome);
    const openings = tried.analysis.tip.flaps[0]?.openings ?? [];
    expect(openings).toHaveLength(2);
    expect(asked(question.compoundAnalysis(at, STRIP_CRIMP), 'crimp').kinds).toBeNull();
    // Stored without its opening, the step needs it.
    expect(refused(calls.step(at, STRIP_CRIMP)).refusal).toEqual({ code: 'choice_needed', choice: 'opening' });
    const chosen: FoldChoices = { opening: [openings[0].stored] };
    const folded = landed(compound.crimp(at, STRIP_CRIMP, chosen));
    const first = folded.outcome === 'landed' ? folded : folded.outcome === 'choose_order' ? folded.candidates[0] : null;
    if (!first) throw new Error(folded.outcome);
    expect(first.stored.opening).toEqual([openings[0].stored]);
    const stored = throughTheFile(STRIP_CRIMP, first.stored);
    expect(stored.choices).toEqual(first.stored);
    expect(landed(calls.step(at, stored.op, stored.choices)).fingerprint).toBe(first.fingerprint);
  });

  it('lists a tuck’s targets, lands it, and replays it', () => {
    const { calls, compound, question } = engine;
    const at = book(calls);
    const { analysis } = asked(question.compoundAnalysis(at, BOOK_TUCK), 'tuck');
    expect(analysis.placement).toBe('under');
    expect(analysis.targets.some((target) => target.feasible === true)).toBe(true);
    const folded = landed(compound.tuck(at, BOOK_TUCK));
    if (folded.outcome !== 'landed') throw new Error(folded.outcome);
    expect(folded.compound.family).toBe('tuck');
    expect(folded.compound.placement).toBe('under');
    const stored = throughTheFile(BOOK_TUCK, folded.stored.completion ? folded.stored : undefined);
    expect(stored.op).toEqual(normalizeFoldLandingOp(BOOK_TUCK));
    const replayed = landed(calls.step(at, stored.op, stored.choices));
    expect(replayed.fingerprint).toBe(folded.fingerprint);
    expect(replayed.compound).toEqual(folded.compound);
    // A target in the paper that moves cannot take the tuck.
    const intoTheFlap = refused(compound.tuck(at, { ...BOOK_TUCK, target: [0.05, 0.05] }));
    expect(FOLD_REFUSAL_CODES).toContain(intoTheFlap.refusal.code);
    // A tuck has no opening to choose.
    expect(refused(compound.tuck(at, BOOK_TUCK, { opening: [{ upper: [[0.1, 0.1]] }] })).refusal).toEqual({
      code: 'unexpected_choice',
      choice: 'opening',
    });
  });

  it('throws a caller’s mistake, and refuses a stored choice that no longer resolves', () => {
    const { calls, compound, question } = engine;
    const at = book(calls);
    expect(thrown(() => compound.tuck(0, BOOK_TUCK))).toMatchObject({ code: 'invalid_input' });
    expect(
      thrown(() => compound.crimp(at, { ...STRIP_CRIMP, second: { via: 'axiom', axiom: 1, inputs: [] } }))
    ).toMatchObject({ code: 'invalid_input' });
    // The compound question is a compound fold's; a tuck answers a plain fold's
    // questions too, of its block against its target: the bounded closure moves.
    const valley = { kind: 'valley', line: BOOK_TUCK.line, seed: BOOK_TUCK.seed } as unknown as FoldTuckOp;
    expect(thrown(() => question.compoundAnalysis(at, valley))).toMatchObject({ code: 'invalid_input' });
    // The bottom layer's corner alone (spike case 4a), where the plain fold would take the top's too.
    expect(landed(calls.analyse(at, BOOK_TUCK)).analysis.moving).toHaveLength(1);
    // An order whose witnesses name no face of this state breaks the step.
    const broken = refused(
      calls.step(at, BOOK_TUCK, {
        completion: {
          faces: [
            [5, 5],
            [6, 6],
          ],
          orders: [[0, 1, 1]],
        },
      })
    );
    expect(broken.refusal.code).toBe('choice_broken');
    expect(FOLD_REFUSAL_CODES).toContain(broken.refusal.code);
  });
});
