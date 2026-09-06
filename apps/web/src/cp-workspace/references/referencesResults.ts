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
import type { ExtractedSolution } from './referenceFinder/extractor';
import type { RawSolution, RfPoint } from './referenceFinder/solution';
import type { PrecreaseFrame, SheetAnalysis } from './sheetFrames';

/** One step of a candidate in model space, parallel to `ExtractedSolution.steps`. */
export interface ReferencesModelStep {
  /** Line steps: the new crease as the full chord of the sheet. */
  line?: { a: Point; b: Point };
  /** Mark steps: where the two input lines cross. */
  point?: Point;
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

export interface ReferencesResultsState {
  frames: ReferencesFrames | null;
  results: ReferencesResults | null;
}

let state: ReferencesResultsState = { frames: null, results: null };
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

/** Forget everything — leaving the workspace, or a document swap. */
export function clearReferencesResults(): void {
  if (state.frames === null && state.results === null) return;
  state = { frames: null, results: null };
  emit();
}
