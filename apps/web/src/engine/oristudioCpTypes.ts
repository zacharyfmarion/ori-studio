import type { Point } from '../lib/geometry';
import type { CpGeometryTransport } from './oristudioCpGeometry';
import type {
  OristudioCpOperationId,
  OristudioCpOperationStatus,
} from '../lib/oristudioCpCommands';

export type OristudioCpOperationCategory =
  | 'Kernel'
  | 'Io'
  | 'KernelIntent'
  | 'KernelPreview'
  | 'UiPreviewOnly'
  | 'OutOfScopeUi';

/**
 * Whether an operation is a port or an Ori Studio original — the kernel's
 * `OperationOrigin`. `Oriedita` means `upstream` pins a real source element and
 * the behavior is parity-bound; `OriStudio` means there is no upstream to be in
 * parity with. See PORTING.md > "Ori Studio native operations".
 */
export type OristudioCpOperationOrigin = 'Oriedita' | 'OriStudio';

export interface OristudioCpOperationDescriptor {
  id: OristudioCpOperationId;
  upstream: string;
  target: string;
  category: OristudioCpOperationCategory;
  stage: number;
  status: OristudioCpOperationStatus;
  origin: OristudioCpOperationOrigin;
}

export interface OristudioCpRgbColor {
  red: number;
  green: number;
  blue: number;
}

export interface OristudioCpRgbaColor extends OristudioCpRgbColor {
  alpha: number;
}

/**
 * Which way an unassigned crease folded before its angle was forgotten — the
 * kernel's `FoldDirection`.
 *
 * Only ever present alongside `color: 'None'`: the kernel clears it in
 * `with_line_color` on the way out of `LineColor::None`, because a crease that
 * has a direction does not need a hint about one.
 */
export type OristudioCpFoldDirectionHint = 'Mountain' | 'Valley';

export interface OristudioCpLineSegment {
  a: Point;
  b: Point;
  active: string;
  color: string;
  selected: number;
  customized: number;
  customized_color: OristudioCpRgbColor;
  /**
   * `|ρ|` in kernel storage units. **Absent** for a classic ±180 crease, which
   * is every Oriedita-compatible segment — so a classic segment is structurally
   * identical to what it was before fold angles existed.
   *
   * Do not read this directly to decide fold semantics; use `creaseFoldAngle`
   * from `lib/foldAngle`, which combines it with the colour's direction.
   */
  fold_magnitude?: number;
  /**
   * The direction this crease folded before it was unassigned, when one was
   * kept. **Absent** unless the crease is unassigned *and* hinted, so an
   * unhinted segment stays structurally identical to what it was before hints
   * existed.
   *
   * This field is why `.osf` save, undo and paste were dropping hints: it is
   * the JS mirror of the kernel's `fold_direction_hint`, and everything that
   * persists or restores a document round-trips through this interface. A new
   * kernel field is not carried until it is declared here *and* read in
   * `readSegment` (`engine/oristudioCpGeometry.ts`).
   */
  fold_direction_hint?: OristudioCpFoldDirectionHint;
}

export interface OristudioCpCircle {
  x: number;
  y: number;
  r: number;
  color: string;
  customized: number;
  customized_color: OristudioCpRgbColor;
}

export interface OristudioCpTextElement {
  x: number | { 0: number };
  y: number | { 0: number };
  text: string;
}

export interface OristudioCpGridMetadata {
  interval_grid_size: number;
  grid_size: number;
  grid_xa: number;
  grid_xb: number;
  grid_xc: number;
  grid_ya: number;
  grid_yb: number;
  grid_yc: number;
  grid_angle: number;
  base_state: string;
  vertical_scale_position: number;
  horizontal_scale_position: number;
  draw_diagonal_gridlines: boolean;
}

export interface OristudioCpModel {
  line_segments: OristudioCpLineSegment[];
  circles: OristudioCpCircle[];
  points: Point[];
  aux_line_segments: OristudioCpLineSegment[];
  texts: OristudioCpTextElement[];
  grid: OristudioCpGridMetadata;
}

export interface OristudioCpOperationFrame {
  active: boolean;
  points: [Point, Point, Point, Point];
}

export interface OristudioCpDocumentSnapshot {
  title?: string | null;
  crease_pattern: OristudioCpModel;
  operation_frame?: OristudioCpOperationFrame;
  metadata: Record<string, unknown>;
}

export interface OristudioCpDocumentSummary {
  title?: string | null;
  line_segments: number;
  circles: number;
  points: number;
  aux_line_segments: number;
  texts: number;
  can_save_as_cp: boolean;
  is_empty: boolean;
}

export interface OristudioCpCommandResult {
  operation: OristudioCpOperationId;
  status: OristudioCpOperationStatus;
  diagnostics: string[];
  diagnostic_entries?: OristudioCpDiagnosticEntry[];
  /**
   * How many vertices a foldability check produced an answer for.
   *
   * Absent on every command that does not check vertices. Zero is **not** the
   * clean case: it means the check affirmed nothing, which is what a pattern
   * whose every vertex sits on the paper edge has always displayed as success.
   * It is the denominator "no errors" is implicitly about, and there is no
   * vertex to hang it on — hence a result field rather than an entry.
   */
  checked_vertices?: number | null;
}

export interface OristudioCpDiagnosticEntry {
  id: string;
  kind: string;
  severity: string;
  message: string;
  point?: Point | null;
  segments?: OristudioCpLineSegment[];
  rule?: string | null;
  /**
   * How far a spatial vertex is from closing, in degrees.
   *
   * Present only on a `Closure` entry. Carried structurally because the sentence
   * around the number has to be translated, and the kernel's own `message` is
   * already formatted English — a formatted string cannot be un-formatted.
   */
  residual_degrees?: number | null;
  /**
   * The signed fold angle that would close an undecided vertex, in degrees —
   * negative a mountain, the same convention {@link formatFoldAngle} prints.
   *
   * Deliberately a second number rather than a reuse of `residual_degrees`: one
   * is how far a vertex is from closing and this is a value to set. Present only
   * when exactly one angle closes the vertex; a branch has more than one answer
   * and naming one of them would be a choice the app is not entitled to make.
   */
  fold_angle_degrees?: number | null;
  violation_color?: string | null;
  big_little_big?: OristudioCpDiagnosticBigLittleBigSegment[];
}

