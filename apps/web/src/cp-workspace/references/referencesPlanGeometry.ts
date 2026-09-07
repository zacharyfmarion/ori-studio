/**
 * The planner's geometry in model space, and what the CP view draws for one
 * step of a breakdown.
 *
 * The planner works in its unit frame; the view draws Oriedita model space.
 * The map between them is the frame's, and it lives in Rust — so this module
 * does two jobs and neither is arithmetic on coordinates: it lays out every
 * point a plan mentions into one flat request (one `rfToModelMany` round trip
 * instead of a few hundred), and it *selects* from the mapped result the
 * ghosts, markers and bounds for the active step.
 *
 * Same shape as `referencesStepGeometry.ts`, which does this for a
 * ReferenceFinder candidate, and it reuses that module's overlay types so the
 * view takes one set of props whichever mode the sidebar is in.
 */
import type { Point } from '../../lib/geometry';
import type {
  ModelBounds,
  ReferencesGhostSegment,
  ReferencesMarker,
  ReferencesStepOverlay,
} from './referencesStepGeometry';
import {
  chosenWitness,
  type PrecreaseEdgeSide,
  type PrecreaseSequence,
} from './precreaseSequence';

/** One step's drawable geometry, model space, parallel to `sequence.steps`. */
export interface ReferencesPlanModelStep {
  /** The new crease as the full chord of the sheet. */
  segment: { a: Point; b: Point };
  /** Short spans around the marks it is consumed at; empty for a full crease. */
  pinches: { a: Point; b: Point }[];
}

/** A plan's geometry in model space. */
export interface ReferencesPlanModel {
  steps: ReferencesPlanModelStep[];
  /** Parallel to `sequence.points`. */
  points: Point[];
  /** The sheet's four edges, indexed by {@link EDGE_ORDER}. */
  edges: Record<PrecreaseEdgeSide, { a: Point; b: Point }>;
  /** Parallel to `sequence.findings`; null where a finding has no segment. */
  findings: ({ a: Point; b: Point } | null)[];
}

/** The order the four sheet edges are laid into the request. */
export const EDGE_ORDER: readonly PrecreaseEdgeSide[] = ['left', 'right', 'bottom', 'top'];

/**
 * Every point of a plan, flattened as `[x, y, …]` in the planner unit frame,
 * for one `rfToModelMany` call. {@link decodePlanModel} reads the answer back
 * in the same order — the two are one contract and are tested together.
 */
export function planModelPoints(sequence: PrecreaseSequence): Float64Array {
  const coords: number[] = [];
  const push = (p: readonly [number, number]) => {
    coords.push(p[0], p[1]);
  };
  for (const step of sequence.steps) {
    push(step.segment[0]);
    push(step.segment[1]);
    if (step.extent.kind === 'pinches') {
      for (const span of step.extent.spans) {
        push(span[0]);
        push(span[1]);
      }
    }
  }
  for (const point of sequence.points) push(point.p);
  const { width: w, height: h } = sequence.sheet;
  const edges: Record<PrecreaseEdgeSide, [[number, number], [number, number]]> = {
    left: [
      [0, 0],
      [0, h],
    ],
    right: [
      [w, 0],
      [w, h],
    ],
    bottom: [
      [0, 0],
      [w, 0],
    ],
    top: [
      [0, h],
      [w, h],
    ],
  };
  for (const side of EDGE_ORDER) {
    push(edges[side][0]);
    push(edges[side][1]);
  }
  for (const finding of sequence.findings) {
    if (!finding.segment) continue;
    push(finding.segment[0]);
    push(finding.segment[1]);
  }
  return Float64Array.from(coords);
}

