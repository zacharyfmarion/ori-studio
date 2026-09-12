/**
 * The References workspace's result side table.
 *
 * The store holds *descriptors* — the target, candidate summaries, the run
 * status, which step is active — and this module holds the payloads behind
 * them: the frames analysis for the current revision, and each candidate's
 * extracted construction with its steps already mapped into model space. Kept
 * out of Zustand for the same reason the inline simulations keep their folds
 * out of it: the payloads are large, change wholesale, and nothing needs to
 * re-render on a field inside them. Consumers read through
 * `useSyncExternalStore`.
 *
 * Every entry carries the document revision it was computed for. Consumers
 * compare it to the live revision and treat a mismatch as stale; nothing here
 * is ever recomputed on its own (plan: "never auto-recompute").
 */
import type { Point } from '../../lib/geometry';
import type { DiagramArc } from './stepDiagramGeometry';
import type { ExtractedSolution } from './referenceFinder/extractor';
import type { RawSolution, RfPoint } from './referenceFinder/solution';
import type { PrecreasePlanResult } from './precreasePlan';
import type { PrecreaseSequence } from './precreaseSequence';
import type { ReferencesPlanModel } from './referencesPlanGeometry';
import type { ReferencesAnalysis } from './referencesAnalysis';
import type { PrecreaseFrame, PrecreaseRefusalKind, SheetAnalysis } from './sheetFrames';

/** One step of a candidate in model space, parallel to `ExtractedSolution.steps`. */
export interface ReferencesModelStep {
  /** Line steps: the new crease as the full chord of the sheet. */
  line?: { a: Point; b: Point };
  /** Mark steps: where the two input lines cross. */
  point?: Point;
  /**
   * The motion, in model space: ReferenceFinder's own arc for this step.
   *
   * Carried across as three points on it and refitted, because a circle's
   * centre and angles are not points and no point map moves them — see
   * `stepDiagramGeometry.arcSamplePoints`. Absent for a step whose diagram
   * draws no arrow, which is O1 and O4: nothing is brought onto anything.
   */
  arc?: DiagramArc;
}

/**
 * The sheet's own references in model space, by ReferenceFinder's names —
 * edges `s`/`n`/`w`/`e`, diagonals `sw_ne`/`nw_se`, corners `sw`/`se`/`nw`/`ne`.
 * Steps name them as inputs, and the view needs to draw what is named.
 */
export interface ReferencesOriginals {
  lines: Record<string, { a: Point; b: Point }>;
  marks: Record<string, Point>;
}

export interface ReferencesCandidateResult {
  solution: ExtractedSolution;
  /** The core's answer verbatim, for the sidebar's diagram thumbnails. */
  raw: RawSolution;
  modelSteps: ReferencesModelStep[];
}

export type ReferencesTargetRecord =
  | {
      kind: 'vertex';
      component: number;
      /** Where the vertex is, model space — how the request is keyed. */
      point: Point;
      rf: RfPoint;
    }
  | {
      kind: 'crease';
      component: number;
      /** 1-based id of the picked segment, as the view reports it. */
      lineId: number;
      /** Its endpoints, model space — how the crease is found again after an edit. */
      a: Point;
      b: Point;
      /** 1-based ids of every CP segment on the same merged line. */
      cpLineIds: number[];
      rf: [RfPoint, RfPoint];
    };

export interface ReferencesResults {
  revision: string;
  target: ReferencesTargetRecord;
  frame: PrecreaseFrame;
  originals: ReferencesOriginals;
  candidates: ReferencesCandidateResult[];
  durationMs: number;
}

export interface ReferencesFrames {
  revision: string;
  analysis: SheetAnalysis;
}

/**
 * The pick that is being asked about, published before the query runs.
 *
 * `results` is nulled the moment a query starts and only repopulated when the
 * answer lands — 70 ms on a warm database, a 2-6 s cold build otherwise, and
 * *never* if the query errors or is stopped. Highlights derived only from
 * `results` therefore left the crease the user just clicked unmarked for the
 * whole wait, and permanently on both terminal paths. This is the same record,
 * available from the pick onwards, so the canvas can say what was picked before
 * anything is known about it.
 */
export interface ReferencesPendingTarget {
  revision: string;
  record: ReferencesTargetRecord;
}