export interface OristudioCpDiagnosticBigLittleBigSegment {
  segment: OristudioCpLineSegment;
  violating: boolean;
}

/** One crease a propagation draft would set. */
export interface OristudioCpPropagationCrease {
  /**
   * **One-based** line id — the same space `line_ids`, `pinned_angles` and
   * `toolReplacedLineIds` use. The kernel converts from its own zero-based
   * indices once, in the preview arm, so nothing on this side subtracts one.
   */
  line_id: number;
  /** Signed fold angle in degrees; negative is a mountain. */
  degrees: number;
}

/** One place a propagation draft stopped. */
export interface OristudioCpPropagationStall {
  point: Point;
  /**
   * `underdetermined` | `branching` | `unsolvable` | `above_cap` |
   * `out_of_scope`. The two the user acts on differently are `branching` ("I
   * have a question") and everything else ("I need another angle from you") —
   * do not share copy. `out_of_scope` is a third: the vertex was solvable and
   * was skipped because some of its unknowns were outside what may be written,
   * so the move is to widen the scope rather than to supply an angle.
   */
  reason: string;
  unknowns: number;
}

/**
 * What a propagation draft was allowed to write to.
 *
 * Sent because the user got the *scope* wrong — running across every pattern on
 * the canvas at once — so the window has to name which one it used rather than
 * leave it to be inferred from a count. Resolved kernel-side for both the
 * preview and the commit, so nothing here re-derives it.
 */
export interface OristudioCpPropagationScope {
  /** `selection` | `component` | `document`, as a stable kernel code. */
  kind: string;
  /** Creases the scope names. */
  creases: number;
  /** Vertices propagation was allowed to visit. */
  vertices: number;
  /**
   * Unassigned creases still inside the scope afterwards — the same number as
   * `propagation_free`, and deliberately not a document total.
   */
  free: number;
  /**
   * Vertices skipped because some of their unknowns fell outside the scope. The
   * one finding with an action attached: select those creases too, or clear the
   * selection and click the pattern.
   */
  out_of_scope: number;
}

export interface OristudioCpCommandPreview {
  segments: OristudioCpLineSegment[];
  circles: OristudioCpCircle[];
  points: Point[];
  /** Non-mutating measurement (length or angle) for the measure tools. */
  measurement?: number | null;
  diagnostics: string[];
  /**
   * Why the active tool cannot act on the input so far, as a stable kernel code
   * — see `cpToolUnavailableMessage`. An expected answer, not a complaint.
   */
  unavailable?: string | null;
  /**
   * How many *isolated* solutions the active tool found, when it enumerates
   * solutions at all.
   *
   * Only the isolated ones are counted, so a "2 of 3" readout means what it
   * says. A rank-deficient triple has a continuous family of answers rather than
   * a set of them; `candidate_is_family` marks that case instead of putting a
   * number on infinity.
   */
  candidate_count?: number | null;
  /**
   * Whether the previewed solution is one arbitrary member of a continuous
   * family rather than a branch in its own right.
   */
  candidate_is_family?: boolean | null;
  /**
   * Whether the previewed solution is the state the document is already in, so
   * the UI can say "this is what you have" rather than offering it as a change.
   */
  candidate_is_current?: boolean | null;
  /**
   * Whether the previewed solution folds a crease against a direction the user
   * marked on it.
   *
   * Applying replaces that mark with the opposite direction and there is no
   * second chance to notice it happened, so this has to reach the user before
   * Apply does. A warning and never a refusal — the kernel's
   * `AngleSolution::contradicts_hint` says why a hint does not get to veto an
   * answer that genuinely closes the vertex.
   */
  candidate_contradicts_hint?: boolean | null;
  /**
   * Whether the previewed solution leaves one of the three picked creases
   * undecided.
   *
   * The answer for that crease is zero — it does not fold — and zero names no
   * direction, so an unassigned crease has nothing to be decided as. The preview
   * segments already show it staying dashed; this is what lets the tool say so
   * in words, because "one of your three does not move" is a thing to read
   * before Apply rather than notice afterwards. The kernel's
   * `AngleSolution::leaves_undecided` says why the alternative — a valley that
   * folds by zero degrees — is worse.
   */
  candidate_leaves_undecided?: boolean | null;
  /** How many creases a propagation draft worked out. */
  propagation_solved?: number | null;
  /**
   * How many creases are still free after the draft — **scope-relative**, so a
   * draft over one of five patterns reports that pattern rather than the canvas.
   */
  propagation_free?: number | null;
  /**
   * The creases the draft would set, and what it would set them to.
   *
   * Index-aligned with `segments`, and emitted from the same kernel loop, so
   * `propagation_creases[i]` names the document crease that `segments[i]` is
   * standing in for. That is what lets the canvas *hide* those creases through
   * `toolReplacedLineIds` rather than paint the draft on top of them — a draft
   * that changed nothing otherwise looks already applied.
   *
   * Order is the order the draft resolved in: pins first, then outward from the
   * seed. Every entry is a crease that really changes, and no id appears twice.
   */
  propagation_creases?: OristudioCpPropagationCrease[];
  /** Where propagation stopped and is waiting on the user. */
  propagation_stalls?: OristudioCpPropagationStall[];
  /** Vertices that ended fully known and do not close. */
  propagation_conflicts?: Point[];
  /**
   * What the run was allowed to write to. Absent when the scope named nothing,
   * which is the case `unavailable` reports.
   */
  propagation_scope?: OristudioCpPropagationScope | null;
}

export type OristudioCpEstimationOrder =
  | 'Order0'
  | 'Order1'
  | 'Order2'
  | 'Order3'
  | 'Order4'
  | 'Order5'
  | 'Order6'
  | 'Order51';

export type OristudioCpEstimationStep =
  | 'Step0'
  | 'Step1'
  | 'Step2'
  | 'Step3'
  | 'Step4'
  | 'Step5'
  | 'Step10';

