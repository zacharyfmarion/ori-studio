/**
 * The compound folds' one seam on the wire (plan D4), as TypeScript sees it.
 * Mirrors `crates/oristudio-fold-wasm/src/compound.rs`; the Rust side is the
 * truth. Every family — the reverse folds, the crimp, the tuck, the vertex
 * folds (squash, petal, rabbit ear, swivel) and the sinks — crosses the same
 * way:
 *
 * - **A landed one** reports as `compound` beside a plain fold's `report`
 *   (`FoldStepLanded`), tagged by its `family` ({@link FoldCompoundReport}),
 *   whether `step` landed it or its family's own call did. Every family's
 *   report carries what every compound fold did
 *   ({@link FoldCompoundReportBase}).
 * - **Before it lands** a tool asks one question of any family,
 *   `compoundAnalysis`, and gets its family's answer tagged by `family`
 *   ({@link FoldCompoundAnalysis}).
 * - **What a landed one stores** comes back in the engine's shapes, per
 *   family; {@link compoundStoredChoices} reads any of them as the document's
 *   choices.
 *
 * Each family's own shapes are in its wire file (`foldEngineReverseWire.ts`,
 * `foldEngineCrimpTuckWire.ts`, `foldEngineSquashWire.ts`,
 * `foldEngineSinkWire.ts`).
 *
 * Pure types, one table and accessors: no React, no store, no wasm.
 */

import type { FoldChoices, FoldVertexOp } from '../document/foldSequenceDocument';
import type {
  FoldCrimpAnalysed,
  FoldCrimpReport,
  FoldEngineCrimpOp,
  FoldEngineTuckOp,
  FoldTuckAnalysed,
  FoldTuckReport,
} from './foldEngineCrimpTuckWire';
import type { FoldEngineReverseOp, FoldReverseAsked, FoldReverseReport } from './foldEngineReverseWire';
import { sinkStoredChoices, type FoldEngineSinkOp, type FoldSinkAnalysed, type FoldSinkReport } from './foldEngineSinkWire';
import type { FoldVertexAnalysed, FoldVertexReport } from './foldEngineSquashWire';
import type {
  FoldRefold,
  FoldReport,
  FoldStepFingerprinted,
  FoldStepLanded,
  FoldStepMotionLegs,
} from './foldEngineWire';

/** Which family a compound fold is: the tag its report and its question's answer carry (`CompoundStepReport`). */
export type FoldCompoundFamily = 'reverse' | 'crimp' | 'tuck' | 'vertex' | 'sink';

/** A compound op as the bridge folds it: the document's, with the tools' additions per family. */
export type FoldEngineCompoundOp =
  | FoldEngineReverseOp
  | FoldEngineCrimpOp
  | FoldEngineTuckOp
  | FoldVertexOp
  | FoldEngineSinkOp;

export type FoldCompoundOpKind = FoldEngineCompoundOp['kind'];

/** Each compound op's family, by its kind: the Rust side's `Op::is_compound`, and which report it lands. */
export const FOLD_COMPOUND_FAMILY_OF: Readonly<Record<FoldCompoundOpKind, FoldCompoundFamily>> = {
  'inside-reverse': 'reverse',
  'outside-reverse': 'reverse',
  crimp: 'crimp',
  tuck: 'tuck',
  squash: 'vertex',
  petal: 'vertex',
  'rabbit-ear': 'vertex',
  swivel: 'vertex',
  'open-sink': 'sink',
  'closed-sink': 'sink',
  unsink: 'sink',
};

/** An op's compound family; null for any op that is no compound fold. */
export function compoundFamilyOf(op: { readonly kind: string }): FoldCompoundFamily | null {
  return Object.hasOwn(FOLD_COMPOUND_FAMILY_OF, op.kind)
    ? FOLD_COMPOUND_FAMILY_OF[op.kind as FoldCompoundOpKind]
    : null;
}

/** Whether an op is a compound fold: one `compoundAnalysis` answers. */
export function isFoldCompoundOp<O extends { readonly kind: string }>(
  op: O
): op is Extract<O, { kind: FoldCompoundOpKind }> {
  return compoundFamilyOf(op) !== null;
}

// ---------------------------------------------------------------------------
// A landed compound fold

/**
 * What every compound fold did (the engine's `CompoundReport`, flattened into
 * each family's report).
 */
export interface FoldCompoundReportBase {
  /** The parent's faces that move. */
  moving: number[];
  /** Per block, the landed state's faces in it. */
  blocks: number[][];
  /** The creases the step made. */
  created: number[];
  /** Folded creases that lie flat now. */
  unfolded: number[];
  /** Flat creases that fold again. */
  refolded: FoldRefold[];
  /** Folded creases whose letter turned. */
  reversed: number[];
  /** How many faces were split. */
  split: number;
  /** The engine's motion legs for the step, one type for every compound fold. Sent by the engine; nothing in the app plays them. */
  motion: FoldStepMotionLegs;
}

