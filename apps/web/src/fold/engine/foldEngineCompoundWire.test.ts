import { describe, expect, it } from 'vitest';
import { FOLD_OP_KINDS, type FoldCompletionChoice, type FoldOpeningChoice } from '../document/foldSequenceDocument';
import { createFoldEngineCompoundCalls, type FoldWasmCompoundEngine } from './foldEngineCompoundCalls';
import {
  FOLD_COMPOUND_FAMILY_OF,
  compoundFamilyOf,
  compoundFoldLineOf,
  compoundStoredChoices,
  foldedLineOf,
  isFoldCompoundOp,
  type FoldCompoundFamily,
  type FoldCompoundReport,
  type FoldCompoundReportBase,
  type FoldEngineCompoundOp,
} from './foldEngineCompoundWire';
import type { FoldReverseStored } from './foldEngineReverseWire';
import type { FoldSinkStored } from './foldEngineSinkWire';
import type { FoldReport, FoldStepMotionLegs } from './foldEngineWire';

const LINE = { n: [0, 1] as [number, number], d: 0.5 };
const SECOND = { n: [0, 1] as [number, number], d: 0.25 };
const SNAP = { clusters: 0, angle: 0, max_shift: 0 };
const ORDER: FoldCompletionChoice = { faces: [[0.1, 0.1], [0.2, 0.2]], orders: [[0, 1, 1]] };
const NO_ORDER: FoldCompletionChoice = { faces: [], orders: [] };
const OPENING: FoldOpeningChoice = { upper: [[0.9, 0.1]] };

/** What every compound fold did, with a motion of its own so each family's legs can be told apart. */
function base(family: FoldCompoundFamily): FoldCompoundReportBase {
  const motion: FoldStepMotionLegs = {
    kind: 'visual',
    legs: [{ name: 'spread', stacking: 'parent', groups: [{ faces: [family.length], axis: LINE, side: 'positive', from: 0, to: 1 }] }],
  };
  return { moving: [1], blocks: [[2]], created: [3], unfolded: [], refolded: [], reversed: [], split: 1, motion };
}

/** One report per family, as the bridge sends it, its stored choices given. */
const REPORTS = {
  reverse: (stored: FoldReverseStored = {}): FoldCompoundReport => ({
    family: 'reverse',
    ...base('reverse'),
    line: LINE,
    side: 'negative',
    snap: SNAP,
    kind: 'inside',
    openings: [],
    whole: [],
    stored,
  }),
  crimp: (stored: FoldReverseStored = {}): FoldCompoundReport => ({
    family: 'crimp',
    ...base('crimp'),
    first: LINE,
    side: 'positive',
    snap: SNAP,
    second: SECOND,
    second_side: 'positive',
    second_snap: SNAP,
    kind: 'outside',
    openings: [],
    whole: [],
    stored,
  }),
  tuck: (stored: { order?: FoldCompletionChoice } = {}): FoldCompoundReport => ({
    family: 'tuck',
    ...base('tuck'),
    line: SECOND,
    side: 'negative',
    snap: SNAP,
    direction: 'valley',
    placement: 'under',
    target: 4,
    stored,
  }),
  vertex: (stored: { completion?: FoldCompletionChoice } = {}): FoldCompoundReport => ({
    family: 'vertex',
    ...base('vertex'),
    kind: 'squash',
    vertices: [[0.5, 0.5]],
    creases: [LINE],
    direction: 'valley',
    stored,
  }),
  sink: (stored: FoldSinkStored = {}): FoldCompoundReport => ({
    family: 'sink',
    ...base('sink'),
    step: 'closed',
    line: LINE,
    side: 'positive',
    snap: SNAP,
    ring: [5, 6],
    stored,
  }),
} satisfies Record<FoldCompoundFamily, () => FoldCompoundReport>;