export type OristudioCpFoldedFigureDisplayStyle =
  | 'None0'
  | 'Development1'
  | 'Wire2'
  | 'Transparent3'
  | 'Development4'
  | 'Paper5';

export type OristudioCpFoldedFigureState = 'Front0' | 'Back1' | 'Both2' | 'Transparent3';

export interface OristudioCpFoldedFigureModel {
  front_color: OristudioCpRgbColor;
  back_color: OristudioCpRgbColor;
  line_color: OristudioCpRgbColor;
  scale: number;
  rotation: number;
  anti_alias: boolean;
  display_shadows: boolean;
  state: OristudioCpFoldedFigureState;
  folded_cases: number;
  transparent_transparency: number;
  transparency_color: boolean;
}

export interface OristudioCpFoldedWireframeLine {
  begin: number;
  end: number;
  color: OristudioCpLineColor;
}

export interface OristudioCpFoldedWireframe {
  points: Point[];
  lines: OristudioCpFoldedWireframeLine[];
  faces: number[][];
  starting_face: number;
  face_positions: number[];
  next_faces: Array<number | null>;
  associated_lines: Array<number | null>;
}

export interface OristudioCpFoldedFigureRenderOptions {
  display_mark?: boolean;
  selected?: boolean;
  index?: number;
  display_numbers?: boolean;
  selected_flat_point_indices?: number[];
  selected_folded_point_indices?: number[];
  custom_constraints?: OristudioCpCustomConstraint[];
}

export interface OristudioCpCustomConstraint {
  face_order: 'normal' | 'flipped';
  constraint_type: 'color_back' | 'color_front' | 'custom';
  position: Point;
}

export type OristudioCpFoldedRenderPrimitiveKind =
  | 'fill_path'
  | 'stroke_path'
  | 'stroke_segment'
  | 'fill_polygon'
  | 'stroke_polygon'
  | 'fill_rect'
  | 'stroke_rect'
  | 'fill_ellipse'
  | 'stroke_ellipse'
  | 'text';

export type OristudioCpFoldedRenderAntialias = 'on' | 'off' | 'default';

export type OristudioCpFoldedRenderPaint =
  | { kind: 'none' }
  | { kind: 'color'; color: OristudioCpRgbaColor }
  | {
      kind: 'gradient';
      from: Point;
      from_color: OristudioCpRgbaColor;
      to: Point;
      to_color: OristudioCpRgbaColor;
      cyclic: boolean;
    }
  | { kind: 'texture' }
  | { kind: 'other'; class_name: string };

export type OristudioCpFoldedRenderStroke =
  | { kind: 'none' }
  | {
      kind: 'basic';
      width: number;
      end_cap: number;
      line_join: number;
      miter_limit: number;
    }
  | { kind: 'other'; class_name: string };

export interface OristudioCpFoldedRenderStyle {
  paint: OristudioCpFoldedRenderPaint;
  stroke: OristudioCpFoldedRenderStroke;
  antialias: OristudioCpFoldedRenderAntialias;
}

export type OristudioCpFoldedRenderPathCommand =
  | { command: 'move_to'; point: Point }
  | { command: 'line_to'; point: Point }
  | { command: 'quad_to'; control: Point; point: Point }
  | { command: 'cubic_to'; control_1: Point; control_2: Point; point: Point }
  | { command: 'close' };

export type OristudioCpFoldedRenderGeometry =
  | { kind: 'path'; commands: OristudioCpFoldedRenderPathCommand[] }
  | { kind: 'segment'; from: Point; to: Point }
  | { kind: 'polygon'; points: Point[] }
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'ellipse'; x: number; y: number; width: number; height: number }
  | { kind: 'text'; value: string; position: Point };

export interface OristudioCpFoldedRenderPrimitive {
  sequence: number;
  kind: OristudioCpFoldedRenderPrimitiveKind;
  style: OristudioCpFoldedRenderStyle;
  geometry: OristudioCpFoldedRenderGeometry;
}

export interface OristudioCpFoldedRenderSnapshot {
  schema_version: number;
  fixture: string | null;
  pass: string | null;
  primitives: OristudioCpFoldedRenderPrimitive[];
}

/**
 * The two faces the layer-ordering estimate could not consistently stack
 * (Oriedita's `errorPos`). Both are 0-based indices into the folded
 * `wireframe.faces` list — index directly, no offset. Present only when the
 * fold hit a global flat-foldability contradiction; the fold still produces a
 * (transparent) figure.
 */
export interface OristudioCpFoldContradiction {
  upper_face: number;
  lower_face: number;
}

/**
 * Flat crease-pattern polygons (CP model coordinates) of the two contradicting
 * faces. Rendered as a translucent red fill in the CP editor, matching
 * Oriedita's `fillFace` in `drawSelfIntersectingSubFaces`.
 */
export interface OristudioCpContradictionFaceGeometry {
  upper: Point[];
  lower: Point[];
}

export interface OristudioCpFoldedFigureSnapshot {
  model: OristudioCpFoldedFigureModel;
  estimation_step: OristudioCpEstimationStep;
  display_style: OristudioCpFoldedFigureDisplayStyle;
  /** How many layer-ordering solutions the enumeration has found so far. */
  discovered_fold_cases: number;
  /**
   * 1-based index of the solution being shown. Equal to
   * {@link discovered_fold_cases} while stepping forward; they diverge only
   * after navigating back to an earlier case. Absent in figures saved before
   * backwards navigation existed — see {@link foldedFigureCurrentCase}.
   */
  current_fold_case?: number;
  find_another_overlap_valid: boolean;
  text_result: string;
  wireframe: OristudioCpFoldedWireframe | null;
  contradiction?: OristudioCpFoldContradiction | null;
  contradiction_faces?: OristudioCpContradictionFaceGeometry | null;
  /**
   * Why the estimate stopped where it did.
   *
   * `estimation_step` cannot say: `Step3` / `Transparent3` with no solutions is
   * where three different things land — a request that stopped below the layer
   * search, a search that found no valid ordering, and a contradiction, which
   * the kernel rewinds to that exact stage on purpose (mirroring Oriedita).
   * Absent on figures saved before this existed.
   */
  outcome?: OristudioCpFoldOutcome;
}