/** Read {@link planModelPoints}'s answer back into the plan's shape. */
export function decodePlanModel(
  sequence: PrecreaseSequence,
  mapped: Float64Array
): ReferencesPlanModel {
  let cursor = 0;
  const next = (): Point => {
    const point = { x: mapped[cursor], y: mapped[cursor + 1] };
    cursor += 2;
    return point;
  };
  const steps = sequence.steps.map((step): ReferencesPlanModelStep => {
    const segment = { a: next(), b: next() };
    const pinches =
      step.extent.kind === 'pinches'
        ? step.extent.spans.map(() => ({ a: next(), b: next() }))
        : [];
    return { segment, pinches };
  });
  const points = sequence.points.map(() => next());
  const edges = {} as Record<PrecreaseEdgeSide, { a: Point; b: Point }>;
  for (const side of EDGE_ORDER) edges[side] = { a: next(), b: next() };
  const findings = sequence.findings.map((finding) =>
    finding.segment ? { a: next(), b: next() } : null
  );
  return { steps, points, edges, findings };
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

const EMPTY: ReferencesStepOverlay = { ghosts: [], markers: [], bounds: null };

export interface ReferencesPlanOverlay extends ReferencesStepOverlay {
  /** The editor's 1-based crease ids the active step realises. */
  highlightLineIds: number[];
}

export interface ReferencesPlanOverlayOptions {
  /** Draw pinched auxiliary creases as their short spans rather than in full. */
  showPinches?: boolean;
}

/**
 * What the view draws at step `index` (0-based into `sequence.steps`).
 *
 * The fold itself, over the sheet as it stands. Three rules earn their keep:
 *
 * - **An earlier step is ghosted only if it left no crease in the pattern.**
 *   A step that made CP creases is already on the canvas as those creases,
 *   dimmed by the build-up (`referencesCreaseVisibility`), so ghosting it again
 *   drew every crease twice — and drew it as a full chord across the sheet even
 *   when only a pinch was made. Auxiliary steps have no CP crease to stand in
 *   for them, so they keep their ghost.
 * - **A ghost never spans more than was creased.** The parts of a fold that were
 *   never pressed are not on the paper.
 * - **Except on the step being made**, where the rest of the chord is drawn
 *   faintly: the fold does run the width of the sheet, and the instruction is to
 *   bring the references together and press only where the mark is wanted.
 */
export function planStepOverlay(
  sequence: PrecreaseSequence,
  model: ReferencesPlanModel,
  index: number,
  options: ReferencesPlanOverlayOptions = {}
): ReferencesPlanOverlay {
  const step = sequence.steps[index];
  if (!step) return { ...EMPTY, highlightLineIds: [] };
  const showPinches = options.showPinches ?? true;
  const witness = chosenWitness(step);
  const inputLineIds = new Set<number>();
  const inputPointIds = new Set<number>();
  for (const ref of witness?.inputs ?? []) {
    if (ref.kind === 'line' || ref.kind === 'edge') inputLineIds.add(ref.id);
    else inputPointIds.add(ref.id);
  }

  const ghosts: ReferencesGhostSegment[] = [];
  const markers: ReferencesMarker[] = [];
  let bounds: ModelBounds | null = null;

  const drawStep = (at: number, kind: 'folded' | 'input') => {
    const geometry = model.steps[at];
    const earlier = sequence.steps[at];
    if (!geometry || !earlier) return;
    // A step that put creases in the pattern is drawn by the pattern.
    if (kind === 'folded' && earlier.cp_line_ids.length > 0) return;
    const spans =
      showPinches && geometry.pinches.length > 0 ? geometry.pinches : [geometry.segment];
    for (const span of spans) ghosts.push({ a: span.a, b: span.b, kind });
    if (kind === 'input') bounds = extend(extend(bounds, geometry.segment.a), geometry.segment.b);
  };

  for (let i = 0; i < index; i += 1) {
    drawStep(i, inputLineIds.has(sequence.steps[i].line_id) ? 'input' : 'folded');
  }

  // Sheet edges the step names. They are not steps, so they are drawn from the
  // frame's own rectangle rather than from an earlier row.
  for (const ref of witness?.inputs ?? []) {
    if (ref.kind !== 'edge') continue;
    const edge = model.edges[ref.side];
    if (!edge) continue;
    ghosts.push({ a: edge.a, b: edge.b, kind: 'input' });
    bounds = extend(extend(bounds, edge.a), edge.b);
  }

  for (const pointId of inputPointIds) {
    const at = sequence.points.findIndex((entry) => entry.id === pointId);
    const point = at >= 0 ? model.points[at] : undefined;
    if (!point) continue;
    markers.push({ at: point, kind: 'input' });
    bounds = extend(bounds, point);
  }

  const made = model.steps[index];
  if (made) {
    const pinched = showPinches && made.pinches.length > 0;
    if (pinched) {
      ghosts.push({ a: made.segment.a, b: made.segment.b, kind: 'unfolded' });
    }
    const spans = pinched ? made.pinches : [made.segment];
    for (const span of spans) ghosts.push({ a: span.a, b: span.b, kind: 'new' });
    bounds = extend(extend(bounds, made.segment.a), made.segment.b);
  }

  return { ghosts, markers, bounds, highlightLineIds: step.cp_line_ids };
}

/** The model-space bounds of a finding, for click-to-frame in the findings list. */
export function findingBounds(model: ReferencesPlanModel, index: number): ModelBounds | null {
  const segment = model.findings[index];
  if (!segment) return null;
  return extend(extend(null, segment.a), segment.b);
}
