/**
 * The crimp and the tuck across the Fold engine's bridge (plan Phase 11), as
 * TypeScript sees them. Mirrors `crates/oristudio-fold-wasm/src/ops_crimp_tuck.rs`
 * and the engine's serde types it returns (`oristudio-fold/src/compound/`);
 * the Rust side is the truth.
 *
 * - **Inputs** are the document's `crimp` and `tuck` ops, with the tools'
 *   additions: a line already in the parent's model frame and a `side` of it.
 * - **Analyses** come before a fold lands, from the compound question
 *   (`compoundAnalysis`, `family: 'crimp'` or `'tuck'`): a crimp's tip at ℓ1
 *   with how each of its flaps opens, and the kinds that land; a tuck's
 *   moving faces and every layer its block lands on, each with whether it
 *   takes the tuck.
 * - **A fold** (`crimp`, `tuck`) lands, asks for an opening, or lists the
 *   orders that fit, each already landed under its own handle — a step as
 *   `step` lands one, its report the step's `compound` — with what its step
 *   stores (`stored`, the document's `FoldChoices` keys). Every landed state
 *   stays held until it is released, as a step's does.
 *
 * A stored crimp or tuck replays through `step`, like every step: it lands
 * only when its stored choices decide it, with the same `compound` report,
 * and is refused `choice_needed` or `choice_broken` otherwise.
 *
 * Pure types: no React, no store, no wasm.
 */

import type {
  FoldCompletionChoice,
  FoldCrimpKind,
  FoldCrimpOp,
  FoldDirection,
  FoldModelLine,
  FoldOpeningChoice,
  FoldTuckOp,
} from '../document/foldSequenceDocument';
import type { FoldCompoundFingerprinted, FoldCompoundLanded, FoldCompoundReportBase } from './foldEngineCompoundWire';
import type { FoldOpening, FoldReverseAnalysis, FoldReverseStored } from './foldEngineReverseWire';
import type { FoldEngineLine, FoldSide, FoldSnap } from './foldEngineWire';

// ---------------------------------------------------------------------------
// Inputs

/** A crimp as the bridge takes it: either line may be the tools' model line, ℓ1 with a `side`. */
export type FoldEngineCrimpOp = Omit<FoldCrimpOp, 'line' | 'second'> & {
  line: FoldEngineLine;
  second: FoldEngineLine;
  side?: FoldSide;
};

/** A tuck as the bridge takes it: its line may be the tools' model line, with a `side`. */
export type FoldEngineTuckOp = Omit<FoldTuckOp, 'line'> & { line: FoldEngineLine; side?: FoldSide };

// ---------------------------------------------------------------------------
// Analyses

/**
 * What a crimp moves and how its flaps open, before it lands (`CrimpAnalysis`):
 * its tip at ℓ1 is a reverse fold's (`foldEngineReverseWire.ts`).
 */
export interface FoldCrimpAnalysis {
  tip: FoldReverseAnalysis;
  /** ℓ2 after snapping, and its side away from ℓ1. */
  second: FoldModelLine;
  second_side: FoldSide;
  second_snap: FoldSnap;
  /** The tip's faces with paper beyond ℓ2. */
  beyond: number[];
}

export interface FoldCrimpAnalysed {
  analysis: FoldCrimpAnalysis;
  /** The kinds that land; null while a flap opening several ways is still to choose. */
  kinds: FoldCrimpKind[] | null;
}

/** Which side of its target a tuck's block lands on, in the model frame. */
export type FoldTuckPlacement = 'under' | 'over';

/** A layer a tuck's block lands on (`TuckTarget`). */
export interface FoldTuckTarget {
  face: number;
  /** An interior sheet point of it: what a step stores as `target`. */
  at: [number, number];
  /** Whether the block can lie against it; null when the listing's budget ran out first. */
  feasible: boolean | null;
}

/** What a tuck moves and the layers it can be tucked against (`TuckAnalysis`). */
export interface FoldTuckAnalysis {
  line: FoldModelLine;
  side: FoldSide;
  snap: FoldSnap;
  /** In the model frame: a turned-over view's valley is a mountain here. */
  direction: FoldDirection;
  placement: FoldTuckPlacement;
  /** The parent's faces that move, in id order. */
  moving: number[];
  /** Every layer the block lands on that stays, in id order. */
  targets: FoldTuckTarget[];
}

export interface FoldTuckAnalysed {
  analysis: FoldTuckAnalysis;
}

// ---------------------------------------------------------------------------
// Landings

/** What a crimp did (`CrimpReport`), as a compound step reports it under `family: 'crimp'`. */
export interface FoldCrimpReport extends FoldCompoundReportBase {
  first: FoldModelLine;
  side: FoldSide;
  snap: FoldSnap;
  second: FoldModelLine;
  second_side: FoldSide;
  second_snap: FoldSnap;
  kind: FoldCrimpKind;
  openings: FoldOpening[];
  /** The flaps with no spine, moving whole: the parent's faces of each. */
  whole: number[][];
  /** What the step stores, in the engine's shapes: a reverse fold's. */
  stored: FoldReverseStored;
}

/** What a tuck did (`TuckReport`), as a compound step reports it under `family: 'tuck'`. */
export interface FoldTuckReport extends FoldCompoundReportBase {
  line: FoldModelLine;
  side: FoldSide;
  snap: FoldSnap;
  direction: FoldDirection;
  placement: FoldTuckPlacement;
  /** T, which stays and keeps its id. */
  target: number;
  /** What the step stores, in the engine's shapes: the order chosen among several. */
  stored: { order?: FoldCompletionChoice };
}

/** What a landed crimp or tuck stores beside its line's root: the document's choice keys. */
export interface FoldCompoundStored {
  opening?: FoldOpeningChoice[];
  completion?: FoldCompletionChoice;
}

/** A crimp or tuck its own call landed: a step as `step` lands one, with what it stores. */
export type FoldCrimpTuckLanded<F extends 'crimp' | 'tuck' = 'crimp' | 'tuck'> = FoldCompoundLanded<F> & {
  stored: FoldCompoundStored;
};

export type FoldCrimpTuckFingerprinted<F extends 'crimp' | 'tuck' = 'crimp' | 'tuck'> = FoldCompoundFingerprinted<F> & {
  stored: FoldCompoundStored;
};

/** Where a crimp's or tuck's own call got to (`CompoundTried`). */
export type FoldCrimpTuckTried<L extends FoldCrimpTuckLanded = FoldCrimpTuckLanded> =
  | ({ outcome: 'landed' } & L)
  /** A flap opens several ways: store one of each such flap's openings and fold again. Crimps only. */
  | { outcome: 'choose_opening'; analysis: FoldCrimpAnalysis }
  /** More than one order fits: each landed, up to sixteen; `orders` is the true count, `exact` whether it is. */
  | { outcome: 'choose_order'; orders: number; exact: boolean; candidates: L[] };

/** A stored compound choice that no longer resolves (`Broken`), as `choice_broken` carries it beside its code. */
export type FoldBrokenChoice =
  | { broken: 'witness'; witness: { cause: string; [field: string]: unknown } }
  | { broken: 'completion'; refusal: { code: string; [field: string]: unknown } }
  | { broken: 'not_unique'; orders: { orders: number; exact: boolean } }
  | { broken: 'gate'; refusal: { code: string; [field: string]: unknown } }
  | { broken: 'opening'; opening: number };