/** Mirror of the kernel's `folding::FoldOutcome`. */
export type OristudioCpFoldOutcome =
  | 'NotAttempted'
  | 'Solved'
  | 'NoSolutions'
  | 'Contradiction';

export interface OristudioCpFoldedFigureResult {
  handle: number;
  snapshot: OristudioCpFoldedFigureSnapshot;
}

export interface OristudioCpFoldedFigureBatchResult {
  snapshot: OristudioCpFoldedFigureSnapshot;
  discovered_case_numbers: number[];
}

/* ---------------------------------------------------------------------------
 * The 3D folded state
 *
 * Mirrors `oristudio_cp::folding3d`. Two objects cross the boundary per fold:
 * a {@link OristudioCpFolded3dSnapshot} (scalars and codes, ~2 KB, safe to
 * persist) and a {@link OristudioCpFolded3dRenderModel} (struct-of-arrays
 * geometry, up to ~235 KB on the largest corpus model, **not** persisted — the
 * `.osf` writer pretty-prints, which would put every number on its own line).
 *
 * Every string here is a stable kernel **code**, never a sentence: the
 * eight-locale i18n gate cannot see a Rust literal, so the copy lives on this
 * side and these key it.
 * ------------------------------------------------------------------------- */

/** Oriedita's five flat-foldability rules, as kernel codes. */
export type OristudioCpFlatFoldabilityRuleCode =
  | 'number_of_folds'
  | 'angles'
  | 'maekawa'
  | 'big_little_big'
  | 'none';

/** Why a vertex could not be evaluated at all. */
export type OristudioCpIndeterminateCode = 'unassigned_crease' | 'unsplit_junction';

/** Which geometric rule determined a layer pair outright. */
export type OristudioCpSeedKindCode = 'full_fold' | 'wall' | 'shared_slot' | 'cut';

/**
 * Why a crease pattern has **no** 3D folded figure at all.
 *
 * Measured over a 65-file non-flat corpus, the whole distribution is 21
 * `flat_foldability`, 8 `vertex_closure`, 7 `interior_cut`, 1 `disconnected`.
 * The other six arms are reachable in principle and reached by nothing — budget
 * copy accordingly rather than in proportion to novelty.
 */
export type OristudioCpFold3dRefusal =
  | { code: 'no_faces' }
  | { code: 'faces_unresolved' }
  | { code: 'disconnected'; reached: number; unreached: number }
  | { code: 'non_crease_join'; line: number }
  | { code: 'interior_cut'; line: number; point: Point }
  | { code: 'flat_foldability'; point: Point; rule: OristudioCpFlatFoldabilityRuleCode }
  | { code: 'vertex_indeterminate'; point: Point; cause: OristudioCpIndeterminateCode }
  | { code: 'vertex_closure'; point: Point; residual_degrees: number }
  | {
      code: 'loop_not_closed';
      worst_edge: number | null;
      gap_radians: number;
      gap_offset: number;
    }
  | {
      code: 'tolerance_window_closed';
      faces: [number, number];
      normal_radians: number;
      offset_relative: number;
      /** `null` means no two distinct planes are parallel — not an infinity. */
      min_inter_separation: number | null;
    };

/**
 * Why a **placed** figure has no layer order.
 *
 * None of these is a refusal: the figure draws, and only the stacking is
 * unavailable. They ride inside {@link OristudioCpFold3dVerdict}.
 */
export type OristudioCpFold3dOrderReason =
  | { code: 'overlap_without_cell'; plane: number; faces: [number, number] }
  | { code: 'cell_without_overlap'; plane: number; faces: [number, number] }
  | { code: 'arrangement_refused'; plane: number; first_face: number; faces: number }
  | {
      code: 'contradictory_seeds';
      upper: number;
      lower: number;
      first_rule: OristudioCpSeedKindCode;
      first_line: number;
      second_rule: OristudioCpSeedKindCode;
      second_line: number;
    }
  | { code: 'no_layer_order'; component: number; faces: number; variables: number }
  | { code: 'face_id_out_of_range'; component: number; face: number; faces_total: number }
  | { code: 'search_failed'; component: number }
  /**
   * The search ran out of its iteration budget. Its own code because it is its
   * own claim — not "this pattern has no layer order" but "we stopped looking".
   */
  | { code: 'search_exhausted'; component: number; iterations: number };

/** A self-intersection no layer order repairs. */
export type OristudioCpFold3dCrossing =
  | { code: 'chords'; lines: [number, number]; faces: [number, number, number, number] }
  | { code: 'transversal'; line: number; face: number }
  | { code: 'sheets'; line: number; faces: [number, number] };

/**
 * What the fold concluded about a figure it placed.
 *
 * The three non-`folded` conditions are independent and can co-occur; the
 * kernel applies one documented precedence (`no_layer_order` >
 * `transversal_crossing` > `local_crossing`) and every count it hides is still
 * on the snapshot, so nothing is lost.
 *
 * `folded` means **no crossing was detected**, never *no crossing exists*: the
 * crossing predicate is sound but not complete.
 */
export type OristudioCpFold3dVerdict =
  | { verdict: 'folded' }
  | { verdict: 'local_crossing'; vertices: number }
  | { verdict: 'transversal_crossing'; crossings: number }
  | { verdict: 'no_layer_order'; reason: OristudioCpFold3dOrderReason };

/**
 * The kernel's own tolerances.
 *
 * These cross the boundary for exactly one reason: the frontend's BSP builder
 * has its own hardcoded coplanarity epsilon, and a renderer that disagrees with
 * the kernel about which faces share a plane draws a stack the kernel never
 * computed. Nothing here is user-facing and nothing here is settable.
 */
export interface OristudioCpFold3dTolerances {
  angle_radians: number;
  distance_relative: number;
  flat_snap_degrees: number;
  overlap_area_relative: number;
}

/**
 * What the admission gate measured.
 *
 * **Every bar the gate applied is here as its residual, beside the tolerance it
 * was compared against.** The tolerances themselves are the kernel's — the right
 * value depends on computed plane separation nobody outside the kernel has — so
 * the way to hold a figure to a different bar is to re-apply it to these
 * numbers, never to re-run the fold.
 *
 * None of it is user-facing, and none of it may be sent to analytics: these are
 * measurements of the user's own geometry.
 */
