/**
 * The precrease planner's wire shapes, as TypeScript sees them.
 *
 * Mirrors the serde types in `crates/oristudio-precrease/src/sequence.rs`,
 * `predicates.rs`, `pinch.rs`, `planner.rs` and `closure.rs`, serialised
 * `json_compatible` by the wasm bridge: `Option<T>` is `T | null`, `Ref` and
 * `Extent` are `kind`-tagged, every other enum is a `snake_case` string.
 *
 * Nothing is computed here. The planner owns all the geometry (plan decision
 * D6) and this module only names what crosses, so the orchestrator, the
 * sidebar and the diagrams all read one description of the contract instead of
 * three inline `any`s.
 */

/** A line `n · p = d`, `|n| = 1`, in the planner unit frame (= the RF frame). */
export interface PrecreasePlanLine {
  n: [number, number];
  d: number;
}

/** An in-paper segment: two endpoints in the planner unit frame. */
export type PrecreasePlanSegment = [[number, number], [number, number]];

export type PrecreaseEdgeSide = 'left' | 'right' | 'bottom' | 'top';
export type PrecreaseCornerName = 'sw' | 'se' | 'nw' | 'ne';

/** A typed reference into the planner's state, as a step sentence names it. */
export type PrecreaseRef =
  | { kind: 'edge'; id: number; side: PrecreaseEdgeSide }
  | { kind: 'corner'; id: number; corner: PrecreaseCornerName }
  | { kind: 'line'; id: number }
  | { kind: 'point'; id: number };

/** One certified axiom application reproducing a target line. */
export interface PrecreaseWitness {
  /** 1–7. */
  axiom: number;
  /**
   * Inputs in the axiom's own order: O1/O2 `[p, q]`; O3 `[m1, m2]`; O4
   * `[p, m]`; O5 `[pivot, p, m1]`; O6 `[p1, m1, p2, m2]`; O7 `[p, m1, m2]`.
   */
  inputs: PrecreaseRef[];
  root: number;
  who_moves: number[];
  hard: boolean;
  visible: boolean;
  skinny: boolean;
  ease: number;
  err: number;
}

/** How much of a folded line is creased. */
export type PrecreaseExtent =
  | { kind: 'full' }
  | { kind: 'pinches'; spans: PrecreasePlanSegment[] };

/**
 * `cp` realises crease the pattern contains; `aux` is a helper line it does
 * not; `press` is more crease on a line already made — a pinch put on the paper
 * so a later step has a mark to sight. A press is not a fold: the folder refolds
 * a crease that is already there.
 */
export type PrecreaseStepKind = 'cp' | 'aux' | 'press';

/** What a `press` step is for. */
export interface PrecreaseStepPress {
  /** Where on the paper the press is for, in the planner's unit frame. */
  at: [number, number];
  /**
   * The state point being made, when the press is for a mark. A press that
   * carries a line out to where a fold uses it has none.
   */
  point: number | null;
  /**
   * The already-creased line the press is located by — the pinch goes where
   * that crease crosses this step's line. `null` for a press that runs out to
   * a findable end and needs no sighting.
   */
  sighted_from: number | null;
}

/**
 * Which way a crease folds in the finished pattern.
 *
 * `unassigned` is an auxiliary line the pattern says nothing about. There is no
 * "mixed": the crate decides one direction per line, by creased length, because
 * a step that creased part of a line one way and part the other is not a fold
 * anyone can make (plan D20).
 */
export type PrecreaseDirection = 'mountain' | 'valley' | 'unassigned';

/**
 * Which face of the sheet a fold is made from.
 *
 * An alignment fold is a valley on the face you work from, so a mountain is
 * made with the paper turned over. Changes between consecutive steps are where
 * the folder turns it.
 */
export type PrecreaseSide = 'front' | 'back';
export type PrecreaseLineTag = 'edge' | 'cp' | 'aux' | 'rf_aux';

/**
 * Why a plan run ended — the crate's own `drive::StopReason`, mirrored.
 *
 * One vocabulary for both drivers. `budget`, `aborted` and `point_cap` used to
 * exist only here, which is how the same pattern came to stop for different
 * reasons depending on whether the browser or a headless harness ran it.
 */
