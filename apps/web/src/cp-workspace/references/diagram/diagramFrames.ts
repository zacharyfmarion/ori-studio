/**
 * Where a step's geometry is, in whichever space is being drawn.
 *
 * The rules that decide *what* a step draws — which earlier creases, which
 * inputs, where the arrow goes, what the crease itself looks like — are the
 * same rules whether the picture is a 100 px card or the crease pattern itself.
 * What differs is only the coordinates: the card works in the planner's unit
 * square, the view in the document's own model space, where the paper may sit
 * anywhere and at any angle.
 *
 * So the rules take a frame and ask it for points. Two frames, one rule set,
 * and `plannerDiagram.test.ts` runs the same sequence through both and asserts
 * the two primitive lists agree — which is what makes "one description of a
 * step" a checkable claim rather than an aspiration.
 *
 * The frame map is a **similarity** (`crates/oristudio-precrease/src/frame.rs:80`
 * builds an orthonormal basis with determinant −1), so it preserves ratios
 * along a line, angles, and circles. That is why an arrow built in either frame
 * is the image of the arrow built in the other, and why a span's position along
 * its chord can be carried across as a parameter.
 */
import type { Point } from '../../../lib/geometry';
import type { ReferencesPlanModel } from '../referencesPlanGeometry';
import type {
  PrecreaseEdgeSide,
  PrecreasePlanSegment,
  PrecreaseSequence,
  PrecreaseStep,
} from '../precreaseSequence';

export type DiagramSegment = readonly [Point, Point];

export interface DiagramFrame {
  /**
   * The paper's own size, for the things measured against it: an arrowhead, the
   * turn-over glyph, the ring round a mark. In the frame's units.
   */
  sheet: { width: number; height: number };
  /**
   * The paper's middle. Upstream's `CalcArrow` picks the centre of curvature
   * farther from it, so the arrow bulges inward.
   */
  centre: Point;
  /**
   * The paper's outline, or null when the surface draws its own.
   *
   * The card draws the sheet; the canvas already has the document's border
   * creases under everything, and a second rectangle over them would be a
   * second paper.
   */
  outline: readonly DiagramSegment[] | null;
  /** A step's whole chord across the paper. */
  chord(step: PrecreaseStep): DiagramSegment | null;
  /** Where the pinch pass pressed a step, or empty. */
  pinches(step: PrecreaseStep): readonly DiagramSegment[];
  /** Where the pattern wants creases on a step's chord, or empty. */
  creases(step: PrecreaseStep): readonly DiagramSegment[];
  /** A state point by its id. */
  point(id: number): Point | null;
  /** One of the sheet's four edges. */
  edge(side: PrecreaseEdgeSide): DiagramSegment | null;
}

const pair = (s: PrecreasePlanSegment): DiagramSegment => [
  { x: s[0][0], y: s[0][1] },
  { x: s[1][0], y: s[1][1] },
];

function unitEdge(
  sheet: { width: number; height: number },
  side: PrecreaseEdgeSide
): DiagramSegment {
  const { width: w, height: h } = sheet;
  switch (side) {
    case 'left':
      return [
        { x: 0, y: 0 },
        { x: 0, y: h },
      ];
    case 'right':
      return [
        { x: w, y: 0 },
        { x: w, y: h },
      ];
    case 'bottom':
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
      ];
    case 'top':
      return [
        { x: 0, y: h },
        { x: w, y: h },
      ];
  }
}

/**
 * What a frame may be asked to leave out.
 *
 * `showPinches` is a reader's setting: a pinched auxiliary fold is drawn as the
 * short marks it actually leaves, or as the whole chord it was made along. Both
 * frames honour it, or the two pictures would differ on exactly the steps the
 * setting is about.
 */
export interface DiagramFrameOptions {
  showPinches?: boolean;
}

