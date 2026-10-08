/**
 * What a press on the Annotate canvas lands on: an end of the selected
 * annotation, or an annotation's body — the topmost, as drawn — in picture
 * units; and in Edit Path, a node, a handle or the curve of the selected
 * fold arrow.
 *
 * Pure: no DOM, no store.
 */
import {
  isKnownAnnotation,
  type DiagramAnnotation,
  type DiagramAnnotationKind,
  type DiagramPathNode,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import {
  DIAGRAM_ANGLE_MARK_INK,
  DIAGRAM_ARROWHEAD_INK,
  DIAGRAM_DIVISIONS_INK,
  DIAGRAM_FOLD_RETURN_INK,
  DIAGRAM_LINE_INK,
  DIAGRAM_MARK_INK,
  DIAGRAM_PLEAT_INK,
  DIAGRAM_PUSH_INK,
  DIAGRAM_RIGHT_ANGLE_INK,
  DIAGRAM_WHITE_ARROW_INK,
} from '../../cp-workspace/references/diagram/diagramInk';
import {
  angleMarkArcPoints,
  angleMarkShape,
  arcPolyline,
  arrowheadAt,
  arrowheadExtent,
  arrowheadReach,
  backToRing,
  arcThroughPoints,
  divisionsShape,
  divisionsStrokes,
  outlineDistance,
  pathArrowGeometry,
  pleatArrowShape,
  pushArrowOutline,
  returnStroke,
  rightAngleShape,
  whiteArrowOutline,
  type AngleMarkShape,
  type DivisionsShape,
  type PleatArrowShape,
  type RightAngleShape,
  type SvgPoint,
} from '../../cp-workspace/references/stepDiagramGeometry';
import { flattenPath } from '../../lib/cubicBezier';
import {
  DEFAULT_PLEAT_KINKS,
  DEFAULT_WHITE_ARROW,
  LINE_KINDS,
  annotationEnds,
  arrowApex,
  arrowShape,
  calloutDrawnBox,
  calloutShape,
  closeUpShape,
  divisionsOffsetOf,
  divisionsPartsOf,
  isCornerKind,
  rightAngleDiagonal,
  labelCentre,
  labelHalfWidth,
  labelSize,
  pathCubics,
  pathLength,
  type PicturePoint,
} from './annotationModel';
import { nearestPathPoint, pathNodesOf, visiblePathHandles } from './annotationPath';
import { ANNOTATION_INK_MM } from './canvasInk';
import { perAnnotation } from './perAnnotation';
import { TEXT_HALO_EMS } from './textStyle';
import { zoomGripAt, type ZoomGrip } from '../zoom/zoomGrips';
import { distanceToRim, zoomOutlineOf } from '../zoom/zoomModel';

/**
 * Which part of an annotation a press took hold of: its body, or one end; a
 * callout's box; in Edit Path a node of an arrow's path, one of a node's two
 * handles, or the segment between two nodes (and where along it, `t` in
 * [0, 1], {@link hitPathGrip}); and a right angle's corner or the direction
 * it opens in, which the selected right angle offers in place of ends
 * ({@link rightAngleGrips}); and one of a close-up's two circles, taken
 * anywhere inside to move it, or by its ring to resize it (15f); and the
 * handle at the middle of equal divisions' line, which sets how far off the
 * line they measure it stands, as a drag of the mark does (Revision 2); and
 * a selected enlarge area's centre, rim, corners or edges (`zoomGrips.ts`).
 */
export type AnnotationGripPart =
  | { part: 'body' }
  | { part: 'from' }
  | { part: 'to' }
  | { part: 'box' }
  | { part: 'node'; node: number }
  | { part: 'handle'; node: number; side: 'in' | 'out' }
  | { part: 'segment'; segment: number; t: number }
  | { part: 'corner' }
  | { part: 'direction' }
  | { part: 'circle'; end: 'from' | 'to' }
  | { part: 'ring'; end: 'from' | 'to' }
  | { part: 'offset' }
  | { part: 'zoom'; zoom: ZoomGrip };

/** What a press took hold of: the annotation, and which part of it. */
export type AnnotationGrip = { annotationId: string } & AnnotationGripPart;

/** The parts of a fold arrow Edit Path takes hold of. */
export type PathGripPart = Extract<AnnotationGripPart, { part: 'node' | 'handle' | 'segment' }>;

/** How near a press must be, in picture units: the ink's reach and a finger's. */
export interface HitSizes {
  /** How far from a line, an arc or an end a press still takes it. */
  tolerance: number;
  /** A glyph's reach from its centre: the turn-over and rotate signs. */
  glyph: number;
  /** A label's letters' size, where it has none of its own in pt (17b). */
  label: number;
  /** One ink, as the canvas draws it: what a head's length and a push's width are measured in. */
  ink: number;
  /** A callout's outline's pen, as the canvas draws it: outside its box, and all of it taken. */
  calloutPen: number;
}

/** How many straight pieces an arrow's arc is measured and washed along. */
const ARROW_SAMPLES = 24;

/** How far a shaped arrow's runs may stand off its curve, in picture units: a hair at any zoom a press is made at. */
const PATH_TOLERANCE = 2e-4;

/**
 * The points along an arrow, from its tail to its tip — its arc, or the
 * curve it was shaped along: worked out once per annotation object, as a
 * drag's every step asks for the one in hand and a press for them all.
 */
export const arrowPolyline = perAnnotation((annotation): PicturePoint[] => {
  const shape = arrowShape(annotation);
  if (shape.kind === 'arc') return sampleArrow(annotation, shape.bend, ARROW_SAMPLES);
  return flattenPath(pathCubics(shape.path), PATH_TOLERANCE).map(([x, y]): PicturePoint => [x, y]);
});

function sampleArrow(annotation: KnownDiagramAnnotation, bend: number, samples: number): PicturePoint[] {
  const { from, to } = annotation;
  const apex = arrowApex(from, to, bend);
  // The circle through the three points, swept from `from` through `apex` to `to`.
  const [ax, ay] = from;
  const [bx, by] = apex;
  const [cx, cy] = to;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return [from, to];
  const sa = ax * ax + ay * ay;
  const sb = bx * bx + by * by;
  const sc = cx * cx + cy * cy;
  const ux = (sa * (by - cy) + sb * (cy - ay) + sc * (ay - by)) / d;
  const uy = (sa * (cx - bx) + sb * (ax - cx) + sc * (bx - ax)) / d;
  const radius = Math.hypot(ax - ux, ay - uy);
  const angle = (point: PicturePoint) => Math.atan2(point[1] - uy, point[0] - ux);
  const start = angle(from);
  const wrap = (value: number) => ((value % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const through = wrap(angle(apex) - start);
  const end = wrap(angle(to) - start);
  // The sweep that passes the apex: increasing angle when the apex comes before the end.
  const sweep = through < end ? end : end - 2 * Math.PI;
  return Array.from({ length: samples + 1 }, (_, index) => {
    const at = start + (sweep * index) / samples;
    return [ux + radius * Math.cos(at), uy + radius * Math.sin(at)] as PicturePoint;
  });
}

function distanceToSegment([px, py]: PicturePoint, [ax, ay]: PicturePoint, [bx, by]: PicturePoint): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanceToPolyline(point: PicturePoint, line: readonly PicturePoint[]): number {
  let best = Infinity;
  for (let index = 1; index < line.length; index += 1) {
    best = Math.min(best, distanceToSegment(point, line[index - 1]!, line[index]!));
  }
  return best;
}

/** The y-up space References' arcs are built in, and back: picture units, y flipped. */
const up = ([u, v]: PicturePoint): [number, number] => [u, -v];
const down = ([x, y]: readonly [number, number]): PicturePoint => [x, -y];

/** A head's length: the drawing's, but never more than a share of the arrow's chord (`inkUpToChord`). */
function headLength(chord: number, ink: number): number {
  return Math.min(DIAGRAM_ARROWHEAD_INK.length * ink, DIAGRAM_ARROWHEAD_INK.ofChord * chord);
}

/**
 * How far a press is from a fold arrow as it is drawn: its arc, a
 * fold-and-unfold arrow's return stroke beside it, and the head at the end of
 * whichever carries it — a one-way arrow's stopped on the ring of a circle
 * it lands in (`marks`, the circles' centres), as it is drawn there.
 */
function arrowDistance(
  annotation: KnownDiagramAnnotation,
  point: PicturePoint,
  ink: number,
  marks: readonly PicturePoint[]
): number {
  const shape = arrowShape(annotation);
  if (shape.kind === 'path') return pathArrowDistance(annotation, shape.path, point, ink, marks);
  const { from, to } = annotation;
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const outgoing = arrowPolyline(annotation);
  let distance = distanceToPolyline(point, outgoing);
  let carrier: readonly PicturePoint[] = outgoing;
  let tip = annotation.kind === 'fold-unfold-arrow' ? to : landedTip(outgoing, marks, circleRadius(ink));
  if (annotation.kind === 'fold-unfold-arrow') {
    const out = arcThroughPoints(up(from), up(arrowApex(from, to, shape.bend)), up(to));
    const offset = Math.min(DIAGRAM_FOLD_RETURN_INK.offset * ink, DIAGRAM_FOLD_RETURN_INK.ofChord * chord);
    const back = out ? returnStroke(out, offset) : null;
    if (back) {
      const returning = arcPolyline(back).map(down);
      distance = Math.min(distance, distanceToPolyline(point, returning));
      carrier = returning;
      tip = returning[returning.length - 1]!;
    }
  }
  return Math.min(distance, headDistance(point, tip, headingInto(carrier, tip), headLength(chord, ink)));
}

/**
 * How far a press is from a head `length` long whose tip is at `tip`,
 * pointing along `direction`: 0 inside its outline — a mountain's wider
 * barb on either side (`arrowheadExtent`) — the distance to it outside. The
 * head lies behind its tip, along the stroke: an arrow landing on a ring
 * keeps off it.
 */
function headDistance(point: PicturePoint, tip: PicturePoint, direction: PicturePoint, length: number): number {
  const reach = arrowheadReach(length);
  const head = arrowheadAt(
    { x: tip[0] - direction[0] * reach, y: tip[1] - direction[1] * reach },
    { x: direction[0], y: direction[1] },
    length
  );
  const [tipAt, notch, barbA, barbB] = arrowheadExtent(head).map(({ x, y }): PicturePoint => [x, y]);
  const outline = [tipAt!, barbA!, notch!, barbB!];
  if (insidePolygon(point, outline)) return 0;
  return distanceToPolyline(point, [...outline, outline[0]!]);
}

/**
 * The way a stroke runs where `tip` lies on it — its end, or where it was
 * stopped short of its end on a ring: the run nearest the tip, the last of
 * any that tie.
 */
function headingInto(stroke: readonly PicturePoint[], tip: PicturePoint): PicturePoint {
  let best: PicturePoint = [1, 0];
  let nearest = Infinity;
  for (let i = 1; i < stroke.length; i += 1) {
    const [a, b] = [stroke[i - 1]!, stroke[i]!];
    const run = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(run > 0)) continue;
    const d = distanceToSegment(tip, a, b);
    if (d <= nearest + 1e-12) {
      nearest = d;
      best = [(b[0] - a[0]) / run, (b[1] - a[1]) / run];
    }
  }
  return best;
}

/**
 * A shaped arrow's return and head as a press finds them, by the drawing's
 * own geometry (`pathArrowGeometry`) in picture units, at the ink a press is
 * measured in: worked out once per annotation and ink.
 */
const pathArrowReach = perAnnotation(
  () => new Map<string, { back: PicturePoint[]; tip: PicturePoint; direction: PicturePoint; head: number } | null>()
);

function unitFrom(a: { x: number; y: number }, b: { x: number; y: number }): PicturePoint {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  return d > 0 ? [(b.x - a.x) / d, (b.y - a.y) / d] : [1, 0];
}

function pathArrowAt(
  annotation: KnownDiagramAnnotation,
  path: readonly DiagramPathNode[],
  ink: number,
  marks: readonly PicturePoint[]
) {
  const byInk = pathArrowReach(annotation);
  const key = `${ink}|${marks.map(([x, y]) => `${x},${y}`).join(';')}`;
  const known = byInk.get(key);
  if (known !== undefined) return known;
  const fold = annotation.kind === 'fold-unfold-arrow' ? 'fold-unfold' : 'valley';
  const geometry = pathArrowGeometry(
    pathCubics(path),
    fold,
    (length) => ({ head: headLength(length, ink), offset: returnOffset(length, ink), rim: circleRadius(ink) }),
    marks.map(([x, y]) => ({ x, y })),
    PATH_TOLERANCE,
    // A return shaped by hand, where it is drawn.
    annotation.kind === 'fold-unfold-arrow' && annotation.back ? pathCubics(annotation.back) : undefined
  );
  const found = geometry && {
    back: (geometry.back ?? []).map(([x, y]): PicturePoint => [x, y]),
    tip: [geometry.head.tip.x, geometry.head.tip.y] as PicturePoint,
    // The way it points: notch to tip.
    direction: unitFrom(geometry.head.notch, geometry.head.tip),
    head: headLength(pathLength(path), ink),
  };
  byInk.set(key, found);
  return found;
}

/**
 * Where a one-way arc arrow's tip is drawn: its end, or where it stands on
 * the ring of a circle its end lies in (`foldArrowLanding`), along its
 * outgoing polyline.
 */
function landedTip(outgoing: readonly PicturePoint[], marks: readonly PicturePoint[], rim: number): PicturePoint {
  const end = outgoing[outgoing.length - 1]!;
  const mark = marks.find((each) => Math.hypot(each[0] - end[0], each[1] - end[1]) <= rim);
  if (!mark || outgoing.length < 2) return end;
  const back = (by: number): PicturePoint => {
    let left = by;
    for (let i = outgoing.length - 1; i > 0; i -= 1) {
      const [a, b] = [outgoing[i]!, outgoing[i - 1]!];
      const run = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (left <= run && run > 0) return [a[0] + ((b[0] - a[0]) * left) / run, a[1] + ((b[1] - a[1]) * left) / run];
      left -= run;
    }
    return outgoing[0]!;
  };
  const length = outgoing.reduce((sum, at, i) => (i === 0 ? 0 : sum + Math.hypot(at[0] - outgoing[i - 1]![0], at[1] - outgoing[i - 1]![1])), 0);
  const by = backToRing(back, mark, rim, rim, length);
  return by === null ? end : back(by);
}

/**
 * How far a press is from a shaped arrow as it is drawn: its path, a
 * fold-and-unfold arrow's return beside it, and its head — sized by the
 * path's length, as the drawing sizes it.
 */
function pathArrowDistance(
  annotation: KnownDiagramAnnotation,
  path: readonly DiagramPathNode[],
  point: PicturePoint,
  ink: number,
  marks: readonly PicturePoint[]
): number {
  const distance = distanceToPolyline(point, arrowPolyline(annotation));
  const drawn = pathArrowAt(annotation, path, ink, marks);
  if (!drawn) return distance;
  const back = drawn.back.length > 1 ? distanceToPolyline(point, drawn.back) : Infinity;
  return Math.min(distance, back, headDistance(point, drawn.tip, drawn.direction, drawn.head));
}

/** How far a fold-and-unfold arrow's return opens: the drawing's, capped by a share of the arrow (`foldReturnOffset`). */
function returnOffset(span: number, ink: number): number {
  return Math.min(DIAGRAM_FOLD_RETURN_INK.offset * ink, DIAGRAM_FOLD_RETURN_INK.ofChord * span);
}

/** How far a press is from a push arrow's hollow outline: 0 inside it. */
function pushDistance(annotation: KnownDiagramAnnotation, point: PicturePoint, ink: number): number {
  const outline = pushArrowOutline(
    { x: annotation.from[0], y: annotation.from[1] },
    { x: annotation.to[0], y: annotation.to[1] },
    {
      head: DIAGRAM_PUSH_INK.head * ink,
      headHalf: DIAGRAM_PUSH_INK.headHalf * ink,
      shaftHalf: DIAGRAM_PUSH_INK.shaftHalf * ink,
      cleft: DIAGRAM_PUSH_INK.cleft * ink,
    }
  );
  if (!outline) return distanceToSegment(point, annotation.from, annotation.to);
  const ring = outline.map(({ x, y }): PicturePoint => [x, y]);
  if (insidePolygon(point, ring)) return 0;
  return distanceToPolyline(point, [...ring, ring[0]!]);
}

/**
 * A pleat arrow as the canvas draws it, in picture units: its bolt and its
 * head at the size its ink gives them (`pleatArrowShape`), the head capped by
 * its chord as a fold arrow's is. Null for one whose ends meet.
 */
export function pleatArrowInPicture(
  annotation: Pick<KnownDiagramAnnotation, 'from' | 'to' | 'kinks' | 'mirrored'>,
  ink: number
): PleatArrowShape | null {
  const { from, to } = annotation;
  return pleatArrowShape(
    { x: from[0], y: from[1] },
    { x: to[0], y: to[1] },
    annotation.kinks ?? DEFAULT_PLEAT_KINKS,
    annotation.mirrored === true,
    {
      step: DIAGRAM_PLEAT_INK.step * ink,
      back: DIAGRAM_PLEAT_INK.back * ink,
      gap: DIAGRAM_PLEAT_INK.gap * ink,
      head: DIAGRAM_ARROWHEAD_INK.length * ink,
    },
    headLength(Math.hypot(to[0] - from[0], to[1] - from[1]), ink)
  );
}

/** How far a press is from a pleat arrow as it is drawn: its bolt, and 0 inside its head. */
function pleatArrowDistance(annotation: KnownDiagramAnnotation, point: PicturePoint, ink: number): number {
  const shape = pleatArrowInPicture(annotation, ink);
  if (!shape) return Math.hypot(point[0] - annotation.from[0], point[1] - annotation.from[1]);
  const [tip, notch, barbA, barbB] = arrowheadExtent(shape.head).map(({ x, y }): PicturePoint => [x, y]);
  const outline = [tip!, barbA!, notch!, barbB!];
  const head = insidePolygon(point, outline) ? 0 : distanceToPolyline(point, [...outline, outline[0]!]);
  const shaft = shape.shaft?.map(({ x, y }): PicturePoint => [x, y]);
  return shaft ? Math.min(head, distanceToPolyline(point, shaft)) : head;
}

/**
 * A white arrow's outline in picture units, at the ink a press is measured
 * in, as the drawing shapes it (`whiteArrowOutline`): worked out once per
 * annotation and ink. Null for a path of no length.
 */
const whiteArrowOutlines = perAnnotation(() => new Map<number, PicturePoint[] | null>());

function whiteArrowOutlineAt(annotation: KnownDiagramAnnotation, ink: number): PicturePoint[] | null {
  const byInk = whiteArrowOutlines(annotation);
  const known = byInk.get(ink);
  if (known !== undefined) return known;
  const size = DIAGRAM_WHITE_ARROW_INK[annotation.width ?? DEFAULT_WHITE_ARROW.width];
  const outline = whiteArrowOutline(
    pathCubics(arrowPathNodes(annotation)),
    { neck: size.neck * ink, headLength: size.headLength * ink, headWidth: size.headWidth * ink },
    annotation.tail ?? DEFAULT_WHITE_ARROW.tail,
    PATH_TOLERANCE
  );
  const found = outline && outline.map(([x, y]): PicturePoint => [x, y]);
  byInk.set(ink, found);
  return found;
}

/** A white arrow's path: its own, or the straight one it was laid as. */
function arrowPathNodes(annotation: KnownDiagramAnnotation): readonly DiagramPathNode[] {
  return annotation.path ?? [{ at: annotation.from }, { at: annotation.to }];
}

/**
 * How far a press is from a white arrow as it is drawn: 0 inside its hollow
 * outline, which a press takes as the push's is — its curve's hollow side
 * too — and the distance to its edge outside (`outlineDistance`).
 */
function whiteArrowDistance(annotation: KnownDiagramAnnotation, point: PicturePoint, ink: number): number {
  const outline = whiteArrowOutlineAt(annotation, ink);
  return outline ? outlineDistance(outline, point) : distanceToPolyline(point, arrowPolyline(annotation));
}

/** Whether a point is inside a simple polygon (even–odd). */
function insidePolygon([x, y]: PicturePoint, ring: readonly PicturePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * A circle's ring in picture units, at the ink a press is measured in: the
 * radius References rings a point at (`DIAGRAM_MARK_INK`), as it is drawn.
 */
export function circleRadius(ink: number): number {
  return DIAGRAM_MARK_INK.radius * ink;
}

/** How far a press is from a box, in picture units: 0 inside it. */
function boxDistance([x, y]: PicturePoint, box: { x: number; y: number; width: number; height: number }): number {
  const dx = Math.max(box.x - x, 0, x - (box.x + box.width));
  const dy = Math.max(box.y - y, 0, y - (box.y + box.height));
  return Math.hypot(dx, dy);
}

/**
 * How far a press is from a callout's box — 0 on it, its words included,
 * which are inside it, and on its outline out to the ink's outer edge, its
 * pen `pen` drawn outside it — and from its line, as they are drawn.
 */
function calloutDistances(
  annotation: KnownDiagramAnnotation,
  point: PicturePoint,
  pen: number
): { box: number; line: number } {
  const { box, line } = calloutShape(annotation);
  // The stroke's middle half a pen out, its outer edge a whole one.
  const inked = calloutDrawnBox(box, 2 * pen);
  return { box: boxDistance(point, inked), line: line ? distanceToSegment(point, line[0], line[1]) : Infinity };
}

/**
 * A right-angle mark as the canvas draws it, in picture units, at the ink a
 * press is measured in (`rightAngleShape`, sized as `rightAngleDrawn` sizes
 * it): its ∟ and its square, set into the angle off its vertex.
 */
export function rightAngleInPicture(
  annotation: Pick<KnownDiagramAnnotation, 'from' | 'to'>,
  ink: number
): RightAngleShape {
  const [dx, dy] = rightAngleDiagonal(annotation);
  const { inset, side, leg } = DIAGRAM_RIGHT_ANGLE_INK;
  return rightAngleShape({ x: annotation.from[0], y: annotation.from[1] }, { x: dx, y: dy }, {
    inset: inset * ink,
    side: side * ink,
    leg: leg * ink,
  });
}

/**
 * Where the selected right angle is taken hold of: the vertex it marks,
 * which moves it whole, and its square's far corner, which turns the way it
 * opens.
 */
export function rightAngleGrips(
  annotation: Pick<KnownDiagramAnnotation, 'from' | 'to'>,
  ink: number
): { corner: PicturePoint; direction: PicturePoint } {
  const far = rightAngleInPicture(annotation, ink).square[1];
  return { corner: annotation.from, direction: [far.x, far.y] };
}

/**
 * How far a press is from a right-angle mark: 0 in its square, else the
 * distance to its strokes — and none at all nearer the vertex than its ∟'s
 * corner. That gap is the lines' that meet there: at a finger's reach a mark
 * would otherwise take a press meant for their ends, as marks are hit first.
 */
function rightAngleDistance(annotation: KnownDiagramAnnotation, point: PicturePoint, ink: number): number {
  const { legs, square } = rightAngleInPicture(annotation, ink);
  const inner = legs[1];
  const fromVertex = Math.hypot(point[0] - annotation.from[0], point[1] - annotation.from[1]);
  if (fromVertex < Math.hypot(point[0] - inner.x, point[1] - inner.y)) return Infinity;
  const tuple = ({ x, y }: SvgPoint): PicturePoint => [x, y];
  if (insidePolygon(point, [inner, ...square].map(tuple))) return 0;
  return Math.min(distanceToPolyline(point, legs.map(tuple)), distanceToPolyline(point, square.map(tuple)));
}

/**
 * An angle mark as the canvas draws it, in picture units: its arc and its
 * ticks at the size its ink gives them (`angleMarkShape`). Null for one with
 * no angle.
 */
export function angleMarkInPicture(
  annotation: Pick<KnownDiagramAnnotation, 'from' | 'to' | 'other' | 'ticks'>,
  ink: number
): AngleMarkShape | null {
  if (!annotation.other) return null;
  const point = ([x, y]: readonly [number, number]) => ({ x, y });
  return angleMarkShape(point(annotation.from), point(annotation.to), point(annotation.other), annotation.ticks ?? 1, {
    radius: DIAGRAM_ANGLE_MARK_INK.radius * ink,
    tick: DIAGRAM_ANGLE_MARK_INK.tick * ink,
    spacing: DIAGRAM_ANGLE_MARK_INK.spacing * ink,
  });
}

/**
 * How far a press is from an angle mark: 0 in the wedge its arc closes — its
 * whole place, as a right angle's square is — else the distance to its arc
 * and its ticks.
 */
function angleMarkDistance(annotation: KnownDiagramAnnotation, point: PicturePoint, ink: number): number {
  const shape = angleMarkInPicture(annotation, ink);
  if (!shape) return Infinity;
  const dx = point[0] - shape.centre.x;
  const dy = point[1] - shape.centre.y;
  if (Math.hypot(dx, dy) <= shape.radius) {
    // Its angle from the first arm, the way the arc sweeps.
    const turn = 2 * Math.PI;
    const angle = (((Math.atan2(dy, dx) - shape.start) * Math.sign(shape.sweep)) % turn + turn) % turn;
    if (angle <= Math.abs(shape.sweep)) return 0;
  }
  const arc = angleMarkArcPoints(shape).map(({ x, y }): PicturePoint => [x, y]);
  const ticks = shape.ticks.map(([a, b]) => distanceToSegment(point, [a.x, a.y], [b.x, b.y]));
  return Math.min(distanceToPolyline(point, arc), ...ticks);
}

/** What of equal divisions says where they are drawn: their line, and how they look. */
type DivisionsFields = Pick<KnownDiagramAnnotation, 'from' | 'to' | 'parts' | 'offset' | 'mirrored' | 'ticks' | 'numbered' | 'shortDividers'>;

/**
 * Equal divisions as the canvas draws them, in picture units, at the ink a
 * press is measured in (`divisionsShape`, sized as `divisionsDrawn` sizes
 * it): their offset, a print length in mm, in that ink; a crowded part's
 * spacing held to two of a ring's pens at the table's arrow pen, near enough
 * for a press. Null for a line whose ends meet.
 */
export function divisionsInPicture(annotation: DivisionsFields, ink: number): DivisionsShape | null {
  const point = ([x, y]: readonly [number, number]) => ({ x, y });
  const sizes = DIAGRAM_DIVISIONS_INK;
  const ringPen = DIAGRAM_MARK_INK.ofArrow * DIAGRAM_LINE_INK.arrow.width * ink;
  return divisionsShape(
    point(annotation.from),
    point(annotation.to),
    {
      parts: divisionsPartsOf(annotation),
      ticks: annotation.ticks ?? 1,
      mirrored: annotation.mirrored === true,
      numbered: annotation.numbered === true,
      shortDividers: annotation.shortDividers === true,
    },
    {
      offset: (divisionsOffsetOf(annotation) / ANNOTATION_INK_MM) * ink,
      overshoot: sizes.overshoot * ink,
      tick: sizes.tick * ink,
      spacing: sizes.spacing * ink,
      tickFloor: sizes.tickFloor * ink,
      spacingFloor: sizes.spacingFloor * ringPen,
      lean: (sizes.leanDeg * Math.PI) / 180,
      number: sizes.number * ink,
      gap: sizes.gap * ink,
    }
  );
}

/** Where the selected equal divisions' line is taken hold of to set its offset: its middle. */
export function divisionsOffsetGrip(annotation: DivisionsFields, ink: number): PicturePoint {
  const shape = divisionsInPicture(annotation, ink);
  if (!shape) return [annotation.from[0], annotation.from[1]];
  const [a, b] = shape.line;
  return [(a.x + b.x) / 2, (a.y + b.y) / 2];
}

/**
 * How far a press is from equal divisions as they are drawn: their line, the
 * dividers and the ticks, and 0 on the count's box. Never the line they
 * measure, which is the picture's.
 */
function divisionsDistance(annotation: KnownDiagramAnnotation, point: PicturePoint, ink: number): number {
  const shape = divisionsInPicture(annotation, ink);
  if (!shape) return Infinity;
  const strokes = divisionsStrokes(shape).map(([a, b]) => distanceToSegment(point, [a.x, a.y], [b.x, b.y]));
  const number = shape.number
    ? boxDistance(point, {
        x: shape.number.at.x - shape.number.halfWidth,
        y: shape.number.at.y - shape.number.halfHeight,
        width: 2 * shape.number.halfWidth,
        height: 2 * shape.number.halfHeight,
      })
    : Infinity;
  return Math.min(number, ...strokes);
}

/**
 * How far a press is from a close-up's two circles — 0 inside either: each
 * is a place of its own, the area's or the close-up's — and from the line
 * between them (15f).
 */
function closeUpDistances(
  annotation: KnownDiagramAnnotation,
  point: PicturePoint
): { area: number; inset: number; line: number } {
  const { area, inset, line } = closeUpShape(annotation);
  const disc = ({ centre, radius }: { centre: PicturePoint; radius: number }) =>
    Math.max(0, Math.hypot(point[0] - centre[0], point[1] - centre[1]) - radius);
  return { area: disc(area), inset: disc(inset), line: line ? distanceToSegment(point, line[0], line[1]) : Infinity };
}

/**
 * What of a selected close-up a press takes hold of before anything drawn
 * over it (15f): a ring, within `tolerance` of its pen's middle, to resize
 * what it is round, or the dot at a circle's centre, to move it — the dots
 * the selection shows, so an area whose inside is all marks can still be
 * moved. The nearest; the ring where a small circle's ring and dot are as
 * near, and the close-up's where its grips and its area's are. Null off them.
 */
function closeUpGripAt(
  annotation: KnownDiagramAnnotation,
  point: PicturePoint,
  tolerance: number
): Extract<AnnotationGripPart, { part: 'ring' | 'circle' }> | null {
  const { area, inset } = closeUpShape(annotation);
  let best: { grip: Extract<AnnotationGripPart, { part: 'ring' | 'circle' }>; distance: number } | null = null;
  for (const [end, { centre, radius }] of [['to', inset], ['from', area]] as const) {
    const away = Math.hypot(point[0] - centre[0], point[1] - centre[1]);
    for (const [part, distance] of [['ring', Math.abs(away - radius)], ['circle', away]] as const) {
      if (distance <= tolerance && (best === null || distance < best.distance)) best = { grip: { part, end }, distance };
    }
  }
  return best?.grip ?? null;
}

/**
 * Where a label's words are on the canvas, in picture units (17b): their
 * centre — hung text's off its anchor — and half their box, at the label's
 * size (`plain` when it has none in pt) and weight, a halo's half width past
 * its letters. The one box a press, the selection's ring and the reach agree on.
 */
export function labelBox(
  annotation: Pick<KnownDiagramAnnotation, 'from' | 'offsetPt' | 'text' | 'bold' | 'halo' | 'sizePt'>,
  plain: number
): { centre: PicturePoint; halfWidth: number; halfHeight: number; size: number } {
  const size = annotation.sizePt !== undefined ? labelSize(annotation) : plain;
  const halo = annotation.halo ? (TEXT_HALO_EMS * size) / 2 : 0;
  return {
    centre: labelCentre(annotation),
    halfWidth: labelHalfWidth(annotation.text ?? '', { bold: annotation.bold === true, size }) + halo,
    halfHeight: size * 0.6 + halo,
    size,
  };
}

/**
 * How far a press is from an annotation's body, as it is drawn; 0 inside a
 * glyph, a label, a push, a white arrow or a callout's box. A circle is its
 * ring, not its inside: an arrow drawn into it ends inside it, and a press
 * there is the arrow's. Every kind is measured as it is drawn (a
 * switch, so a new kind is a compile error here until it is).
 */
function bodyDistance(
  annotation: KnownDiagramAnnotation,
  point: PicturePoint,
  sizes: HitSizes,
  marks: readonly PicturePoint[]
): number {
  switch (annotation.kind) {
    case 'label': {
      // Round its words' centre, at its size and weight, its halo too (17b): hung text's words, not its anchor.
      const { halfWidth, halfHeight, centre } = labelBox(annotation, sizes.label);
      const dx = Math.max(0, Math.abs(point[0] - centre[0]) - halfWidth);
      const dy = Math.max(0, Math.abs(point[1] - centre[1]) - halfHeight);
      return Math.hypot(dx, dy);
    }
    case 'turn-over':
    case 'rotate':
      return Math.max(0, Math.hypot(point[0] - annotation.from[0], point[1] - annotation.from[1]) - sizes.glyph);
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow':
      return arrowDistance(annotation, point, sizes.ink, marks);
    case 'push-arrow':
      return pushDistance(annotation, point, sizes.ink);
    case 'pleat-arrow':
      return pleatArrowDistance(annotation, point, sizes.ink);
    case 'white-arrow':
      return whiteArrowDistance(annotation, point, sizes.ink);
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
    case 'solid-line':
      return distanceToSegment(point, annotation.from, annotation.to);
    case 'circle':
      return Math.abs(Math.hypot(point[0] - annotation.from[0], point[1] - annotation.from[1]) - circleRadius(sizes.ink));
    case 'right-angle':
      return rightAngleDistance(annotation, point, sizes.ink);
    case 'angle-mark':
      return angleMarkDistance(annotation, point, sizes.ink);
    case 'divisions':
      return divisionsDistance(annotation, point, sizes.ink);
    case 'callout': {
      const { box, line } = calloutDistances(annotation, point, sizes.calloutPen);
      return Math.min(box, line);
    }
    case 'close-up': {
      const { area, inset, line } = closeUpDistances(annotation, point);
      return Math.min(area, inset, line);
    }
    case 'zoom':
      // Its outline, not its inside: the marks drawn inside it are pressed there.
      return distanceToRim(zoomOutlineOf(annotation), point);
  }
}

/**
 * What a press at `point` takes hold of: an end of the selected annotation
 * first — the dots it shows (`annotationEnds`) — then the topmost annotation
 * whose body is within reach: a callout by its box, which moves alone, or
 * its line, which moves the whole; a label by its words, and by its halo or
 * the margin round them only where nothing under it is within reach. Null
 * for empty paper.
 */
/** The marks filled with the page inside their outline: they hide what was drawn under them. */
const HOLLOW_KINDS: ReadonlySet<DiagramAnnotationKind> = new Set(['push-arrow', 'white-arrow']);

/**
 * The lines drawn in the diagram's pens, under every mark. A solid line is a
 * line to every other question, but it is drawn in References' pen among the
 * marks, in the order they were added (17a), so it is pressed there too.
 */
const underMarks = (kind: DiagramAnnotationKind) => LINE_KINDS.has(kind) && kind !== 'solid-line';

export function hitAnnotation(
  annotations: readonly DiagramAnnotation[],
  point: PicturePoint,
  sizes: HitSizes,
  selectedId: string | null
): AnnotationGrip | null {
  const known = annotations.filter(isKnownAnnotation);
  const selected = known.find((annotation) => annotation.id === selectedId);
  if (selected?.kind === 'close-up') {
    // A ring resizes what it is round, a centre's dot moves its circle.
    const grip = closeUpGripAt(selected, point, sizes.tolerance);
    if (grip) return { annotationId: selected.id, ...grip };
  } else if (selected?.kind === 'zoom') {
    // An enlarge area's grips (Revision 2): its centre's dot moves it; a circle's rim, a rectangle's corners and edges resize it.
    const grip = zoomGripAt(zoomOutlineOf(selected), point, sizes.tolerance);
    if (grip) return { annotationId: selected.id, part: 'zoom', zoom: grip };
  } else if (selected && isCornerKind(selected.kind)) {
    // A right angle's corner, and the way it opens: no ends.
    const grips = rightAngleGrips(selected, sizes.ink);
    const near = (['direction', 'corner'] as const)
      .map((part) => ({ part, distance: Math.hypot(point[0] - grips[part][0], point[1] - grips[part][1]) }))
      .filter(({ distance }) => distance <= sizes.tolerance)
      .sort((a, b) => a.distance - b.distance);
    if (near[0]) return { annotationId: selected.id, part: near[0].part };
  } else if (selected) {
    // The ends it shows, and equal divisions' handle at the middle of their line.
    const handle = selected.kind === 'divisions' ? divisionsOffsetGrip(selected, sizes.ink) : null;
    const grips: { part: 'from' | 'to' | 'offset'; at: PicturePoint }[] = [
      ...annotationEnds(selected).map((part) => ({ part, at: selected[part] })),
      ...(handle ? [{ part: 'offset' as const, at: handle }] : []),
    ];
    const near = grips
      .map(({ part, at }) => ({ part, distance: Math.hypot(point[0] - at[0], point[1] - at[1]) }))
      .filter(({ distance }) => distance <= sizes.tolerance)
      .sort((a, b) => a.distance - b.distance);
    if (near[0]) return { annotationId: selected.id, part: near[0].part };
  }
  // An arrow that lands in a circle is drawn stopped on its ring: its head is pressed there.
  const marks = known.filter((annotation) => annotation.kind === 'circle').map(({ from }) => from);
  // Topmost first, as they are drawn: labels over callouts over marks — a
  // solid line among them — over the pens' lines over close-ups, whose
  // insides are painted under everything, over
  // enlarge areas — and
  // a circle over the other marks, its ring the one place to take it, where
  // an arrow that lands on it has the rest of its length; but not where a
  // hollow arrow drawn after it hides it.
  const last = new Set(['circle', 'callout', 'label']);
  const under = new Set<DiagramAnnotationKind>(['zoom', 'close-up']);
  const drawn = [
    // An enlarge area under everything, as a close-up's insides are: it marks an area, and what is inside it stays pressable.
    ...known.filter((annotation) => annotation.kind === 'zoom'),
    ...known.filter((annotation) => annotation.kind === 'close-up'),
    ...known.filter((annotation) => underMarks(annotation.kind)),
    ...known.filter(
      (annotation) => !underMarks(annotation.kind) && !last.has(annotation.kind) && !under.has(annotation.kind)
    ),
    ...known.filter((annotation) => annotation.kind === 'circle'),
    ...known.filter((annotation) => annotation.kind === 'callout'),
    ...known.filter((annotation) => annotation.kind === 'label'),
  ];
  // A label pressed on its halo or the margin round it, not its words: taken only when nothing under it is (17d
  // review). A pulled letter hangs beside its ring, its halo over the ring's near rim, which is the ring's to take.
  let margin: AnnotationGrip | null = null;
  for (let index = drawn.length - 1; index >= 0; index -= 1) {
    const annotation = drawn[index]!;
    if (bodyDistance(annotation, point, sizes, marks) > sizes.tolerance) continue;
    if (annotation.kind === 'label' && annotation.id !== selectedId && bodyDistance({ ...annotation, halo: undefined }, point, sizes, marks) > 0) {
      margin ??= { annotationId: annotation.id, part: 'body' };
      continue;
    }
    if (annotation.kind === 'circle' && annotation.id !== selectedId) {
      // A hollow arrow drawn after a circle is filled with the page over it:
      // where it covers the press, the circle is hidden, and the press goes
      // on to what is drawn there — the arrow, or a mark over it. Not once
      // it is selected: its ring is then drawn over everything, the grip
      // that moves it out from under.
      const hidden = known
        .slice(known.indexOf(annotation) + 1)
        .some((other) => HOLLOW_KINDS.has(other.kind) && bodyDistance(other, point, sizes, marks) === 0);
      if (hidden) continue;
    }
    if (annotation.kind === 'close-up') {
      // Either circle is taken on its own, the close-up over its area where
      // they overlap; the line between them takes the whole.
      const { area, inset } = closeUpDistances(annotation, point);
      if (inset <= sizes.tolerance) return { annotationId: annotation.id, part: 'circle', end: 'to' };
      if (area <= sizes.tolerance) return { annotationId: annotation.id, part: 'circle', end: 'from' };
      return { annotationId: annotation.id, part: 'body' };
    }
    // A callout's box is taken on its own; its line takes the whole.
    const onBox = annotation.kind === 'callout' && calloutDistances(annotation, point, sizes.calloutPen).box <= sizes.tolerance;
    return { annotationId: annotation.id, part: onBox ? 'box' : 'body' };
  }
  return margin;
}

/**
 * What a press takes hold of on a fold arrow in Edit Path: a handle it shows
 * with `selectedNode` or a node — whichever is nearest, a handle on a tie,
 * so one drawn over its node can still be pulled out — then the curve, at
 * the segment and `t` nearest the press. All within `reach`, a grip's
 * screen size in picture units. An arc is held by the nodes it would have
 * (`pathNodesOf`). Null off them, and for a kind that is not shaped.
 */
export function hitPathGrip(
  annotation: KnownDiagramAnnotation,
  point: PicturePoint,
  reach: number,
  selectedNode: number | null
): PathGripPart | null {
  const nodes = pathNodesOf(annotation);
  if (!nodes) return null;
  let best: { grip: PathGripPart; distance: number } | null = null;
  const consider = (grip: PathGripPart, at: PicturePoint) => {
    const distance = Math.hypot(point[0] - at[0], point[1] - at[1]);
    if (distance <= reach && (best === null || distance < best.distance)) best = { grip, distance };
  };
  for (const handle of visiblePathHandles(nodes, selectedNode)) {
    consider({ part: 'handle', node: handle.node, side: handle.side }, handle.at);
  }
  nodes.forEach((node, index) => consider({ part: 'node', node: index }, node.at));
  if (best !== null) return (best as { grip: PathGripPart }).grip;
  const near = nearestPathPoint(annotation, point);
  return near && near.distance <= reach ? { part: 'segment', segment: near.segment, t: near.t } : null;
}
