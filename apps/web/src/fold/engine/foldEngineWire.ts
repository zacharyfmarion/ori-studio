/**
 * What crosses the Fold engine's bridge (`crates/oristudio-fold-wasm`), as
 * TypeScript sees it. Mirrors `src/wire.rs`; the Rust side is the truth.
 *
 * - **Inputs are the document's own types** (`fold/document`): its paper, ops
 *   and choices cross unchanged, so a replay hands a stored step over as it is
 *   and every sheet anchor is resolved in Rust, never here. The tools add
 *   three things the document never writes ({@link FoldEngineOp}): a line
 *   already in the parent's model frame (`via: 'model'`) with a `side` of it,
 *   a tuck's `placement`, and the `closure` policy.
 * - **Outputs** are the engine's own serde types, snake_case like every
 *   bridge's, in an envelope tagged by `status`: `ok`, or `refused` with a
 *   stable `code`, the fixes the engine offers and the faces and vertices the
 *   refusal names. A refusal never carries a sentence; the UI words it from
 *   the code.
 * - **Handles.** A landed state stays in the worker under a numeric handle
 *   until it is released; nothing but the handle crosses back. The queries
 *   (the scene, the cross-section, a step's summary and picture, landmarks)
 *   are asked of a handle.
 *
 * Pure types, constants and the one predicate on a thrown code: no React, no
 * store, no wasm.
 */

