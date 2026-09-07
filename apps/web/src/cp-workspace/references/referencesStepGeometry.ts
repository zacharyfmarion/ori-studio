/**
 * What the CP view shows for one step of a ReferenceFinder construction.
 *
 * Pure bookkeeping over geometry that already exists in model space (the
 * candidate's steps mapped by the planner bridge, and the sheet's own
 * references): which earlier lines are folded so far, which of them and which
 * marks the active step *uses*, and what it makes. No coordinates are computed
 * here — only selected and grouped — which is what lets it be tested without a
 * worker.
 */
import type { Point } from '../../lib/geometry';
import type { ExtractedSolution, ExtractedStep } from './referenceFinder/extractor';
import type { ReferencesModelStep, ReferencesOriginals } from './referencesResults';

/**
 * How a ghost line reads on the view: `folded` is a crease an earlier step made
 * and this one does not use, `input` is a reference this step folds through or
 * onto, `new` is the crease this step makes, and `unfolded` is the rest of the
 * chord a pinched step does *not* crease.
 *
 * `unfolded` is drawn faintly rather than left out because the fold itself runs
 * the whole width of the paper — the folder brings the two references together
 * across the sheet and presses only where the mark is wanted. Showing the span
 * alone would say "fold this short line", which is not the instruction. It is
 * only ever drawn for the step being made: on a later step the parts that were
 * never creased are not on the paper, so they are not drawn at all.
 */
export type ReferencesGhostKind = 'folded' | 'input' | 'new' | 'unfolded';

/** Which ink a ghost takes when it stands for a crease. */
export type ReferencesGhostDirection = 'mountain' | 'valley' | 'unassigned';

export interface ReferencesGhostSegment {
  a: Point;
  b: Point;
  kind: ReferencesGhostKind;
  /**
   * The crease's own direction, for the `new` and `unfolded` kinds.
   *
   * A crease is drawn in the ink that says which way it folds, never in a
   * colour of its own — that is the one thing the reader is looking for.
   */
  direction?: ReferencesGhostDirection;
}

export type ReferencesMarkerKind = 'input' | 'new';

export interface ReferencesMarker {
  at: Point;
  kind: ReferencesMarkerKind;
}

/** Axis-aligned model-space bounds, for framing the step. */
export interface ModelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ReferencesStepOverlay {
  ghosts: ReferencesGhostSegment[];
  markers: ReferencesMarker[];
  /** The step's new reference and its inputs, or null when nothing is drawn. */
  bounds: ModelBounds | null;
}

const EMPTY_OVERLAY: ReferencesStepOverlay = { ghosts: [], markers: [], bounds: null };

/**
 * Clamp a step index into a solution's range, so a stale `activeStep` (from a
 * candidate with more steps) still names a step rather than nothing.
 */
export function clampStepIndex(solution: ExtractedSolution | null, index: number): number {
  if (!solution || solution.steps.length === 0) return 0;
  return Math.max(0, Math.min(solution.steps.length - 1, Math.trunc(index)));
}

function extend(bounds: ModelBounds | null, point: Point): ModelBounds {
  if (!bounds) return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
  return {
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  };
}

/**
 * The overlay for `activeStep` of a candidate. `modelSteps` is parallel to
 * `solution.steps`; `originals` supplies the sheet's own edges, diagonals and
 * corners when a step names them.
 *
 * Earlier line steps are drawn folded (or as inputs when this step uses them);
 * earlier marks appear only as inputs — a mark that nothing here uses is
 * clutter on a view that already shows the crease pattern. Later steps are not
 * drawn: the view shows the sheet as it stands *before* this fold, plus the
 * fold.
 */
export function referencesStepOverlay(
  solution: ExtractedSolution,
  modelSteps: readonly ReferencesModelStep[],
  originals: ReferencesOriginals,
  activeStep: number
): ReferencesStepOverlay {
  if (solution.steps.length === 0) return EMPTY_OVERLAY;
  const active = clampStepIndex(solution, activeStep);
  const step = solution.steps[active];
  const inputs = new Set(step.inputs);
  const ghosts: ReferencesGhostSegment[] = [];
  const markers: ReferencesMarker[] = [];
  let bounds: ModelBounds | null = null;

  const byLabel = new Map<string, { step: ExtractedStep; model: ReferencesModelStep }>();
  for (let i = 0; i < active; i += 1) {
    const earlier = solution.steps[i];
    const model = modelSteps[i];
    if (!model) continue;
    if (earlier.label) byLabel.set(earlier.label, { step: earlier, model });
    if (model.line) {
      ghosts.push({ ...model.line, kind: inputs.has(earlier.label) ? 'input' : 'folded' });
    }
  }

  for (const label of step.inputs) {
    const earlier = byLabel.get(label);
    if (earlier) {
      if (earlier.model.point) {
        markers.push({ at: earlier.model.point, kind: 'input' });
        bounds = extend(bounds, earlier.model.point);
      } else if (earlier.model.line) {
        bounds = extend(extend(bounds, earlier.model.line.a), earlier.model.line.b);
      }
      continue;
    }
    const line = originals.lines[label];
    if (line) {
      ghosts.push({ ...line, kind: 'input' });
      bounds = extend(extend(bounds, line.a), line.b);
      continue;
    }
    const mark = originals.marks[label];
    if (mark) {
      markers.push({ at: mark, kind: 'input' });
      bounds = extend(bounds, mark);
    }
  }

  const made = modelSteps[active];
  if (made?.line) {
    ghosts.push({ ...made.line, kind: 'new' });
    bounds = extend(extend(bounds, made.line.a), made.line.b);
  }
  if (made?.point) {
    markers.push({ at: made.point, kind: 'new' });
    bounds = extend(bounds, made.point);
  }

  return { ghosts, markers, bounds };
}