describe('the compound folds’ one wire', () => {
  it('names every compound op’s family, and no other op’s', () => {
    const compound = FOLD_OP_KINDS.filter((kind) => compoundFamilyOf({ kind }) !== null);
    expect(compound).toEqual(Object.keys(FOLD_COMPOUND_FAMILY_OF));
    expect(FOLD_OP_KINDS.filter((kind) => !isFoldCompoundOp({ kind }))).toEqual([
      'repeat', 'pleat', 'valley',
      'mountain',
      'precrease',
      'unfold',
      'unfold-to',
      'refold',
      'turn',
      'rotate',
      'cp-jump',
    ]);
    expect(compoundFamilyOf({ kind: 'rabbit-ear' })).toBe('vertex');
    expect(compoundFamilyOf({ kind: 'unsink' })).toBe('sink');
    // An inherited property is no kind.
    expect(compoundFamilyOf({ kind: 'toString' })).toBeNull();
  });


  it('names the line a family folded along and its moving side, a crimp’s first, none for a vertex fold', () => {
    expect(compoundFoldLineOf(REPORTS.reverse())).toEqual({ line: LINE, side: 'negative' });
    expect(compoundFoldLineOf(REPORTS.crimp())).toEqual({ line: LINE, side: 'positive' });
    expect(compoundFoldLineOf(REPORTS.tuck())).toEqual({ line: SECOND, side: 'negative' });
    expect(compoundFoldLineOf(REPORTS.sink())).toEqual({ line: LINE, side: 'positive' });
    expect(compoundFoldLineOf(REPORTS.vertex())).toBeNull();
    expect(compoundFoldLineOf(undefined)).toBeNull();
  });

  it('reads any landed step’s line one way: a plain fold’s report, else its compound fold’s', () => {
    const plain: FoldReport = {
      line: SECOND,
      side: 'positive',
      snap: SNAP,
      direction: 'valley',
      flaps: [],
      picked: [],
      added: [],
      moving: [0],
      moving_faces: [1],
      created: [4],
      unfolded: [],
      refolded: [],
      split: 1,
    };
    expect(foldedLineOf({ report: plain })).toEqual({ line: SECOND, side: 'positive' });
    // A plain fold that only laid creases flat says so: an unfold, as its words read it.
    expect(foldedLineOf({ report: { ...plain, created: [], unfolded: [2] } })).toEqual({ line: SECOND, side: 'positive', unfolds: true });
    // A compound step holds no plain report: its line is its compound report's, a crimp's first.
    expect(foldedLineOf({ report: null, compound: REPORTS.reverse() })).toEqual({ line: LINE, side: 'negative' });
    expect(foldedLineOf({ report: null, compound: REPORTS.crimp() })).toEqual({ line: LINE, side: 'positive' });
    // A vertex fold, a turn and the sheet fold along no one line.
    expect(foldedLineOf({ report: null, compound: REPORTS.vertex() })).toBeNull();
    expect(foldedLineOf({ report: null })).toBeNull();
  });

  it('reads what any family stores as the document’s choices, and nothing for what had one way', () => {
    for (const family of Object.keys(REPORTS) as FoldCompoundFamily[]) {
      expect(compoundStoredChoices(REPORTS[family]()), family).toEqual({});
    }
    expect(compoundStoredChoices(REPORTS.reverse({ openings: [OPENING], order: ORDER }))).toEqual({
      opening: [OPENING],
      completion: ORDER,
    });
    expect(compoundStoredChoices(REPORTS.crimp({ openings: [OPENING] }))).toEqual({ opening: [OPENING] });
    expect(compoundStoredChoices(REPORTS.tuck({ order: ORDER }))).toEqual({ completion: ORDER });
    expect(compoundStoredChoices(REPORTS.vertex({ completion: ORDER }))).toEqual({ completion: ORDER });
    const pocket = { above: [0.15, 0.4] as [number, number], below: [0.15, 0.6] as [number, number] };
    expect(compoundStoredChoices(REPORTS.sink({ pocket, order: ORDER }))).toEqual({
      pocket: [pocket.above, pocket.below],
      completion: ORDER,
    });
    // An order that orders nothing, or no openings, is no choice.
    expect(compoundStoredChoices(REPORTS.reverse({ openings: [], order: NO_ORDER }))).toEqual({});
    expect(compoundStoredChoices(REPORTS.vertex({ completion: NO_ORDER }))).toEqual({});
  });
});

describe('the compound question', () => {
  const engine: FoldWasmCompoundEngine & { asked: unknown[][] } = {
    asked: [],
    order_selection: () => ({ status: 'ok', count: { orders: 1, exact: true }, index: 0, completion: null }),
    compound_analysis(...args) {
      this.asked.push(args);
      return { status: 'ok', family: 'vertex', analysis: {} };
    },
  };
  const calls = createFoldEngineCompoundCalls(engine);
  const SQUASH: FoldEngineCompoundOp = { kind: 'squash', flap: [0.2, 0.2], direction: 'valley' };

  it('hands any family’s op over unchanged', () => {
    expect(calls.compoundAnalysis(3, SQUASH)).toMatchObject({ status: 'ok', family: 'vertex' });
    calls.compoundAnalysis(4, SQUASH, { completion: ORDER });
    expect(engine.asked).toEqual([
      [3, SQUASH, undefined],
      [4, SQUASH, { completion: ORDER }],
    ]);
  });

  it('throws the caller’s mistakes before the engine sees them', () => {
    const valley = { kind: 'valley', line: { via: 'free', through: [[0, 0], [1, 1]] }, seed: { scope: 'all' } };
    for (const call of [
      () => calls.compoundAnalysis(0, SQUASH),
      () => calls.compoundAnalysis(1.5, SQUASH),
      () => calls.compoundAnalysis(1, valley as unknown as FoldEngineCompoundOp),
      () => calls.compoundAnalysis(1, null as unknown as FoldEngineCompoundOp),
      () => calls.compoundAnalysis(1, SQUASH, 'first' as never),
    ]) {
      expect(call).toThrow(expect.objectContaining({ code: 'invalid_input' }));
    }
    expect(engine.asked).toHaveLength(2);
  });
});