/** The planner's own unit square: the card's frame, and the sequence as given. */
export function unitFrame(
  sequence: PrecreaseSequence,
  options: DiagramFrameOptions = {}
): DiagramFrame {
  const sheet = sequence.sheet;
  const sides: PrecreaseEdgeSide[] = ['left', 'right', 'bottom', 'top'];
  return {
    sheet,
    centre: { x: sheet.width / 2, y: sheet.height / 2 },
    outline: sides.map((side) => unitEdge(sheet, side)),
    chord: (step) => pair(step.segment),
    pinches: (step) =>
      (options.showPinches ?? true) && step.extent.kind === 'pinches'
        ? step.extent.spans.map(pair)
        : [],
    creases: (step) => step.cp_spans.map(pair),
    point: (id) => {
      const found = sequence.points.find((entry) => entry.id === id);
      return found ? { x: found.p[0], y: found.p[1] } : null;
    },
    edge: (side) => unitEdge(sheet, side),
  };
}

/** How far along `[a, b]` the point `p` sits, as a fraction. */
function parameterOf(a: Point, b: Point, p: readonly [number, number]): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const span = dx * dx + dy * dy;
  if (span === 0) return 0;
  return ((p[0] - a.x) * dx + (p[1] - a.y) * dy) / span;
}

const along = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/**
 * The document's own coordinates, as the plan was mapped into them once.
 *
 * Everything but the creased spans arrives already mapped
 * (`referencesPlanGeometry.planModelPoints`, one round trip when the plan
 * lands). The spans are recovered rather than mapped: each endpoint's position
 * along its own chord is a ratio, the frame map preserves ratios along a line,
 * and `Target::new` projects every span endpoint onto that chord before it ever
 * leaves the crate (`crates/oristudio-precrease/src/closure.rs:106`) — so the
 * recovery is exact, not an approximation, and it costs no second round trip.
 */
export function modelFrame(
  sequence: PrecreaseSequence,
  model: ReferencesPlanModel,
  options: DiagramFrameOptions = {}
): DiagramFrame {
  const indexOfStep = new Map(sequence.steps.map((step, i) => [step.id, i]));
  const at = (step: PrecreaseStep) => model.steps[indexOfStep.get(step.id) ?? -1] ?? null;
  const corners = Object.values(model.edges).flatMap((e) => [e.a, e.b]);
  const centre = corners.length
    ? {
        x: corners.reduce((sum, p) => sum + p.x, 0) / corners.length,
        y: corners.reduce((sum, p) => sum + p.y, 0) / corners.length,
      }
    : { x: 0, y: 0 };
  // The paper's size in model units: the frame map is a similarity, so one
  // scale carries the whole sheet.
  const left = model.edges.left;
  const bottom = model.edges.bottom;
  const lengthOf = (e: { a: Point; b: Point } | undefined) =>
    e ? Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) : 0;
  const sheet = {
    width: lengthOf(bottom) || sequence.sheet.width,
    height: lengthOf(left) || sequence.sheet.height,
  };

  return {
    sheet,
    centre,
    // The canvas draws the paper from the document's own border creases.
    outline: null,
    chord: (step) => {
      const geometry = at(step);
      return geometry ? [geometry.segment.a, geometry.segment.b] : null;
    },
    pinches: (step) =>
      (options.showPinches ?? true) && step.extent.kind === 'pinches'
        ? (at(step)?.pinches ?? []).map((span) => [span.a, span.b] as DiagramSegment)
        : [],
    creases: (step) => {
      const geometry = at(step);
      if (!geometry) return [];
      const [a, b] = [geometry.segment.a, geometry.segment.b];
      return step.cp_spans.map(
        (span) =>
          [
            along(a, b, parameterOf(
              { x: step.segment[0][0], y: step.segment[0][1] },
              { x: step.segment[1][0], y: step.segment[1][1] },
              span[0]
            )),
            along(a, b, parameterOf(
              { x: step.segment[0][0], y: step.segment[0][1] },
              { x: step.segment[1][0], y: step.segment[1][1] },
              span[1]
            )),
          ] as DiagramSegment
      );
    },
    point: (id) => {
      const index = sequence.points.findIndex((entry) => entry.id === id);
      return index >= 0 ? (model.points[index] ?? null) : null;
    },
    edge: (side) => {
      const found = model.edges[side];
      return found ? [found.a, found.b] : null;
    },
  };
}