export type PrecreaseStopReason =
  | 'complete'
  | 'unsolved'
  | 'off_lattice'
  | 'budget'
  | 'aborted'
  | 'refused_sheet'
  | 'point_cap';

/** What the driver just finished doing — the crate's `drive::LastStep`. */
export type PrecreaseLastStep =
  | { kind: 'nothing' }
  | { kind: 'closed'; stalled: boolean }
  | { kind: 'searched'; found: boolean }
  | { kind: 'asked_reference_finder'; folded: boolean };

/** The facts only the driver knows — the crate's `drive::DriverState`. */
export interface PrecreaseDriverState {
  last: PrecreaseLastStep;
  out_of_time: boolean;
  aborted: boolean;
  reference_finder: boolean;
  rf_events: number;
  max_rf_events: number;
}

/** What to do next — the crate's `drive::PlanAction`. */
export type PrecreasePlanAction =
  | { kind: 'close' }
  | { kind: 'stuck_search' }
  | { kind: 'ask_reference_finder' }
  | { kind: 'stop'; reason: PrecreaseStopReason };

/** One fold in the presentation order. */
export interface PrecreaseStep {
  /** 1-based position in the presentation order. */
  id: number;
  kind: PrecreaseStepKind;
  tag: PrecreaseLineTag;
  line: PrecreasePlanLine;
  /** State line id — what `{ kind: 'line', id }` in a witness points at. */
  line_id: number;
  segment: PrecreasePlanSegment;
  extent: PrecreaseExtent;
  witnesses: PrecreaseWitness[];
  /** Index of the presentation witness in `witnesses`. */
  chosen: number | null;
  ease: number;
  hard: boolean;
  err: number;
  /** Which way this crease is made. Resolved — never two directions. */
  direction: PrecreaseDirection;
  /**
   * The share of this line's creased length `direction` gets right, in `[0, 1]`.
   * Below 1 the line reverses in part when the model collapses; `0` when
   * `direction` is `unassigned`.
   */
  direction_share: number;
  /** The face of the sheet this fold is made from. */
  side: PrecreaseSide;
  /** For an auxiliary step, the ids of the CP steps it unlocks. */
  unlocks: number[];
  /** The editor's 1-based crease ids this step realises. */
  cp_line_ids: number[];
  /**
   * Where those creases sit on the fold's chord, parallel to `cp_line_ids`.
   *
   * The fold crosses the whole sheet; the pattern usually wants only part of
   * it, and a diagram that draws the full chord tells the folder to crease more
   * than the pattern asks. Empty for an auxiliary step, whose own `extent`
   * already says how much is pressed.
   */
  cp_spans: PrecreasePlanSegment[];
  /** An auxiliary crease that stays full-length after the pinch pass. */
  visible: boolean;
  witnesses_complete: boolean;
  /**
   * Everything this step is sighted from is on the paper: every mark it names,
   * and some overlap for each crease it lines up with a crease.
   *
   * A fold runs the width of the sheet, but the pattern usually wants only part
   * of it — so the crossing of two *chords* need not be a crease crossing, and
   * a crease that stops at the fold has nothing across it to land on. When this
   * is false the fold is still right, but the folder has to be told what is
   * missing rather than shown where it already is.
   */
  marks_exist: boolean;
  /**
   * Where the marks this step sights but cannot find actually are, in the
   * planner's unit frame. Never non-empty when `marks_exist`; empty when it is
   * false and the marks are there but no crease lines up.
   *
   * `marks_exist` alone says the step is unperformable and leaves nothing to do
   * about it; these are the coordinates to hand ReferenceFinder for a
   * construction, so the plan can gain the fold that puts the mark on the paper.
   */
  missing_marks: [number, number][];
  /** Present exactly when `kind` is `press`. */
  press?: PrecreaseStepPress;
  /**
   * The shortest stretch over which this step lines a crease up with a crease,
   * in the planner's unit frame; absent when it lines up none. Below
   * `SHORT_ALIGNMENT` the fold can be made but not precisely — a fold 0.02
   * from the sheet's edge lines up 0.04 of edge whatever is pressed — and the
   * card says to take care.
   */
  alignment?: number;
  hoisted: boolean;
}