import type { OristudioCpFoldedPaperEdgeKind, OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import type { FoldStateFingerprint } from '../document/foldDigest';
import type {
  FoldDirection,
  FoldLineInput,
  FoldModelLine,
  FoldOp,
  FoldPlainOp,
  FoldPrecreaseOp,
  FoldSeed,
  SheetPoint,
} from '../document/foldSequenceDocument';
import type { FoldCompoundReport } from './foldEngineCompoundWire';
import { FOLD_IMPORT_REFUSAL_CODES } from './foldEngineIoWire';
import type { FoldNoOpening, FoldReverseKind } from './foldEngineReverseWire';
import {
  FOLD_SWIVEL_REFUSAL_CODES,
  type FoldNoFlap,
  type FoldNoPetal,
  type FoldNoPetalDetail,
  type FoldPetalCrease,
} from './foldEngineSquashWire';
import { FOLD_SINK_REFUSAL_CODES, type FoldSinkKind } from './foldEngineSinkWire';

/** A side of a line: `positive` is where `n · p > d`. */
export type FoldSide = 'positive' | 'negative';

export type FoldLetter = 'mountain' | 'valley';

/** A point in the model frame, `[x, y]`. */
export type FoldModelPoint = readonly [number, number];

// ---------------------------------------------------------------------------
// Inputs

/** A line the tools give in the parent's model frame, never stored. */
export interface FoldModelLineInput {
  via: 'model';
  line: FoldModelLine;
}

/** Where a fold line comes from: the document's line modes, or the tools' model line. */
export type FoldEngineLine = FoldLineInput | FoldModelLineInput;

/** The document's axiom line: what the candidate chooser asks about. */
export type FoldAxiomLine = Extract<FoldLineInput, { via: 'axiom' }>;

/** Where the moving block lands: the engine's `Placement`. */
export type FoldEnginePlacement =
  | { placement: 'on_top' }
  | { placement: 'over'; at: SheetPoint }
  | { placement: 'under'; at: SheetPoint };

/** What the tools may add to a step's motion. */
export interface FoldToolMotion {
  /** A side of a model line, against its normal as given; never with `moving`, never with another line. */
  side?: FoldSide;
  placement?: FoldEnginePlacement;
  /** `include` (the default) moves the flaps the closure adds; `refuse` refuses, offering them. */
  closure?: 'include' | 'refuse';
}

/** A document op with the tools' additions: a fold along a line may take a model line, and any fold the motion fields. */
type WithTools<O> = O extends { line: FoldLineInput }
  ? Omit<O, 'line'> & { line: FoldEngineLine } & FoldToolMotion
  : O extends { seed: FoldSeed }
    ? O & FoldToolMotion
    : O;

/**
 * What the bridge folds: any document op as it is stored ({@link FoldOp}
 * is assignable to it), or one the tools are previewing. A stored `cp-jump`
 * lands after its parent or is refused with an `import_*` code
 * (`foldEngineIoWire.ts`); an `origin` outside the document's `FoldCpOrigin`
 * is the caller's mistake and throws.
 */
export type FoldEngineOp = WithTools<FoldOp>;

// ---------------------------------------------------------------------------
// Refusals

/**
 * A partial precrease's refusals (`oristudio-fold/src/fold/partial.rs`), in
 * `FoldRefusal::code`'s order: the gate's checks of crease marks, then an
 * extent that does not resolve — a point off the paper, shorter than the
 * minimum feature along the line, over no paper, or over no layer the
 * precrease goes through.
 */
export const FOLD_PARTIAL_PRECREASE_REFUSAL_CODES = [
  'mark_off_sheet',
  'mark_too_short',
  'mark_on_crease',
  'marks_overlap',
  'extent_off_paper',
  'extent_too_short',
  'extent_misses_paper',
  'extent_misses_layers',
] as const;

/** The engine's refusals, in `FoldRefusal::code`'s order (`oristudio-fold/src/refusal.rs`). */
export const FOLD_ENGINE_REFUSAL_CODES = [
  'sheet_too_few_points',
  'sheet_not_finite',
  'sheet_not_convex',
  'sheet_side_too_short',
  'sheet_not_in_unit_frame',
  'invalid_rectangle',
  'invalid_sides',
  'too_many_faces',
  'stacked_too_deep',
  'duplicate_id',
  'unknown_vertex',
  'crease_unknown_vertex',
  'unused_vertex',
  'face_too_small',
  'missing_crease',
  'crease_face_count',
  'non_convex_face',
  'area_mismatch',
  'vertex_off_sheet',
  'border_off_outline',
  'root_not_rigid',
  'view_not_finite',
  'unknown_root',
  'unreached_face',
  'residual',
  'hinge_orientation',
  'folded_image',
  'layer_order',
  'no_moving_side',
  'near_miss',
  'witness_not_in_face',
  'seed_not_on_moving_side',
  'empty_seed',
  'nothing_stays',
  'closure_adds_flaps',
  'tuck_target_moves',
  'degenerate_split',
  'short_crease',
  'thin_piece',
  'sliver',
  'prediction_mismatch',
  'precrease_unfold_moved_more',
  // A compound fold (plan D4) and the reverse fold on it.
  'no_order',
  'budget_exceeded',
  'no_such_choice',
  'reverse_no_opening',
  'reverse_tip_not_free',
  'reverse_kind_infeasible',
  // The tuck and the crimp (plan Phase 11).
  'tuck_infeasible',
  'crimp_lines_meet',
  'crimp_misses_tip',
  'crimp_no_opening',
  'crimp_kind_infeasible',
  'crimp_tip_not_free',
  // The vertex folds (plan Phase 11).
  'squash_no_flap',
  'squash_flap_not_free',
  'squash_flap_covered',
  'squash_target_outside',
  'petal_not_precreased',
  'petal_no_flap',
  'fan_center',
  'fan_ray_blocked',
  'fan_not_flat',
  'fan_fourth_beside_stayer',
  'fan_fourth_cannot_rise',
  'fan_stayer_detached',
  // The swivel by its edge (`compound::swivel`) and by its valley and
  // mountain (`compound::swivel_valley_mountain`), before its fan's own.
  ...FOLD_SWIVEL_REFUSAL_CODES,
  // Sinks (plan Phase 11).
  ...FOLD_SINK_REFUSAL_CODES,
  ...FOLD_PARTIAL_PRECREASE_REFUSAL_CODES,
  'internal',
] as const;

/**
 * An anchored fold whose line or side does not resolve, in `LineRefusal::code`'s
 * order (`oristudio-fold/src/anchored.rs`): a stored step's anchors no longer
 * name paper in its parent, or an axiom gives no fold there.
 */
export const FOLD_LINE_REFUSAL_CODES = [
  'point_off_paper',
  'segment_too_short',
  'segment_not_on_a_face',
  'free_line_too_short',
  'no_root',
  'no_side',
  'side_on_line',
  'mover_stays',
] as const;

/** The bridge's own, in `BridgeRefusal::code`'s order (`oristudio-fold-wasm/src/wire.rs`). */
export const FOLD_BRIDGE_REFUSAL_CODES = [
  'unexpected_choice',
  'root_missing',
  'crease_not_found',
  'crease_not_flat',
  'crease_not_folded',
  // A compound fold's choices (`oristudio-fold-wasm/src/compound.rs`): a
  // stored step whose stored choices do not decide it, or no longer resolve.
  'choice_needed',
  'choice_broken',
] as const;

/** Every refusal code: the stable ids the UI and analytics use (D18). They never collide. */
export const FOLD_RETURN_REFUSAL_CODES = [
  'return_target_invalid', 'return_state_unavailable', 'return_source_changed', 'return_unavailable',
  'return_sheet_mismatch', 'return_limit', 'return_material', 'return_order', 'return_pose', 'return_arrangement', 'return_invalid_state',
] as const;
export const FOLD_REFUSAL_CODES = [
  // Worker-level composite replay; this is not a Rust engine refusal.
  'repeat_failed',
  'pleat_failed',
  ...FOLD_RETURN_REFUSAL_CODES,
  ...FOLD_ENGINE_REFUSAL_CODES,
  ...FOLD_LINE_REFUSAL_CODES,
  ...FOLD_BRIDGE_REFUSAL_CODES,
  // A stored cp-jump that no longer lands, or an io call's refusal, under
  // Import CP's own codes (`BridgeRefusal::Io`).
  ...FOLD_IMPORT_REFUSAL_CODES,
] as const;

export type FoldRefusalCode = (typeof FOLD_REFUSAL_CODES)[number];

/** Why a near miss is one (`NearMissCause`). */
export type FoldNearMissCause = 'band' | 'snap_changes_side' | 'snap_ambiguous';

/**
 * A refusal, tagged by its code. The fields the tools read are typed; every
 * code carries the rest of its Rust fields too.
 */
export type FoldRefusalBody =
  | { readonly code: 'closure_adds_flaps'; readonly added: readonly number[] }
  | {
      readonly code: 'near_miss';
      readonly vertex: number;
      readonly distance: number;
      readonly cause: FoldNearMissCause;
    }
  | { readonly code: 'sliver'; readonly vertex: number; readonly face: number; readonly penetration: number }
  | FoldCompoundRefusalBody
  | {
      readonly code: Exclude<
        FoldRefusalCode,
        'closure_adds_flaps' | 'near_miss' | 'sliver' | FoldCompoundRefusalBody['code']
      >;
      readonly [field: string]: unknown;
    };

/**
 * A compound fold's refusals the tools read the fields of (plan D4, D14),
 * one block per family. `choice_needed` names the choice a step's stored
 * choices leave open; `choice_broken` is a stored choice that no longer
 * resolves, with the engine's cause (`Broken`).
 */
export type FoldCompoundRefusalBody =
  | { readonly code: 'choice_needed'; readonly choice: 'opening' | 'pocket' | 'completion' }
  | { readonly code: 'choice_broken'; readonly broken: string; readonly [field: string]: unknown }
  // The reverse fold (`foldEngineReverseWire.ts`).
  | { readonly code: 'reverse_no_opening'; readonly faces: readonly number[]; readonly cause: FoldNoOpening }
  | { readonly code: 'reverse_kind_infeasible'; readonly kind: FoldReverseKind; readonly faces: readonly number[] }
  | { readonly code: 'reverse_tip_not_free'; readonly blocking: readonly number[]; readonly faces: readonly number[] }
  // The crimp and the tuck (`foldEngineCrimpTuckWire.ts`). A tuck no layer
  // takes at all is the tools' own `tuck_infeasible`, with no `target`
  // (`useFoldTuckStep`'s `tuckWithoutTarget`); the engine's always names T.
  | { readonly code: 'crimp_kind_infeasible'; readonly kind: FoldReverseKind; readonly faces: readonly number[] }
  | {
      readonly code: 'tuck_infeasible';
      readonly target: number | null;
      readonly placement: 'under' | 'over';
      readonly faces: readonly number[];
    }
  // The vertex folds (`foldEngineSquashWire.ts`).
  | { readonly code: 'squash_no_flap'; readonly faces: readonly number[]; readonly cause: FoldNoFlap }
  | { readonly code: 'petal_not_precreased'; readonly faces: readonly number[]; readonly missing: FoldPetalCrease }
  | {
      readonly code: 'petal_no_flap';
      readonly faces: readonly number[];
      readonly cause: FoldNoPetal;
      /** What the cause names more precisely, where it does: absent otherwise. */
      readonly detail?: FoldNoPetalDetail;
    }
  // The sinks (`foldEngineSinkWire.ts`).
  | { readonly code: 'sink_several_points'; readonly flaps: number; readonly faces: readonly number[] };

/**
 * A flap: a connected part of the moving side, joined across creases with an
 * end on the moving side (plan D3), named by an interior sheet point of one
 * of its faces. The chips and the layer picker use this grouping, never one
 * of their own.
 */
export interface FoldFlap {
  /** Its faces, ascending. */
  readonly faces: readonly number[];
  readonly witness: SheetPoint;
}

/** A step as the document stores it: a sliver remedy's fold along an axiom, its root the choice. */
export interface FoldStoredStep {
  readonly op: FoldPlainOp | FoldPrecreaseOp;
  readonly choices: { readonly root: FoldModelLine };
}

/** A remedy offered with a refusal (plan D14). */
export type FoldFix =
  /** Include these flaps (indices into the analysis' flaps), which the closure would move anyway. */
  | { readonly fix: 'include_flaps'; readonly flaps: readonly number[] }
  /** The same fold the other way is valid. */
  | { readonly fix: 'opposite_direction' }
  /** Everything would move: pick one of these flaps to fold. */
  | { readonly fix: 'pick_flap'; readonly flaps: readonly FoldFlap[] }
  /**
   * Fold along this line instead, with the same moving side: preview it as
   * `{ via: 'model', line }` with `side`. A sliver remedy also carries the
   * `step` to commit; a near miss's landmark line has none.
   */
  | { readonly fix: 'use_line'; readonly line: FoldModelLine; readonly side: FoldSide; readonly step?: FoldStoredStep }
  /** The same reverse fold of the other kind is valid. */
  | { readonly fix: 'other_kind'; readonly kind: 'inside' | 'outside' }
  /** The same tuck against this layer is valid: send `at` back as the tuck's `target`. */
  | { readonly fix: 'tuck_target'; readonly face: number; readonly at: SheetPoint }
  /**
   * The same rabbit ear or swivel with this emergent ray, a direction in the
   * parent's model frame, lands; for a swivel by its edge, with this ridge
   * (store it as the op's `ridge`).
   */
  | { readonly fix: 'use_emergent'; readonly direction: FoldModelPoint }
  /** The same point sinks the other way: closed where an open sink is refused, open where a closed one is. */
  | { readonly fix: 'other_sink'; readonly kind: FoldSinkKind };

export interface FoldEngineRefused {
  status: 'refused';
  refusal: FoldRefusalBody;
  fixes: FoldFix[];
  /** Every face the refusal names, ascending. */
  faces: number[];
  /** Every vertex the refusal names. */
  vertices: number[];
}

/** An answer: `{ status: 'ok', …T }`, or a refusal. */
export type FoldEngineOutcome<T> = ({ status: 'ok' } & T) | FoldEngineRefused;

// ---------------------------------------------------------------------------
// Steps

/** The snap actually applied to the fold line (plan D5). */
export interface FoldSnap {
  clusters: number;
  angle: number;
  max_shift: number;
}

/** What a fold would move (D14 tier 2), in the parent's model frame. */
export interface FoldAnalysis {
  /** The line actually folded along, after snapping, and its moving side. */
  line: FoldModelLine;
  side: FoldSide;
  snap: FoldSnap;
  /** In the model frame: a turned-over view's valley is a mountain here. */
  direction: FoldDirection;
  flaps: FoldFlap[];
  /** The flaps the seed named, by index into `flaps`. */
  picked: number[];
  /** The flaps the closure added beyond those. */
  added: number[];
  /** The parent's faces that move. */
  moving: number[];
}

export interface FoldRefold {
  edge: number;
  remembered: FoldLetter;
  letter: FoldLetter;
}

/** What a fold did. */
export interface FoldReport extends FoldAnalysis {
  /** The landed state's faces that moved. */
  moving_faces: number[];
  /** The creases the fold made. */
  created: number[];
  /** Folded creases on the line that became flat. */
  unfolded: number[];
  /** Flat creases on the line that became folded. */
  refolded: FoldRefold[];
  /** How many faces were split. */
  split: number;
}

/** How the viewer sees the model frame: turned over (seen from −z), and rotated, radians counter-clockwise. */
export interface FoldView {
  flipped: boolean;
  rotation: number;
}

/** A state at a glance. */
export interface FoldStateSummary {
  /** How many steps led here; the flat sheet is 0. */
  step: number;
  faces: number;
  /** Ordered pairs of overlapping faces. */
  pairs: number;
  /** Front-relative, as stored and exported. */
  creases: { border: number; mountain: number; valley: number; flat: number };
  view: FoldView;
  /** The largest disagreement between two images of one vertex. */
  residual: number;
  /** The sheet's outline, counter-clockwise, in sheet coordinates. */
  sheet: [number, number][];
  /** How many crease marks (partial creases) the state has; absent for none. */
  crease_marks?: number;
}

export interface FoldSheetLanded {
  state: number;
  summary: FoldStateSummary;
  fingerprint: FoldStateFingerprint;
}

export interface FoldStepLanded {
  state: number;
  /** A plain fold's; null for a turn, a rotation, an import or a compound fold. */
  report: FoldReport | null;
  /**
   * A compound fold's, of any family, tagged by its `family`, its motion's
   * legs among it (`foldEngineCompoundWire.ts`); absent for any other step.
   */
  compound?: FoldCompoundReport;
  summary: FoldStateSummary;
}

/**
 * Paper turning about one hinge during one leg of a compound step's motion
 * (plan D15, `StepMotion`): the landed state's faces that turn together, the
 * hinge in the model frame, the side they start on, and the turn at the
 * leg's start and end — 0 where they lay before this turn, ±π where it
 * leaves them, positive toward +z of the model frame.
 */
export interface FoldMotionGroup {
  faces: number[];
  axis: FoldModelLine;
  side: FoldSide;
  from: number;
  to: number;
  /**
   * The turn that carries this group's hinge while the group turns about it,
   * over the same leg, applied after the group's own: a crimp's strip about
   * ℓ1, carrying ℓ2 and its tip. Absent for a hinge that stays where it lies.
   */
  carrier?: FoldMotionCarrier;
  /**
   * What the faces still do after this turn, in the model frame; absent when
   * it lands them: a vertex fold's paper turning twice.
   */
  then?: FoldIsometry;
}

/** A turn carrying another group's hinge (`FoldMotionGroup.carrier`): its line, the side the carried paper starts on, and its turn at the leg's start and end. */
export interface FoldMotionCarrier {
  axis: FoldModelLine;
  side: FoldSide;
  from: number;
  to: number;
}

/**
 * One leg of a compound step's motion: its groups turning at once, drawn
 * stacked as the parent stacks them (`spread`, flat to edge-on) or as the
 * landed state does (`close`, edge-on to landed).
 */
export interface FoldMotionLeg {
  name: 'spread' | 'close';
  stacking: 'parent' | 'landed';
  groups: FoldMotionGroup[];
}

/**
 * A compound step's motion, every family's one type (the engine's
 * `StepMotion`), read off any compound report by `stepMotionLegsOf`
 * (`foldEngineCompoundWire.ts`): `visual` when only its ends are states, the
 * frames between a picture.
 */
export interface FoldStepMotionLegs {
  kind: 'rigid' | 'visual';
  legs: FoldMotionLeg[];
}

export interface FoldStepFingerprinted extends FoldStepLanded {
  fingerprint: FoldStateFingerprint;
}

export interface FoldAnalysed {
  analysis: FoldAnalysis;
}

// ---------------------------------------------------------------------------
// Queries

/** `x' = a x + b y + c`, `y' = d x + e y + f`, as `[a, b, c, d, e, f]`. */
export type FoldIsometry = readonly [number, number, number, number, number, number];

/** One crease-pattern edge in sheet coordinates, with Fold's edge id: what the crease-pattern pane hit-tests. */
export interface FoldSceneCrease {
  id: number;
  vertices: [number, number];
  from: Point;
  to: Point;
  kind: OristudioCpFoldedPaperEdgeKind;
  /** Front-relative: a folded crease's letter, or the one an unfolded crease remembers; null for the border. */
  letter: FoldLetter | null;
  /** The step that made it; 0 for the sheet's border. */
  made_at: number;
}

/**
 * A crease mark's part on one face, in the scene frame: what the folded pane
 * draws. The same line is among the scene's `aux_lines`, which every folded
 * painter already draws cut to where its face is on top.
 */
export interface FoldSceneMarkPiece {
  /** An index into `faces`. */
  face: number;
  from: Point;
  to: Point;
  /** The letter as the viewer sees it on this face: the stored one where it shows its front, the other where its back. */
  seen: FoldLetter;
}

/**
 * A crease mark: a partial crease a pinch or a segment precrease left. It
 * keeps its letter and every later fold carries it, but it ends inside the
 * paper, so it bounds no face (`oristudio-fold/src/crease_marks.rs`).
 */
export interface FoldSceneCreaseMark {
  /** Its ends in sheet coordinates: what the crease-pattern pane draws. */
  from: Point;
  to: Point;
  /** Front-relative, as stored. */
  letter: FoldLetter;
  /** The step that made it. */
  made_at: number;
  /** Its part on each face it crosses. */
  pieces: FoldSceneMarkPiece[];
}

/** Where a face came from. */
export interface FoldFaceLineage {
  id: number;
  /** The face it was split from; null for the sheet's face. */
  parent: number | null;
  /** The step that made it. */
  born: number;
}

/**
 * A state's scene (plan D12): the kernel's folded paper scene, schema 3, so
 * the app's painters take it unchanged, plus the fields only Fold has.
 * Everything but `sheet_points` and `creases` is in the scene frame (the
 * view applied).
 */
export interface FoldScene extends OristudioCpFoldedPaperScene {
  /** The version of Fold's own fields. */
  fold_schema: number;
  view: FoldView;
  /** Model frame to scene: its inverse takes a pick back to the frame a stored line lives in. */
  view_transform: FoldIsometry;
  /** Per face, sheet to scene: exact, never fitted. */
  face_transforms: FoldIsometry[];
  /** In edge id order. */
  creases: FoldSceneCrease[];
  /** Per face. */
  lineage: FoldFaceLineage[];
  /** The crease marks, in the state's order; absent for none. */
  crease_marks?: FoldSceneCreaseMark[];
}

/** A stretch of the fold line where moving paper is creased or turned. */
export interface FoldLineSpan {
  from: Point;
  to: Point;
  /** A compound step can carry both letters; otherwise use the action's direction. */
  direction?: FoldDirection;
  /** A layer that stays covers it, as the viewer sees it: drawn as a line behind. */
  hidden: boolean;
}

/** The arrow's ends. */
export interface FoldGrip {
  /** On the moving paper. */
  at: Point;
  /** Where the fold puts that paper. */
  image: Point;
  /** The layers over the grip's face at `at`, as the viewer sees them. */
  hidden_at: number;
  /** The layers over it at `image` once landed; null before it lands, or for a precrease. */
  hidden_image: number | null;
}

/** A step's picture on the state it starts from (plan D12, per step), in that state's scene frame. */
export interface FoldActionGeometry {
  kind: 'fold' | 'precrease';
  /** As the viewer sees it. */
  direction: FoldDirection;
  /** The fold line across the silhouette; null when it misses the paper. */
  line: [Point, Point] | null;
  spans: FoldLineSpan[];
  /** The parent's faces that move. */
  moving: number[];
  grip: FoldGrip | null;
  /** A compound fold's; absent for a plain fold. */
  push?: { at: Point; toward: Point };
  pleat?: { from: Point; to: Point; kinks: number };
}

export interface FoldActed {
  action: FoldActionGeometry;
}

/** The picture of the step that landed a state; null for a sheet, a turn, a rotation or an import. */
export interface FoldStepActed {
  action: FoldActionGeometry | null;
}

/** A stretch of the fold line with one stack (D14 cross-section, 1). Distances run from the section's `from`. */
export interface FoldCrossSectionInterval {
  start: number;
  end: number;
  /** Top first as the viewer sees them. */
  faces: number[];
  /** The rows of those faces, top first: indices into the section's rows. */
  rows: number[];
}

/**
 * A display layer (D14 cross-section, 2): faces joined across flat creases,
 * which share one isometry. Rows, row counts and picker targets are display
 * layers, never faces, so one physical layer crossed by a precrease is one
 * row. Every row is on the moving side, in one flap.
 */
export interface FoldCrossSectionRow {
  /** Ascending. */
  faces: number[];
  /** Where it meets the line, `[start, end]`, in order. */
  spans: [number, number][];
  /** Its flap: an index into the section's flaps. */
  flap: number;
}

/**
 * How the rows are ordered (D14 cross-section, 3): topologically, with the
 * pairs `[i, j]` (`i < j`) no interval relates — they meet the line apart and
 * are placed by span position only — or, when grouping made a cycle, woven:
 * read the interval under the pointer instead.
 */
export type FoldRowOrder = { kind: 'layered'; unordered: [number, number][] } | { kind: 'woven' };

/** Two rows a bend joins where it meets the line: the bracket the picker draws. */
export interface FoldCrossSectionJoin {
  /** Row indices, `upper < lower`. */
  upper: number;
  lower: number;
  /** The distance along the section from its `from`. */
  at: number;
}

/** The paper along a fold line on its moving side (plan D14), computed once per line and side (tier 2). */
export interface FoldCrossSection {
  /** The line as a fold along it would fold (snapped), in the model frame, and its moving side. */
  line: FoldModelLine;
  side: FoldSide;
  /** Where it starts and ends in the scene frame, running with the moving side on its left as the viewer sees it. */
  from: Point;
  to: Point;
  intervals: FoldCrossSectionInterval[];
  /** Top to bottom as the viewer sees them (by span position for a woven section). */
  rows: FoldCrossSectionRow[];
  order: FoldRowOrder;
  /** The moving side's flaps (D3); each row names one. */
  flaps: FoldFlap[];
  /** "Layers": the most rows one interval stacks (D14 cross-section, 5). */
  layers: number;
  /** Ascending by rows, then along the line. */
  joins: FoldCrossSectionJoin[];
}

export interface FoldSectioned {
  section: FoldCrossSection;
}

/** One stack a depth seed can pick at a point. */
export interface FoldDepthChoice {
  /** The fewest layers at the point that move this set: the depth to store. */
  layers: number;
  /** The most layers that move the same set. */
  through: number;
  /** The faces that move. */
  moving: number[];
  /** The flaps the depth picks, and those the closure adds. */
  picked: number[];
  added: number[];
}

export interface FoldDepthChosen {
  choices: FoldDepthChoice[];
}

/**
 * A step's summary (plan D14). An import's is the pattern it brings: it
 * replaces the state before it rather than changing it, so its diff is empty.
 */
export interface FoldStepSummary {
  /** The child's crease pattern, front-relative. */
  counts: { mountain: number; valley: number; flat: number };
  /**
   * The child's edge ids that the step added, reversed, unfolded and
   * refolded; and the crease marks a partial precrease made, counted apart
   * (absent for none): "adds 2 pinch marks".
   */
  diff: { added: number[]; reversed: number[]; unfolded: number[]; refolded: FoldRefold[]; marks_added?: number };
  /** The display layers the fold went through; null for a turn, a rotation or an import. */
  layers: number | null;
}

/** The summary of the step that landed a state; null for the flat sheet. */
export interface FoldStepSummarised {
  summary: FoldStepSummary | null;
}

/**
 * Whether `stepSummary` or `stepAction` threw because the state's parent is
 * no longer held. The bridge compares a fold, a turn or a rotation with its
 * parent, and the replay's cache can keep a step after letting its parent go
 * (undo, then redo after a trim): the step simply has no summary or picture
 * until it is landed again. Not a fault to report.
 */
export function isFoldParentReleased(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'parent_released');
}