/** What a landed compound fold did, tagged by its family (`CompoundStepReport`). */
export type FoldCompoundReport =
  | ({ family: 'reverse' } & FoldReverseReport)
  | ({ family: 'crimp' } & FoldCrimpReport)
  | ({ family: 'tuck' } & FoldTuckReport)
  | ({ family: 'vertex' } & FoldVertexReport)
  | ({ family: 'sink' } & FoldSinkReport);

export type FoldCompoundReportOf<F extends FoldCompoundFamily> = Extract<FoldCompoundReport, { family: F }>;

/** A step a compound fold landed — by `step`, or by its family's own call — its report always there. */
export type FoldCompoundLanded<F extends FoldCompoundFamily = FoldCompoundFamily> = FoldStepLanded & {
  compound: FoldCompoundReportOf<F>;
};

export type FoldCompoundFingerprinted<F extends FoldCompoundFamily = FoldCompoundFamily> = FoldStepFingerprinted & {
  compound: FoldCompoundReportOf<F>;
};

/**
 * The line a compound fold folded along and the side that moved, in the
 * parent's model frame, as a plain fold's report names them: a crimp's ℓ1
 * and its tip side. Null for a vertex fold, which folds along no one line,
 * and for no report.
 */
export function compoundFoldLineOf(
  report: FoldCompoundReport | null | undefined
): Pick<FoldReport, 'line' | 'side'> | null {
  if (!report) return null;
  switch (report.family) {
    case 'reverse':
    case 'tuck':
    case 'sink':
      return { line: report.line, side: report.side };
    case 'crimp':
      return { line: report.first, side: report.side };
    case 'vertex':
      return null;
  }
}

/**
 * What a landed step folded, as its words read it: the line and the side
 * that moved, and — for a plain fold that only laid folded creases flat,
 * making and refolding none — that it was an unfold. The Valley and Mountain
 * tools store a fold along a bend that unfolds its flap as a valley or
 * mountain fold (plan D3); only the engine's report says it unfolded.
 */
export interface FoldedLine extends Pick<FoldReport, 'line' | 'side'> {
  readonly unfolds?: true;
}

/** The fold only laid folded creases flat: it made no crease and refolded none. */
export function onlyUnfolds(report: Pick<FoldReport, 'created' | 'unfolded' | 'refolded'>): boolean {
  return report.unfolded.length > 0 && report.created.length === 0 && report.refolded.length === 0;
}

/**
 * The line any landed step folded along and the side that moved, in the
 * parent's model frame: a plain fold's report, or else a compound fold's
 * ({@link compoundFoldLineOf}), which a compound step holds in place of one;
 * and whether a plain fold only unfolded. Null for a turn, a rotation, an
 * import and a vertex fold. Every reader of a landed step's line — Fold's
 * strip, the Diagram's capture — reads it here, so a step is worded alike
 * wherever it appears.
 */
export function foldedLineOf(landed: {
  readonly report: FoldReport | null;
  readonly compound?: FoldCompoundReport;
}): FoldedLine | null {
  const { report } = landed;
  if (!report) return compoundFoldLineOf(landed.compound);
  return { line: report.line, side: report.side, ...(onlyUnfolds(report) ? { unfolds: true as const } : {}) };
}

/**
 * What a landed compound step stores, as the document's choices: the
 * openings chosen among several, the order chosen among several, a closed
 * sink's pocket. Nothing for what had one way only. The engine spells each
 * family's in its own shape; this is the one reading of all of them.
 */
export function compoundStoredChoices(report: FoldCompoundReport): FoldChoices {
  switch (report.family) {
    case 'reverse':
    case 'crimp': {
      const { openings, order } = report.stored;
      return {
        ...(openings && openings.length > 0 ? { opening: openings } : {}),
        ...(order && order.orders.length > 0 ? { completion: order } : {}),
      };
    }
    case 'tuck': {
      const { order } = report.stored;
      return order && order.orders.length > 0 ? { completion: order } : {};
    }
    case 'vertex': {
      const { completion } = report.stored;
      return completion && completion.orders.length > 0 ? { completion } : {};
    }
    case 'sink':
      return sinkStoredChoices(report.stored);
  }
}

// ---------------------------------------------------------------------------
// Before it lands

/** What a tool learns of a compound fold before it lands, tagged by its family (`CompoundAsked`). */
export type FoldCompoundAnalysis =
  | ({ family: 'reverse' } & FoldReverseAsked)
  | ({ family: 'crimp' } & FoldCrimpAnalysed)
  | ({ family: 'tuck' } & FoldTuckAnalysed)
  | ({ family: 'vertex' } & FoldVertexAnalysed)
  | ({ family: 'sink' } & FoldSinkAnalysed);

export type FoldCompoundAnalysisOf<F extends FoldCompoundFamily> = Extract<FoldCompoundAnalysis, { family: F }>;