/**
 * One presentation order of a plan: the crate's `sequence()` for a given
 * `landmarks_first`, plus its geometry already mapped into model space so the
 * view can draw a step without a round trip.
 */
export interface ReferencesPlanVariant {
  sequence: PrecreaseSequence;
  model: ReferencesPlanModel;
}

/**
 * One planned sheet, in both presentation orders.
 *
 * Both are computed when the plan lands rather than on demand, because
 * `sequence()` is a presentation pass over a closure the planner already has
 * — microseconds — while re-deriving one later would need the planner still
 * alive on that sheet's state. "Landmarks first" is a toggle, and a toggle
 * that needed a Recompute would not be one.
 */
export interface ReferencesPlanComponent {
  component: number;
  /** The run itself: status, findings, approximations, budgets. */
  result: PrecreasePlanResult;
  frame: PrecreaseFrame;
  plain: ReferencesPlanVariant;
  hoisted: ReferencesPlanVariant;
}

/** The order to show, given the toggle. */
export function planVariant(
  component: ReferencesPlanComponent,
  landmarksFirst: boolean
): ReferencesPlanVariant {
  return landmarksFirst ? component.hoisted : component.plain;
}

/**
 * A whole-pattern breakdown.
 *
 * One entry per rectangular sheet, in turn (D10) — a BP Studio canvas can hold
 * several disjoint patterns, and each is its own folding problem. Sheets the
 * planner refuses are listed rather than planned, so the sidebar can say which
 * and why instead of silently covering less than the pattern.
 */
export interface ReferencesPlanRecord {
  revision: string;
  components: ReferencesPlanComponent[];
  refused: { component: number; kind: PrecreaseRefusalKind | null }[];
  durationMs: number;
  /**
   * The "Precrease grid" setting this plan was computed under. The setting
   * changes the plan itself, not its presentation, so a plan is for one value
   * of it the way it is for one revision — and a plan that disagrees with the
   * setting on screen is re-planned, whenever that comes to light.
   */
  precreaseGrid: boolean;
  /** The "Only where needed" setting this plan was computed under, likewise. */
  gridWhereNeeded: boolean;
  /**
   * The worker planner still sitting on this plan's final state, when there is
   * one — what "Starting from: this sequence" scores against. Only a
   * single-sheet plan keeps it: the worker holds one planner at a time, so
   * after several sheets the survivor would be the last one planned rather
   * than the one a target belongs to, and a wrong state is worse than none.
   */
  plannerToken: number | null;
}

/** A CP-wide analysis and the revision it describes. */
export interface ReferencesAnalysisRecord {
  revision: string;
  analysis: ReferencesAnalysis;
}

export interface ReferencesResultsState {
  frames: ReferencesFrames | null;
  results: ReferencesResults | null;
  /** The picked target while there is no answer for it; see {@link ReferencesPendingTarget}. */
  pending: ReferencesPendingTarget | null;
  plan: ReferencesPlanRecord | null;
  analysis: ReferencesAnalysisRecord | null;
}

let state: ReferencesResultsState = {
  frames: null,
  results: null,
  pending: null,
  plan: null,
  analysis: null,
};
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribeReferencesResults(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function referencesResultsSnapshot(): ReferencesResultsState {
  return state;
}

export function setReferencesFrames(frames: ReferencesFrames | null): void {
  if (state.frames === frames) return;
  state = { ...state, frames };
  emit();
}

export function setReferencesResults(results: ReferencesResults | null): void {
  if (state.results === results) return;
  state = { ...state, results };
  emit();
}

export function setReferencesPendingTarget(pending: ReferencesPendingTarget | null): void {
  if (state.pending === pending) return;
  state = { ...state, pending };
  emit();
}

export function setReferencesPlanRecord(plan: ReferencesPlanRecord | null): void {
  if (state.plan === plan) return;
  state = { ...state, plan };
  emit();
}

export function setReferencesAnalysisRecord(analysis: ReferencesAnalysisRecord | null): void {
  if (state.analysis === analysis) return;
  state = { ...state, analysis };
  emit();
}

/** Forget everything — leaving the workspace, or a document swap. */
export function clearReferencesResults(): void {
  if (
    state.frames === null &&
    state.results === null &&
    state.pending === null &&
    state.plan === null &&
    state.analysis === null
  ) {
    return;
  }
  state = { frames: null, results: null, pending: null, plan: null, analysis: null };
  emit();
}