/** One fold an axiom yields on a state. */
export interface FoldAxiomCandidate {
  /** The construction's root number: an enumeration index, shown, never stored. */
  root: number;
  /** The fold line in the model frame: what a step stores as `choices.root`. */
  line: FoldModelLine;
  /** The side that moves, when the axiom carries something; null leaves it to the step. */
  side: FoldSide | null;
}

export interface FoldAxiomCandidates {
  candidates: FoldAxiomCandidate[];
}

/** A crease-pattern segment a landmark names by its sheet end points: the anchor a step stores. */
export interface FoldSheetSegment {
  a: SheetPoint;
  b: SheetPoint;
}

/** A feature a crease mark crosses: a segment (an index into the segments), or a crease mark (by its index in the state's). */
export type FoldFeatureRef = { segment: number } | { crease_mark: number };

/** One feature at a point landmark, with the sheet point that names it. */
export type FoldPointSource = { sheet: SheetPoint; visible: boolean } & (
  | { kind: 'vertex'; vertex: number }
  /** On `segment` (whose layer the sheet point is on), crossing `other`: indices into the segments. */
  | { kind: 'crossing'; segment: number; other: number }
  /** A mark passed in, by its index. */
  | { kind: 'mark'; mark: number }
  /** An end of a crease mark, by its index in the state's crease marks (the scene's `crease_marks`). */
  | { kind: 'crease_mark_end'; crease_mark: number }
  /** Where a crease mark crosses a segment or another crease mark, on `on` (whose layer the sheet point is on), crossing `other`. */
  | { kind: 'crease_mark_crossing'; on: FoldFeatureRef; other: FoldFeatureRef }
);

