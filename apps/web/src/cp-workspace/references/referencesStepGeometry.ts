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
import type {
  DiagramLineStyleName,
  StepDiagramModel,
  StepDiagramPrimitive,
} from './referenceFinderDiagramToPrimitives';
import { dashRulerAlong, foldAndUnfoldFromArc, type DiagramArc } from './stepDiagramGeometry';
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
  /**
   * ReferenceFinder's own motion arc for this step, in model space.
   *
   * Null for O1 and O4, where nothing is brought onto anything and upstream's
   * diagram draws no arrow either.
   */
  arc?: DiagramArc | null;
}

const EMPTY_OVERLAY: ReferencesStepOverlay = {
  ghosts: [],
  markers: [],
  bounds: null,
  arc: null,
};

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
  // ReferenceFinder's own arrow for this step, carried into model space as
  // three points and refitted — see `ReferencesModelStep.arc`.
  let overlay_arc: DiagramArc | null = null;

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
  if (made?.arc) overlay_arc = made.arc;
  if (made?.line) {
    ghosts.push({ ...made.line, kind: 'new' });
    bounds = extend(extend(bounds, made.line.a), made.line.b);
  }
  if (made?.point) {
    markers.push({ at: made.point, kind: 'new' });
    bounds = extend(bounds, made.point);
  }

  return { ghosts, markers, bounds, arc: overlay_arc };
}

/**
 * A ReferenceFinder step's overlay as diagram primitives.
 *
 * The planner's steps are described as primitives and drawn from them; a
 * candidate's steps arrive as ghosts and markers, from an extractor that
 * predates the shared model. Adapting them here rather than rewriting that
 * extractor keeps one pipe into the canvas without disturbing the search — and
 * it is where the arrows go when ReferenceFinder's own arcs are mapped into
 * model space.
 *
 * The kind → style map is the card's own: an earlier crease is context, an
 * input is picked out, a new crease takes its direction's ink. `unfolded` has
 * no style because the diagram no longer draws the part of a fold the pattern
 * does not crease.
 */
export function referencesStepPrimitives(
  overlay: ReferencesStepOverlay,
  originals: ReferencesOriginals
): StepDiagramModel {
  const sheet = sheetOf(originals);
  const styleOf = (ghost: ReferencesGhostSegment): DiagramLineStyleName | null => {
    if (ghost.kind === 'unfolded') return null;
    if (ghost.kind === 'folded') return 'crease';
    if (ghost.kind === 'input') return 'highlight';
    if (ghost.direction === 'mountain') return 'mountain';
    if (ghost.direction === 'valley') return 'valley';
    return 'crease';
  };
  const primitives: StepDiagramPrimitive[] = [];
  for (const ghost of overlay.ghosts) {
    const style = styleOf(ghost);
    if (!style) continue;
    const ruler = dashRulerAlong(ghost.a.x, ghost.a.y, ghost.b.x, ghost.b.y);
    primitives.push({
      kind: 'line',
      from: [ruler.ax, ruler.ay],
      to: [ruler.bx, ruler.by],
      style,
      dashPhase: ruler.phase,
    });
  }
  // The motion, the same symbol the planner's steps get: out over the crease
  // and back, one head where the paper comes to rest. Upstream ships the
  // outgoing arc and throws its directions away, so the return is derived here
  // exactly as it is for a witness-built arrow — one place decides the symbol.
  if (overlay.arc) {
    const arrow = foldAndUnfoldFromArc(overlay.arc, sheet);
    if (arrow) primitives.push({ kind: 'fold-arrow', ...arrow });
  }
  for (const marker of overlay.markers) {
    primitives.push({
      kind: 'point',
      at: [marker.at.x, marker.at.y],
      style: marker.kind === 'input' ? 'highlight' : 'action',
    });
  }
  return { sheet, primitives };
}

/**
 * The paper's size in model space, from the originals ReferenceFinder was given.
 *
 * Its originals are the sheet's own edges and diagonals, so the longest of them
 * that is not a diagonal is a side — and a side is a side whichever way the
 * paper is turned, which a bounding box would not be. Only the things measured
 * against the paper need this: an arrowhead, the ring round a mark.
 */
function sheetOf(originals: ReferencesOriginals): { width: number; height: number } {
  const lengths = Object.values(originals.lines)
    .map((line) => Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y))
    .sort((a, b) => a - b);
  // A square sheet's diagonal is the longest; the sides are the rest.
  const side = lengths.length > 1 ? lengths[lengths.length - 2] : (lengths[0] ?? 1);
  return { width: side || 1, height: side || 1 };
}
