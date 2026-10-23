/**
 * What crosses the Fold engine's bridge for the sinks (plan Phase 11,
 * research §5.4; `crates/oristudio-fold-wasm/src/ops_sinks.rs`), as
 * TypeScript sees it. Mirrors the engine's serde types, snake_case; the Rust
 * side is the truth.
 *
 * A sink is the document's op (`FoldSinkOp`: `open-sink`, `closed-sink`,
 * `unsink`), which the bridge lands through `apply` like any step, so a
 * commit lands exactly as a replay will. A sink tool asks first what the
 * point is and how it sinks (the compound question, `compoundAnalysis`,
 * `family: 'sink'`), and — when more than one order fits — how many
 * (`sinkOrders`) and what a pick stores (`sinkPick`). An unsink tool asks
 * which sunk points its line can pull back out (`sunkPoints`). What a step
 * stores comes back in the engine's shapes and goes into the document's
 * through {@link sinkStoredChoices}. A sink folds along one line, so it also
 * answers the plain fold's queries a tool previews with — `analyse`,
 * `action` (with the push onto the point's crown), `depthChoices` — as the
 * reverse folds do.
 *
 * A landed sink reports as the step's `compound` (`family: 'sink'`,
 * `foldEngineCompoundWire.ts`), its motion among it (plan D15): legs, each
 * turning groups of faces about a hinge, with exact endpoints — the engine's
 * `StepMotion`, every compound fold's (`FoldStepMotionLegs`).
 *
 * Pure types, constants and one conversion: no React, no store, no wasm.
 */

import type {
  FoldChoices,
  FoldCompletionChoice,
  FoldModelLine,
  SheetPoint,
} from '../document/foldSequenceDocument';
import type { FoldCompoundReportBase } from './foldEngineCompoundWire';
import type {
  FoldEngineOp,
  FoldEngineRefused,
  FoldFlap,
  FoldLetter,
  FoldModelPoint,
  FoldSide,
  FoldSnap,
} from './foldEngineWire';

/** Which way a point sinks. */
export type FoldSinkKind = 'open' | 'closed';

/** The document's sink ops, as their kind spells them. */
export const FOLD_SINK_OP_KINDS = ['open-sink', 'closed-sink', 'unsink'] as const;

export type FoldSinkOpKind = (typeof FOLD_SINK_OP_KINDS)[number];

/** A sink op as the bridge folds it: the document's, its line possibly the tools' model line with a `side`. */
export type FoldEngineSinkOp = Extract<FoldEngineOp, { kind: FoldSinkOpKind }>;

/** Whether an op is a sink. */
export function isFoldSinkOp(op: FoldEngineOp): op is FoldEngineSinkOp {
  return (FOLD_SINK_OP_KINDS as readonly string[]).includes(op.kind);
}

/** The engine's refusals of a sink, in `FoldRefusal::code`'s order: the preconditions a sink tool words. */
export const FOLD_SINK_REFUSAL_CODES = [
  'sink_several_points',
  'sink_point_open',
  'sink_outline_mixed',
  'sink_no_axis',
  'sink_line_tilted',
  'sink_no_pocket',
  'unsink_not_sunk',
] as const;

export type FoldSinkRefusalCode = (typeof FOLD_SINK_REFUSAL_CODES)[number];

/** Whether a refusal code is a sink's own. */
export function isSinkRefusalCode(code: string): code is FoldSinkRefusalCode {
  return (FOLD_SINK_REFUSAL_CODES as readonly string[]).includes(code);
}

// ---------------------------------------------------------------------------
// The point

/** A closed sink's pocket as a step stores it: a sheet point on the face just above it and one just below. */
export interface FoldStoredPocket {
  above: SheetPoint;
  below: SheetPoint;
}