export interface FoldPointLandmark {
  at: FoldModelPoint;
  /** Vertices first, then crossings, then marks, then crease marks' ends and crossings. */
  sources: FoldPointSource[];
  visible: boolean;
}

/** A crease mark's part on one face, with what the viewer sees of it: like a segment, but no crease and on no line. */
export interface FoldCreaseMarkLandmark {
  /** The mark, by its index in the state's crease marks. */
  crease_mark: number;
  /** Front-relative. */
  letter: FoldLetter;
  sheet: FoldSheetSegment;
  /** Its image in the model frame. */
  at: [FoldModelPoint, FoldModelPoint];
  /** The parts the viewer sees, as fractions from `at[0]` to `at[1]`: none on a hidden layer. */
  visible: [number, number][];
}

export interface FoldLineLandmark {
  line: FoldModelLine;
  /** Indices into the segments. */
  segments: number[];
  visible: boolean;
}

export interface FoldSegmentLandmark {
  edge: number;
  kind: 'raw_edge' | 'bend' | 'crease';
  sheet: FoldSheetSegment;
  /** Its image in the model frame. */
  at: [FoldModelPoint, FoldModelPoint];
  /** An index into the lines. */
  line: number;
  /** The parts the viewer sees, as fractions from `at[0]` to `at[1]`. */
  visible: [number, number][];
}

/** A state's landmarks, with provenance and visibility (plan Phase 3). */
export interface FoldLandmarks {
  points: FoldPointLandmark[];
  lines: FoldLineLandmark[];
  segments: FoldSegmentLandmark[];
  /** The crease marks' parts, one per face each crosses; absent for none. */
  crease_marks?: FoldCreaseMarkLandmark[];
}

/** The face the viewer sees at a model-frame point, and the sheet point there: where a mark made by a pick goes. */
export interface FoldTopVisible {
  face: number;
  sheet: SheetPoint;
}