/**
 * The alignment the planner treats as a pinch's worth: `MIN_ALIGNMENT` in
 * `crates/oristudio-precrease/src/marks.rs`, twice its pinch half-length.
 */
export const SHORT_ALIGNMENT = 0.06;

/** Consecutive steps of one side, direction, axiom and input pattern. */
export interface PrecreaseGroup {
  kind: PrecreaseStepKind;
  /** A group never spans a turn-over. */
  side: PrecreaseSide;
  /** Normal angle of the direction cluster, radians in `[0, π)`. */
  direction_angle: number;
  axiom: number;
  /** `"O2:cp"`-style pattern: axiom and input kinds, `!` when hard. */
  pattern: string;
  step_ids: number[];
  count: number;
}

/** The summary strip's counts. Never "minimum" — the search is bounded. */
export interface PrecreaseTotals {
  folds: number;
  cp_lines: number;
  aux: number;
  visible_aux: number;
  /**
   * Press steps: extra crease the pattern does not contain, made so a later
   * step can be sighted. Apart from `aux` so "what the design asks for" and
   * "what correctness cost" never blur. Absent from plans older than this.
   */
  presses?: number;
  /** The exact lower bound within the flat-sheet model. */
  lower_bound: number;
  free_lines: number;
  unsolved: number;
}

export type PrecreaseStatus =
  | 'complete'
  | 'partial_unsolved'
  | 'partial_off_lattice'
  | 'refused_sheet'
  | 'invalid_input';

export type PrecreaseFindingReason = 'unsolved' | 'off_lattice';

export interface PrecreaseFactsSummary {
  points_on: number;
  perpendiculars: number;
  o2_pairs: number;
  o3_pairs: number;
  landers: number;
  landers_computed: boolean;
}

/** A CP line the plan does not fold. */
export interface PrecreaseFinding {
  line: PrecreasePlanLine;
  segment: PrecreasePlanSegment | null;
  cp_line_ids: number[];
  reason: PrecreaseFindingReason;
  facts: PrecreaseFactsSummary;
}

export interface PrecreasePointEntry {
  id: number;
  p: [number, number];
  lines: number[];
  on_boundary: boolean;
}

export interface PrecreaseLineEntry {
  id: number;
  tag: PrecreaseLineTag;
  /** The step that folds it; null for a sheet edge. */
  step: number | null;
}

export type PrecreaseExactnessClass = 'exact' | 'snappable' | 'off_lattice';

/** What the exactness policy did (plan decision D8). */
export interface PrecreaseExactnessSummary {
  class: PrecreaseExactnessClass;
  family: string | null;
  max_displacement_unit: number;
  max_displacement_model: number;
  off_lattice_lines: number;
  off_lattice_vertices: number;
}

export interface PrecreaseClosureStats {
  rounds: number;
  tier1_sweeps: number;
  tier2_sweeps: number;
  target_evaluations: number;
}

export interface PrecreaseDiagnostics {
  closure: PrecreaseClosureStats;
  stuck_events: number;
  candidates_evaluated: number;
  closures_run: number;
  points: number;
  lines: number;
  elapsed_ms: number;
  budget_hit: boolean;
  point_cap_hit: boolean;
  max_depth_searched: number;
  search_exhausted: boolean;
  witnesses_incomplete_steps: number;
  rf_lines_folded: number;
}

export interface PrecreaseSheet {
  width: number;
  height: number;
}

/** The whole plan, as `PrecreasePlanner.sequence()` returns it. */
export interface PrecreaseSequence {
  status: PrecreaseStatus;
  /** `"best_found_to_depth_<d>"` or `"heuristic"`; never a claimed minimum. */
  certification: string;
  sheet: PrecreaseSheet;
  landmarks_first: boolean;
  steps: PrecreaseStep[];
  groups: PrecreaseGroup[];
  totals: PrecreaseTotals;
  findings: PrecreaseFinding[];
  points: PrecreasePointEntry[];
  lines: PrecreaseLineEntry[];
  exactness: PrecreaseExactnessSummary | null;
  diagnostics: PrecreaseDiagnostics;
}