/** A gap in the point's layers that a closed sink goes into. */
export interface FoldPocket {
  /** The parent's faces above it and below it, ascending. */
  upper: number[];
  lower: number[];
  /** The outline creases across it, ascending: they turn. */
  seams: number[];
  /** What a step stores to choose it. */
  stored: FoldStoredPocket;
}

/** A point and the ways it sinks, before anything lands (the compound question's). */
export interface FoldSinkPoint {
  /** ℓ after snapping, in the parent's model frame, and the side the point's tip is on. */
  line: FoldModelLine;
  side: FoldSide;
  snap: FoldSnap;
  /** The point: the moving side's flap the seed names. */
  point: FoldFlap;
  /** The folded creases on its outline, ascending. */
  outline: number[];
  /** The letter they share, the point's outside; null when they carry both. */
  exterior: FoldLetter | null;
  /** Where its two sides meet; null without an axis. */
  apex: FoldModelPoint | null;
  /** The line square to the point's axis where ℓ crosses it: the open sink's landmark. */
  square: FoldModelLine | null;
  /** The pockets a closed sink can go into, fewest lower faces first. */
  pockets: FoldPocket[];
  /** The scan stopped at its cap: more may exist. */
  truncated: boolean;
}

export interface FoldSinkAnalysed {
  analysis: FoldSinkPoint;
  /** Why an open sink of this point is refused, with its fixes; null when one may land. */
  open: Omit<FoldEngineRefused, 'status'> | null;
}

// ---------------------------------------------------------------------------
// A landed sink

export type FoldSinkStep = 'open' | 'closed' | 'unsink';

/** What a step stores for a sink, in the engine's shapes. */
export interface FoldSinkStored {
  pocket?: FoldStoredPocket;
  order?: FoldCompletionChoice;
}

/** What a sink or an unsink did (`SinkReport`), as a compound step reports it under `family: 'sink'`. */
export interface FoldSinkReport extends FoldCompoundReportBase {
  step: FoldSinkStep;
  /** ℓ after snapping, and the side the moving paper started on. */
  line: FoldModelLine;
  side: FoldSide;
  snap: FoldSnap;
  /** A closed sink's pocket. */
  pocket?: FoldPocket;
  /** The landed state's creases between the moved paper and the paper that stays: folded by a sink, flat after an unsink. */
  ring: number[];
  /** What the step stores: the pocket chosen among several, the order chosen among several. */
  stored: FoldSinkStored;
}

/** How many orders a sink leaves with its choices (`sinkOrders`): one when it is decided. */
export interface FoldSinkOrders {
  count: { orders: number; exact: boolean };
  /** Per independent component, how many orders are listed to pick from. */
  components: { orders: number; truncated: boolean }[];
}

/** What a step stores for a pick (`sinkPick`); null when the sink is decided. */
export interface FoldSinkPicked {
  completion: FoldCompletionChoice | null;
}

/**
 * The sunk points an unsink along a line can pull back out, on its side
 * (`sunkPoints`): what an unsink tool names when the folder has named none.
 * The paper round a sunk point, all on one side of its ring too, is none.
 */
export interface FoldSunkPoints {
  /** ℓ after snapping, in the parent's model frame, and the side the sunk points lie on. */
  line: FoldModelLine;
  side: FoldSide;
  snap: FoldSnap;
  /** Each one a flap of that side: its witness is what an unsink's seed names it by. */
  points: FoldFlap[];
}

/** A stored pocket as the document's choice holds it: the point above, then the point below. */
export function pocketChoice(pocket: FoldStoredPocket): readonly [SheetPoint, SheetPoint] {
  return [pocket.above, pocket.below];
}

/** What a landed sink's step stores, as the document's choices: none when it chose nothing. */
export function sinkStoredChoices(stored: FoldSinkStored): FoldChoices {
  return {
    ...(stored.pocket ? { pocket: pocketChoice(stored.pocket) } : {}),
    ...(stored.order && stored.order.orders.length > 0 ? { completion: stored.order } : {}),
  };
}