export interface OristudioCpFold3dDiagnostics {
  tolerances: OristudioCpFold3dTolerances;
  /** Longer side of the *unfolded* bounding box. */
  span: number;
  /** Creases pulled to an exact full fold in the gate's own copy of the
   *  segments. The user's document is never written back. */
  snapped_creases: number;
  spatial_vertices: number;
  worst_closure_residual_degrees: number;
  /** Worst rotation disagreement over the non-tree dual adjacencies, radians.
   *  Reported for reading; it is not what the gate compares. */
  loop_gap_radians: number;
  /** Worst placement disagreement about where a shared crease lands, relative to
   *  the span — the exact quantity the gate compares against
   *  `tolerances.distance_relative`. */
  loop_gap_offset_relative: number;
  /** How many independent consistency conditions the two above are maxima over.
   *  **Zero means they certify nothing**: the dual graph is a tree and the `0`
   *  is vacuous rather than tight. Read this before reading them. */
  loop_gap_non_tree_edges: number;
  /** The same disagreement localised to elementary per-vertex dual cycles, and
   *  how many there were. */
  worst_vertex_cycle_radians: number;
  vertex_cycles: number;
  /** Up to 16 listed; `local_crossing_count` is exact. */
  local_crossings: Point[];
  local_crossing_count: number;
  /** Parallel-plane separations by decade of span. Reported, never gated. */
  separation_bins: [number, number, number, number, number];
  worst_intra_normal_radians: number;
  worst_intra_offset_relative: number;
  /** `null` means no two distinct planes are parallel at all — a real and
   *  common answer, **not** an infinity. */
  min_inter_separation_relative: number | null;
  /** Always 0 on a placed figure; a non-zero count would have refused. */
  tolerance_alarms: number;
}

export interface OristudioCpFold3dCensus {
  plane_count: number;
  patch_count: number;
  face_count: number;
  /** The ordering-variable count. */
  overlapping_pair_count: number;
  non_adjacent_pair_count: number;
  faces_in_overlap: number;
  full_fold_creases: number;
  /** `overlapping_pair_count >= full_fold_pairs` is a theorem. The converse is
   *  false — a five-panel strip at four 90-degree creases has no full fold and
   *  a census of 1 — and no UI copy may assume it. */
  full_fold_pairs: number;
  min_accepted_area_relative: number | null;
  max_rejected_area_relative: number;
  cell_count: number;
  subface_count: number;
}

export interface OristudioCpFold3dPlaneSummary {
  /** The plane's chosen orientation. Data the payload carries, never something
   *  a consumer re-derives: a different seed gives a different chirality and
   *  reversed stacks that look entirely plausible. */
  up: [number, number, number];
  origin: [number, number, number];
  face_count: number;
  patch_count: number;
  cell_count: number;
  overlap_pairs: number;
  normal_diameter_radians: number;
  offset_diameter: number;
}

/**
 * What one 3D fold produced, minus the geometry.
 *
 * A **sibling** of {@link OristudioCpFoldedFigureSnapshot}, not an extension:
 * that type's `wireframe` is 2D by construction, and `estimation_step` /
 * `display_style` are Oriedita enums the 3D path has no honest value for.
 *
 * Four fields are shared with it by name and meaning — `discovered_fold_cases`,
 * `current_fold_case`, `find_another_overlap_valid` and `has_next_solution` —
 * so the cycling UI derives its one solution verb with the same expression it
 * already uses. `text_result` is deliberately absent.
 */
export interface OristudioCpFolded3dSnapshot {
  schema_version: number;
  model: OristudioCpFoldedFigureModel;
  /** Forward-only high-water mark. Never an eager product over components, so
   *  no "k of N" is expressible and none is offered. */
  discovered_fold_cases: number;
  /** 1-based index of the solution being shown. */
  current_fold_case: number;
  find_another_overlap_valid: boolean;
  /** Alias of {@link find_another_overlap_valid}; one is assigned from the
   *  other, so they cannot disagree. */
  has_next_solution: boolean;
  verdict: OristudioCpFold3dVerdict;
  diagnostics: OristudioCpFold3dDiagnostics;
  census: OristudioCpFold3dCensus;
  planes: OristudioCpFold3dPlaneSummary[];
  /** Ordering-variable count per constraint component, descending. Empty when
   *  the ordering solver did not answer. */
  components: number[];
  undetermined_pairs: number;
  undetermined_cells: number;
  couplings: number;
  /** Up to 16 listed; `crossing_count` is exact. */
  crossings: OristudioCpFold3dCrossing[];
  crossing_count: number;
}

/** `[plane, ring_start, ring_len, facing]` per face. */
export const FOLDED_3D_FACE_ATTR_STRIDE = 4;
/** `[plane, ring_start, ring_len, stack_start, stack_len, determinacy, draw_rank]`. */
export const FOLDED_3D_CELL_ATTR_STRIDE = 7;
/** `up(3), origin(3), u(3), v(3)` per plane. */
export const FOLDED_3D_PLANE_FRAME_STRIDE = 12;
/** `[face_a, face_b, line, kind]` per edge. */
export const FOLDED_3D_EDGE_ATTR_STRIDE = 4;

export const FOLDED_3D_CELL_DETERMINED = 0;
export const FOLDED_3D_CELL_UNDETERMINED = 1;

export const FOLDED_3D_EDGE_BORDER = 0;
export const FOLDED_3D_EDGE_CREASE = 1;
export const FOLDED_3D_EDGE_UNKNOWN = 2;

/**
 * View-independent 3D geometry: no camera, no projection, no colour.
 *
 * Emitted once per fold and once per "another solution" — there is no per-frame
 * way to ask for it. Struct-of-arrays rather than nested per-face objects: on
 * the largest admitted corpus model (2,637 faces) the nested shape serializes
 * to 609 KB of JSON and materializes ~12,000 JS arrays, against 235 KB flat.
 *
 * **Cells, not faces, are the drawable unit.** A cyclic panel order is legal —
 * the classical square twist orders four panels `a > b > c > d > a` — so no
 * per-face scalar "layer" exists. What always exists is a winner per
 * arrangement cell. Every face is drawn by some cell, checked in the kernel;
 * a renderer that fills faces instead is drawing something nothing ordered.
 *
 * Every `*_start` is an index in elements of its own unit (a vertex, a face
 * id), never a byte or float offset.
 */