/** `PrecreasePlanner.info()`. */
export interface PrecreasePlannerInfo {
  component: number;
  status: PrecreaseStatus;
  sheet: PrecreaseSheet | null;
  exactness: PrecreaseExactnessSummary | null;
  refused: boolean;
  off_lattice: boolean;
  targets: number;
  free_targets: number;
  remaining: number;
  point_cap: number;
}

/** `PrecreasePlanner.close()`. */
export interface PrecreaseCloseReport {
  folded: number;
  remaining: number;
  /** The fixpoint was reached without hitting the deadline. */
  exhausted: boolean;
  fixpoint: boolean;
  budget_hit: boolean;
}

/** `PrecreasePlanner.stuck_search()`, when it finds something. */
export interface PrecreaseStuckSummary {
  aux: PrecreasePlanLine[];
  aux_folds: number;
  visible_aux: number;
  unlocked: number;
  ease_sum: number;
  depth_reached: number;
  exhausted: boolean;
  complete: boolean;
  root_candidates: number;
  candidates_evaluated: number;
  closures_run: number;
}

/** One entry of `PrecreasePlanner.fold()`. */
export type PrecreaseFoldOutcome =
  | { kind: 'folded'; line_id: number; cp_target: number | null }
  | { kind: 'already_folded'; line_id: number }
  | { kind: 'not_constructible' }
  | { kind: 'off_sheet' };

/** `PrecreasePlanner.explain()`. */
export interface PrecreaseExplanation {
  line: PrecreasePlanLine;
  folded: boolean;
  line_id: number | null;
  tag: PrecreaseLineTag | null;
  round: number | null;
  is_target: boolean;
  remaining: boolean;
  cp_line_ids: number[];
  witnesses: PrecreaseWitness[];
  chosen: number | null;
  facts: PrecreaseFactsSummary;
}

/** Optional planner knobs; the bridge takes them as a JSON string. */
export interface PrecreasePlannerOptions {
  point_cap?: number;
  max_depth?: number;
  depth3_threshold?: number;
  max_candidates?: number;
  stuck_budget_ms?: number;
  total_budget_ms?: number;
}

/** Values per remaining line in `remaining()`: `nx, ny, d, ax, ay, bx, by`. */
export const PRECREASE_REMAINING_STRIDE = 7;

/** `fold(lines, tags)`'s tag codes. */
export const PRECREASE_TAG = { cp: 0, aux: 1, rfAux: 2 } as const;

/** The chosen witness of a step, or null when it has none (a free line). */
export function chosenWitness(step: PrecreaseStep): PrecreaseWitness | null {
  if (step.chosen === null) return null;
  return step.witnesses[step.chosen] ?? null;
}

/** Unpack `remaining()`'s flat array into one entry per line. */
export function decodeRemaining(
  values: Float64Array
): { line: PrecreasePlanLine; segment: PrecreasePlanSegment }[] {
  const out: { line: PrecreasePlanLine; segment: PrecreasePlanSegment }[] = [];
  for (let i = 0; i + PRECREASE_REMAINING_STRIDE <= values.length; i += PRECREASE_REMAINING_STRIDE) {
    out.push({
      line: { n: [values[i], values[i + 1]], d: values[i + 2] },
      segment: [
        [values[i + 3], values[i + 4]],
        [values[i + 5], values[i + 6]],
      ],
    });
  }
  return out;
}

/** Pack `[nx, ny, d]` triples for `score()` / `fold()` / `to_rf()`. */
export function encodeLines(lines: readonly PrecreasePlanLine[]): Float64Array {
  const out = new Float64Array(lines.length * 3);
  lines.forEach((line, i) => {
    out[i * 3] = line.n[0];
    out[i * 3 + 1] = line.n[1];
    out[i * 3 + 2] = line.d;
  });
  return out;
}

/** Unpack `from_rf()`'s `[nx, ny, d]` triples. */
export function decodeLines(values: Float64Array): PrecreasePlanLine[] {
  const out: PrecreasePlanLine[] = [];
  for (let i = 0; i + 3 <= values.length; i += 3) {
    out.push({ n: [values[i], values[i + 1]], d: values[i + 2] });
  }
  return out;
}
