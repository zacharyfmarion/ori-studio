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
import { modelFrame } from './diagram/diagramFrames';
import { plannerStepDiagram, plannerTurnOverDiagram } from './diagram/plannerDiagram';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import type {
  ModelBounds,
} from './referencesStepGeometry';
import {
  type PrecreaseEdgeSide,
  type PrecreaseSequence,
} from './precreaseSequence';

/** One step's drawable geometry, model space, parallel to `sequence.steps`. */
export interface ReferencesPlanModelStep {
  /** The new crease as the full chord of the sheet. */
  segment: { a: Point; b: Point };
  /** Short spans around the marks it is consumed at; empty for a full crease. */
  pinches: { a: Point; b: Point }[];
  /** Crease made past the pattern's own, for a later step to line up against. */
  pressedOn: { a: Point; b: Point }[];
  /**
   * Every line of a grid step's family, parallel to `step.grid.lines`; empty
   * for any other step. A grid line is creased edge to edge, so its whole
   * segment is what the view draws.
   */
  gridLines: { a: Point; b: Point }[];
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
    for (const span of step.pressed_on) {
      push(span[0]);
      push(span[1]);
    }
    for (const line of step.grid?.lines ?? []) {
      push(line.segment[0]);
      push(line.segment[1]);
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
    const pressedOn = step.pressed_on.map(() => ({ a: next(), b: next() }));
    const gridLines = (step.grid?.lines ?? []).map(() => ({ a: next(), b: next() }));
    return { segment, pinches, pressedOn, gridLines };
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

/**
 * A step of a plan as the view draws it: the same primitives the filmstrip card
 * is built from, in the document's own coordinates.
 *
 * This used to be a second rule set — ghosts and markers, decided here — and by
 * the time the two were compared they had drifted in six places, the loudest
 * being whether the un-creased rest of a fold's chord is drawn at all. There is
 * one rule set now (`diagram/plannerDiagram.ts`) and two frames; this is the
 * model frame's caller.
 */
export interface ReferencesPlanScene {
  /** The step's primitives in model space, or null when the index names no step. */
  diagram: StepDiagramModel | null;
  /** The active step's own chord, for framing a finding. */
  bounds: ModelBounds | null;
  /** The editor's 1-based crease ids the active step realises. */
  highlightLineIds: number[];
}

export function planStepScene(
  sequence: PrecreaseSequence,
  model: ReferencesPlanModel,
  index: number,
  twin?: number
): ReferencesPlanScene {
  const step = sequence.steps[index];
  if (!step) return { diagram: null, bounds: null, highlightLineIds: [] };
  const twinStep = twin === undefined ? undefined : sequence.steps[twin];
  // The canvas has the document's own creases under this, held to the steps
  // folded so far by `referencesCreaseVisibility` — so the step draws only what
  // the pattern cannot: its own crease, which is not folded yet, and the
  // pinches and auxiliary folds no crease pattern records.
  const diagram = plannerStepDiagram(sequence, modelFrame(sequence, model), index, {
    earlier: 'unpatterned',
    twin,
  });
  const geometry = model.steps[index];
  const twinGeometry = twin === undefined ? undefined : model.steps[twin];
  // A grid step's own chord is its family's first line; the step is the
  // family. A twin card frames both folds.
  const spans = [
    ...(geometry ? [geometry.segment, ...geometry.gridLines] : []),
    ...(twinGeometry ? [twinGeometry.segment] : []),
  ];
  const bounds = spans.reduce<ModelBounds | null>(
    (box, span) => extend(extend(box, span.a), span.b),
    null
  );
  return {
    diagram,
    bounds,
    highlightLineIds: [...step.cp_line_ids, ...(twinStep?.cp_line_ids ?? [])],
  };
}

/**
 * The turn-over card, on the pattern: the symbol that says to flip the
 * sheet, over the build-up so far.
 *
 * The build-up itself is the pattern's own creases, held to the steps folded
 * so far by `referencesCreaseVisibility` in the document's own ink, as on a
 * fold card — so this draws only what the pattern cannot: the pinches and
 * auxiliary folds no crease pattern records, and the symbol. The canvas
 * once drew the creases greyed under the symbol to match the card exactly
 * (Zach, 2026-09-16); now that the sheet turns over on the canvas, the ink
 * has to be the pattern's, so the face that comes up shows the assignment
 * reversed the way a fold card's flap does (Zach, later the same day: "still
 * render the front and back like in the normal steps").
 *
 * `after` is the last planner step folded by this point, or null before the
 * first fold. No bounds: the sheet as a whole is the picture.
 */
export function planTurnOverScene(
  sequence: PrecreaseSequence,
  model: ReferencesPlanModel,
  after: number | null
): ReferencesPlanScene {
  return {
    diagram: plannerTurnOverDiagram(sequence, modelFrame(sequence, model), after, {
      earlier: 'unpatterned',
    }),
    bounds: null,
    highlightLineIds: [],
  };
}

/** The model-space bounds of a finding, for click-to-frame in the findings list. */
export function findingBounds(model: ReferencesPlanModel, index: number): ModelBounds | null {
  const segment = model.findings[index];
  if (!segment) return null;
  return extend(extend(null, segment.a), segment.b);
}