export interface OristudioCpFolded3dRenderModel {
  schema_version: number;
  span: number;
  face_count: number;
  plane_count: number;
  cell_count: number;
  edge_count: number;
  /** `[x, y, z, ...]` — every face ring, concatenated in face order. */
  ring_points: number[];
  face_attr: number[];
  /** 3 per face — the side the paper's front faces. */
  face_normals: number[];
  plane_frames: number[];
  /** `[x, y, z, ...]` — every cell ring, already lifted to world coordinates. */
  cell_points: number[];
  cell_attr: number[];
  /** Face ids per cell, **top first** with respect to that cell's plane `up`. */
  cell_stack: number[];
  /** 6 per edge: `ax, ay, az, bx, by, bz`. */
  edge_points: number[];
  edge_attr: number[];
  /** Signed fold angle per edge in degrees, `0` on a border. Signed rather than
   *  a mountain/valley code so the payload bakes in no convention. */
  edge_fold_degrees: number[];
  undetermined_cells: number;
}

/**
 * What a 3D fold returned.
 *
 * A refusal is a **result**, not a thrown error: it must not reach the store's
 * catch path, must not raise an error toast and must not destroy the draft
 * figure — mirroring how the flat path already treats a layer-ordering
 * contradiction. A refusal never carries a handle and a placement always does,
 * so the impossible state is unrepresentable rather than guarded.
 */
export type OristudioCpFold3dFoldResult =
  | {
      status: 'placed';
      handle: number;
      snapshot: OristudioCpFolded3dSnapshot;
      render: OristudioCpFolded3dRenderModel;
    }
  | { status: 'refused'; refusal: OristudioCpFold3dRefusal };

export interface OristudioCpFold3dStepResult {
  snapshot: OristudioCpFolded3dSnapshot;
  render: OristudioCpFolded3dRenderModel;
  /** `false` when the stream wrapped back to the first solution. Carried
   *  explicitly rather than inferred from `find_another_overlap_valid`
   *  flipping, which is how the flat path has to do it. */
  advanced: boolean;
}

/**
 * Where a folded figure is in its life.
 *
 * There was a fifth arm, `'unsupported'`, with **zero producers** — nothing in
 * the app ever wrote it, and nothing could: a fold that cannot be computed
 * produces no figure at all rather than an unsupported one. Deleted rather than
 * kept as a promise, so an exhaustive switch over this union is a switch over
 * states that exist. A file carrying the old value still loads: the reader
 * falls back to `'stale'` for anything it does not recognise.
 */
export type OristudioCpFoldedFigureStatus = 'ready' | 'stale' | 'loading' | 'error';

/**
 * Where a folded figure came from.
 *
 * Two of these were folded from the creases the user is editing, and the
 * difference between them is which folder answered — so anything asking "can I
 * refold this from the document?" must ask
 * {@link isFoldedFromCurrentCpSourceKind}, never compare against one arm. Both
 * of the `imported-*` kinds came from a file and have no live creases behind
 * them.
 *
 * `'unknown'` is what a reader writes for a value it does not recognise. It is
 * deliberately **not** coerced to `'generated-from-current-cp'`: that value is
 * the one thing that makes a figure look refoldable, and coercing an unknown
 * kind into it is how a figure written by a newer build gets refolded by the
 * wrong folder in an older one.
 */
export type OristudioCpFoldedFigureSourceKind =
  | 'generated-from-current-cp'
  | 'generated-3d'
  | 'imported-folded-form'
  | 'imported-preserved-frame'
  | 'unknown';

/**
 * Whether a figure of this kind was folded from the document's own creases, and
 * so has creases to drift, to reselect, and to refold from.
 *
 * The one predicate for that question. It exists because there are now two such
 * kinds and every site that compared against `'generated-from-current-cp'`
 * directly would silently exclude every 3D figure — which fails *open*: nothing
 * errors, the figure simply never goes stale, never offers a refold and never
 * becomes the toolbar's fallback.
 */
export function isFoldedFromCurrentCpSourceKind(
  kind: OristudioCpFoldedFigureSourceKind
): boolean {
  return kind === 'generated-from-current-cp' || kind === 'generated-3d';
}

/**
 * Where a folded figure sits on the crease-pattern canvas, in SVG **user**
 * coordinates — the space its render primitives already land in.
 *
 * This is a web-side *display* transform, deliberately separate from the
 * kernel's `OristudioCpFoldedFigureModel.scale` / `.rotation`. Those are folded
 * into the render snapshot at fold time and are only ever seeded from imported
 * Oriedita metadata; going back through the kernel to place a figure would cost
 * an async round-trip per drag frame and would re-anchor the figure to its flat
 * bounds (Oriedita's `fixToFlatBounds`), so a rotate or scale would drag the
 * figure sideways. Placement here is the single thing the canvas gestures touch.
 *
 * Applied about the figure's *local* bbox centre `c0` — the centre of its render
 * snapshot before placement — so scale and rotation both act about the centre
 * the user sees:
 *
 *   p ↦ c0 + offset + R(rotation) · scale · (p − c0)
 *
 * At `scale: 1, rotation: 0` the offset is exactly the legacy `displayOffset`,
 * which is what makes older `.osf` files load without a migration.
 */
export interface FoldedFigurePlacement {
  /** Translation from the figure's folded-at-origin position. */
  offset: Point;
  /** Uniform scale about the displayed centre. A folded form has no meaningful
   *  non-uniform scale, so this is a scalar rather than an x/y pair. */
  scale: number;
  /** Rotation about the displayed centre, radians counter-clockwise. */
  rotation: number;
}

/**
 * Axis-aligned rect in flat crease-pattern coordinates — a port of Oriedita's
 * `Rectangle` as used for a folded figure's source region. Lives here rather
 * than beside the staleness logic so the entry type can name it without the
 * two modules importing each other.
 */
