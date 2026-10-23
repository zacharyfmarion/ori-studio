/**
 * What crosses the bridge for the reverse fold (plan Phase 9), as TypeScript
 * sees it. Mirrors `crates/oristudio-fold-wasm/src/ops_reverse.rs` and the
 * engine's `compound/reverse.rs`; the Rust side is the truth.
 *
 * - **The op** is the document's `inside-reverse` or `outside-reverse`
 *   (`FoldReverseOp`), or one the tools are previewing along a model line.
 * - **The question** (`compoundAnalysis`, `family: 'reverse'`) answers what
 *   the tip is and how each of its flaps opens, which kinds land with the
 *   openings named, and the choice the step still needs: an opening, or one
 *   of the orders listed, each the `completion` that picks it.
 * - **A landed one** reports as `compound` beside a plain fold's report
 *   (`family: 'reverse'`, `foldEngineCompoundWire.ts`): its kind, its
 *   openings, its blocks, the spine creases it reversed, the motion the
 *   animation plays and what it stores.
 *
 * Pure types: no React, no store, no wasm.
 */

import type {
  FoldCompletionChoice,
  FoldModelLine,
  FoldOpeningChoice,
  FoldReverseKind,
  FoldReverseOp,
} from '../document/foldSequenceDocument';
import type { FoldCompoundReportBase } from './foldEngineCompoundWire';
import type { FoldEngineLine, FoldFlap, FoldSide, FoldSnap, FoldToolMotion } from './foldEngineWire';

/** Which way the tip goes: into the flap, between its layers, or round its outside (the document's). */
export type { FoldReverseKind };

export const FOLD_REVERSE_KINDS: readonly FoldReverseKind[] = ['inside', 'outside'];

/** A reverse op as the tools fold it: the document's, its line possibly the tools' model line. */
export type FoldEngineReverseOp = Omit<FoldReverseOp, 'line'> & { line: FoldEngineLine } & Pick<FoldToolMotion, 'side'>;

/** Why a flap of the tip has no opening (`NoOpening`). */
export type FoldNoOpening = 'no_spine' | 'no_split' | 'no_body' | 'bodies_cross';

/**
 * One way a flap of the tip opens: a lower block T1 and an upper block T2
 * of the parent's faces, the folded boundary across them (turning M↔V),
 * each block's body on ℓ, and what a step stores to choose it.
 */
export interface FoldOpening {
  lower: number[];
  upper: number[];
  /** Common line for a straight boundary; null for a bent pocket boundary. */
  spine: FoldModelLine | null;
  across: number[];
  lower_body: number[];
  upper_body: number[];
  stored: FoldOpeningChoice;
}

/** A flap of the tip and the ways it opens, fewest lower faces first. */
export interface FoldTipFlap {
  /** Its index among the moving side's flaps. */
  index: number;
  flap: FoldFlap;
  openings: FoldOpening[];
  /** The scan stopped at its cap: more may exist. */
  truncated: boolean;
  /** Why there is none, when there is none. */
  none?: FoldNoOpening;
}

/** What a reverse fold moves and how its flaps open, before it lands. */
export interface FoldReverseAnalysis {
  /** The line folded along, after snapping, and the tip's side of it. */
  line: FoldModelLine;
  side: FoldSide;
  snap: FoldSnap;
  /** The parent's faces that move. */
  tip: number[];
  flaps: FoldTipFlap[];
}

/** How many orders a choice has: the product of its components', and whether that is all of them. */
export interface FoldChoiceCount {
  orders: number;
  exact: boolean;
}

/** The orders a reverse fold of one kind leaves, when its completion leaves more than one. */
export interface FoldReverseOrders {
  kind: FoldReverseKind;
  count: FoldChoiceCount;
  /** The first few, each the `completion` that picks it. */
  orders: FoldCompletionChoice[];
  /** More are listed than `orders` holds. */
  more: boolean;
}

/**
 * The compound question's answer for a reverse fold, of both kinds whichever
 * the op names: what the tip is, which kinds land, and what is still to
 * choose. A stored completion is not asked about, so the orders stay listed
 * while one is chosen.
 */
export interface FoldReverseAsked {
  analysis: FoldReverseAnalysis;
  /** The kinds that land with the openings named; none while an opening is still to choose. */
  kinds: FoldReverseKind[];
  /** A flap opens more than one way and the choices name none of its openings. */
  opening: boolean;
  /** Per kind that lands with more than one order, the orders. */
  orders: FoldReverseOrders[];
}

/**
 * What a landed reverse fold did (`ReverseReport`), as a compound step reports
 * it under `family: 'reverse'`. Its `reversed` are the spine creases that
 * turned M↔V.
 */
export interface FoldReverseReport extends FoldCompoundReportBase {
  line: FoldModelLine;
  side: FoldSide;
  snap: FoldSnap;
  kind: FoldReverseKind;
  /** Each opening flap's opening: its blocks are `blocks[2k]` (lower) and `blocks[2k + 1]` (upper). */
  openings: FoldOpening[];
  /** The tip's flaps that moved whole, with no spine to open along: the parent's faces of each. */
  whole: number[][];
  /** What the step stores: the openings chosen among several, the order chosen among several. */
  stored: FoldReverseStored;
}

/** What a reverse fold or a crimp stores, in the engine's shapes (`ReverseChoices`). */
export interface FoldReverseStored {
  openings?: FoldOpeningChoice[];
  order?: FoldCompletionChoice;
}