export interface FoldedSourceBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Identity placement: folded where the kernel put it, unscaled, unrotated. */
export const IDENTITY_FOLDED_PLACEMENT: FoldedFigurePlacement = {
  offset: { x: 0, y: 0 },
  scale: 1,
  rotation: 0,
};

export interface OristudioCpFoldedFigureEntry {
  id: string;
  title: string;
  handle: number | null;
  sourceKind: OristudioCpFoldedFigureSourceKind;
  sourceCpRevision: number | null;
  startingFaceId: number | null;
  displayStyle: OristudioCpFoldedFigureDisplayStyle;
  status: OristudioCpFoldedFigureStatus;
  snapshot: OristudioCpFoldedFigureSnapshot | null;
  /**
   * Non-null iff this figure was folded in **3D**, and the one witness the UI
   * branches on. `snapshot` stays null on a 3D figure and this stays null on a
   * flat one; never both.
   *
   * A sibling field rather than a union on `snapshot`, so every existing reader
   * of the flat snapshot keeps its exact type and its exact meaning. Reading it
   * belongs in {@link foldedFigureCycling} and `isFoldedFigureReady`, not at
   * each call site.
   *
   * The geometry is *not* here: the render model is up to ~235 KB of packed
   * arrays and the `.osf` writer pretty-prints, so what persists is this
   * snapshot plus the projected `renderSnapshot`.
   */
  folded3d?: OristudioCpFolded3dSnapshot | null;
  renderSnapshot: OristudioCpFoldedRenderSnapshot | null;
  /** Display placement on the canvas. See {@link FoldedFigurePlacement}. */
  placement: FoldedFigurePlacement;
  /**
   * The viewpoint a **3D** figure's `renderSnapshot` was projected from. Absent
   * on a flat figure, which has no viewpoint, and on files written before this
   * existed.
   *
   * A sibling of {@link placement} rather than part of it: placement moves the
   * finished picture around the canvas and costs nothing, while changing this
   * re-projects the figure from its render model — which a reopened `.osf`
   * does not have. It is persisted anyway, because it says which view the stored
   * picture was taken at.
   *
   * The type lives in `cp-workspace/folded/foldedFigure3dProjection.ts`, which
   * owns its meaning; it is restated structurally here so this module keeps no
   * dependency on the projector.
   */
  camera?: {
    yaw: number;
    pitch: number;
    zoom: number;
    /**
     * The model's own up, if one was set. Row-major.
     *
     * Optional because every figure written before the verb existed has none,
     * and "absent" means identity rather than an error. Spelled out as nine
     * slots rather than `number[]` for the same reason the rest of this record
     * is restated here: it has to stay assignable to the projector's `Mat3`
     * without importing it, and a bare array is not.
     */
    orient?: readonly [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
  } | null;
  /**
   * Half the side of the square frame a 3D figure draws inside, in the local
   * units its primitives land in — `folded3dFrameRadius`, recorded once at fold
   * time.
   *
   * Stored rather than derived because the render model it comes from is
   * deliberately not persisted, and because deriving the frame from the current
   * projection is the bug it exists to fix: those bounds change with every
   * orbit, so the figure's chrome resized and shifted as you turned it. Null on
   * every flat figure, and on a 3D one written before frames existed — both fall
   * back to the projected bounds, which is the old behaviour.
   */
  frameRadius?: number | null;
  /**
   * Bounding box of the creases this figure was folded from, in flat CP
   * coordinates — the provenance record Oriedita keeps (`FoldedFigure_Drawer`'s
   * `boundingBox`). Reselecting from it is how a refold finds its source, and
   * how staleness is decided. Null for a figure folded before this was tracked.
   * See `lib/foldedFigureStaleness.ts`.
   */
  sourceBounds?: FoldedSourceBounds | null;
  /**
   * Digest of the crease set folded, standing in for Oriedita's
   * `LineSegmentSet.contentEquals`. Compared against a fresh reselect to decide
   * whether the figure is out of date.
   */
  sourceFingerprint?: string | null;
  /**
   * The line ids that were folded. Not authoritative — `sourceBounds` is, so a
   * refold picks up creases added inside the region since — but kept for
   * diagnostics and as the seed for the first fingerprint.
   *
   * Foldable-coloured only, because that is what the kernel was handed: the
   * indices a 3D verdict reports are positions in *this* list, which is why
   * `crossingLineIds` reads it and nothing else.
   */
  sourceLineIds?: number[];
  /**
   * The ids the fold was **scoped** to, before the foldable-colour filter.
   *
   * A different question from {@link sourceLineIds} and it has to be stored
   * separately, because neither derives from the other: a region is matched by
   * *every* crease inside it, auxiliary construction lines included, so
   * `resolveInlineSimulationRegion` refuses the filtered list. This is the list
   * "simulate instead" resolves a region from, on the verdict chip exactly as in
   * the refusal dialog. Absent on a figure written before it was tracked, where
   * `sourceLineIds` is the best available stand-in.
   */
  sourceScopedLineIds?: number[];
  error: string | null;
  /**
   * Set when the fold concluded with a global flat-foldability contradiction.
   * The figure is still `ready` and rendered; these two faces are highlighted
   * red on both the folded figure and the flat CP (Oriedita's
   * `drawSelfIntersectingSubFaces`). Cleared when the figure is deleted or
   * re-folded (it lives on the entry, so deletion removes it for free).
   */
  contradiction?: OristudioCpFoldContradiction | null;
}

/** Mirrors the kernel's `model::SnapCandidates`. */
export interface OristudioCpSnapCandidates {
  /** Grid state to search; `'Hidden'` means no grid points. */
  grid: OristudioCpGridState;
  /** Whether crease endpoints and circle centres are candidates. */
  vertices: boolean;
}

export type OristudioCpGridState = 'Hidden' | 'WithinPaper' | 'Full';

export interface OristudioCpCommandPayload {
  /**
   * One-based line ids. Most operations read this as *what to act on*;
   * `PropagateFoldAngles` reads it as **what it may write to**, and takes
   * precedence over `points` there — see `usePropagationDraft`.
   */
  line_ids?: number[];
  line_segments?: OristudioCpLineSegment[];
  circle_ids?: number[];
  text_ids?: number[];
  points?: Point[];
  line_color?: OristudioCpLineColor;
  /**
   * `|ρ|` in degrees for `CreaseSetFoldAngle`, `0..=180`. Not a signed angle —
   * direction lives in the line colour. Omitted means "make classic".
   */
  fold_magnitude_degrees?: number;
  selection_distance?: number;
  /**
   * Model-space tolerance for closing `FlatFoldableCheck`'s boundary loop.
   * Omitted means the kernel's geometric epsilon (1e-6).
   *
   * Deliberately not `selection_distance`: that is a pointer radius the user is
   * free to widen, and this decides whether a loop is a loop. Sharing one field
   * would let the snap radius weld boundaries the drag never joined.
   */
  boundary_close_distance?: number;
  /**
   * What a kernel-side snap may land on. Oriedita gates its close-point search
   * on grid visibility alone; this carries our Snapping toggle as well, so the
   * kernel and the canvas snap by one policy. Omitted means upstream — every
   * vertex, and the grid the document declares.
   */
  snap_candidates?: OristudioCpSnapCandidates;
  replace_selection?: boolean;
  grid_width?: number;
  /** Whether a completion candidate may end on an auxiliary line. */
  stop_on_auxiliary?: boolean;
  angle_system_divider?: number;
  angles?: [number, number, number, number, number, number];
  candidate_index?: number;
  division_count?: number;
  ratio_s?: number;
  ratio_t?: number;
  width?: number;
  custom_from_line_type?: OristudioCpCustomLineType;
  custom_to_line_type?: OristudioCpCustomLineType;
  custom_line_type?: OristudioCpCustomLineType;
  /**
   * Fold angles the user fixed by hand during a propagation draft, as
   * `[one-based line id, signed degrees]` — the same id space as `line_ids`,
   * and the same one `propagation_creases` hands back. Propagation treats these
   * as known and never re-derives them, which is what lets one crease be
   * adjusted and the draft re-run without the answer sliding back.
   *
   * Send back the `line_id` from the preview unchanged. Do not subtract one:
   * the kernel converts, and an id that is off by one names a real, adjacent
   * crease and silently recolours it. `0` is rejected.
   */
  pinned_angles?: [number, number][];
  /**
   * Discard the mountain/valley direction as well when unassigning. Absent or
   * `false` keeps it, because that is the common intent.
   */
  forget_direction?: boolean;
  /**
   * What `CreaseSetDirectionHint` writes to each selected *unassigned* crease.
   * Required by that operation, ignored by every other.
   *
   * `'Clear'` is spelled out rather than sent as an absent field so that
   * "forget the hint" and "the caller forgot to set this" cannot look alike on
   * the wire — the kernel rejects the payload that omits it.
   */
  direction_hint?: OristudioCpFoldDirectionHint | 'Clear';
  /** Largest number of unknowns at a vertex a propagation commit may come from. */
  max_commit_k?: number;
  fix_precision?: number;
  fix_precision_use_bp?: boolean;
  fix_precision_use_22_5?: boolean;
  polygon_corners?: number;
  // --- Ori Studio native ---
  /**
   * Model-space bounding extent for `SquareGenerate`. The frontend owns the unit
   * the user typed (grid cells or paper edges) and converts, as it does for
   * `width`.
   */
  square_extent?: number;
  square_orientation?: OristudioCpSquareOrientationPayload;
  square_anchor?: OristudioCpSquareAnchorPayload;
  custom_circle_color?: OristudioCpRgbColor;
  text_action?: OristudioCpTextCommandAction;
  text_content?: string;
}

/** The kernel's `SquareOrientation`, as serde serializes it. */
export type OristudioCpSquareOrientationPayload = 'Normal' | 'Diagonal';

/** The kernel's `SquareAnchor`, as serde serializes it. */
export type OristudioCpSquareAnchorPayload =
  | 'TopLeft'
  | 'TopCenter'
  | 'TopRight'
  | 'MiddleLeft'
  | 'Center'
  | 'MiddleRight'
  | 'BottomLeft'
  | 'BottomCenter'
  | 'BottomRight';

export type OristudioCpTextCommandAction =
  | 'Create'
  | 'CreateAt'
  | 'Move'
  | 'SetContent'
  | 'DeleteSelected'
  | 'DeleteAt'
  | 'DeleteBox';

export type OristudioCpLineColor =
  | 'Angle'
  | 'None'
  | 'Black0'
  | 'Red1'
  | 'Blue2'
  | 'Cyan3'
  | 'Orange4'
  | 'Magenta5'
  | 'Green6'
  | 'Yellow7'
  | 'Purple8'
  | 'Other9'
  | 'Grey10';

export type OristudioCpCustomLineType =
  | 'Any'
  | 'Edge'
  | 'MountainAndValley'
  | 'Mountain'
  | 'Valley'
  | 'Aux';

export interface OristudioCpDocumentState {
  handle: number;
  /**
   * Monotonic identifier for the genuine document load that produced this
   * state. Stable across edits, undo/redo, and in-place restores; only advances
   * when a fresh kernel handle is allocated for a new load. The CP panel keys
   * its viewport auto-fit on this rather than the kernel handle.
   */
  loadSerial: number;
  document: OristudioCpDocumentSnapshot;
  /**
   * Compact geometry transport for the same kernel state as `document`. This is the
   * hot-path representation: `document` itself is decoded from it (no per-edit
   * `document_snapshot`), and the render builds crease strokes + vertex dots straight
   * from its typed arrays. `null` only for states that predate/omit a fetch (e.g. a
   * test fixture), which fall back to the structured path.
   */
  geometry: CpGeometryTransport | null;
  summary: OristudioCpDocumentSummary;
  source: {
    format: 'cp' | 'fold' | 'ori' | 'orh' | 'osf';
    filename: string;
    path: string | null;
  };
  operationDescriptors: OristudioCpOperationDescriptor[];
  lastCommandResult: OristudioCpCommandResult | null;
}
