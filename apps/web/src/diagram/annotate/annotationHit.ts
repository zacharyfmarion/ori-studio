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
  DIAGRAM_ARROWHEAD_INK,
  DIAGRAM_FOLD_RETURN_INK,
  DIAGRAM_MARK_INK,
  DIAGRAM_PUSH_INK,
  DIAGRAM_RIGHT_ANGLE_INK,
  DIAGRAM_WHITE_ARROW_INK,
} from '../../cp-workspace/references/diagram/diagramInk';
import {
  arcPolyline,
  arrowheadAt,
  arrowheadExtent,
  arrowheadReach,
  backToRing,
  arcThroughPoints,
  outlineDistance,
  pathArrowGeometry,
  pushArrowOutline,
  returnStroke,
  rightAngleSquare,
  whiteArrowOutline,
} from '../../cp-workspace/references/stepDiagramGeometry';
import { flattenPath } from '../../lib/cubicBezier';
import {
  DEFAULT_WHITE_ARROW,
  LINE_KINDS,
  annotationEnds,
  arrowApex,
  arrowShape,
  calloutShape,
  isCornerKind,
  rightAngleDiagonal,
  labelHalfWidth,
  pathCubics,
  pathLength,
  type PicturePoint,
} from './annotationModel';
import { nearestPathPoint, pathNodesOf, visiblePathHandles } from './annotationPath';
import { perAnnotation } from './perAnnotation';

/**
 * Which part of an annotation a press took hold of: its body, or one end; a
 * callout's box; in Edit Path a node of an arrow's path, one of a node's two
 * handles, or the segment between two nodes (and where along it, `t` in
 * [0, 1], {@link hitPathGrip}); and a right angle's corner or the direction
 * it opens in, which the selected right angle offers in place of ends
 * ({@link rightAngleGrips}).
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
  | { part: 'direction' };

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
  /** A label's letters' size. */
  label: number;
  /** One ink, as the canvas draws it: what a head's length and a push's width are measured in. */
  ink: number;
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
    PATH_TOLERANCE
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
 * which are inside it — and from its line, as they are drawn.
 */
function calloutDistances(annotation: KnownDiagramAnnotation, point: PicturePoint): { box: number; line: number } {
  const { box, line } = calloutShape(annotation);
  return { box: boxDistance(point, box), line: line ? distanceToSegment(point, line[0], line[1]) : Infinity };
}

/**
 * A right-angle mark's open square in picture units, at the ink a press is
 * measured in, as it is drawn (`rightAngleDrawn`): the end of one leg, the
 * square's far corner, the end of the other.
 */
export function rightAngleLegs(
  annotation: Pick<KnownDiagramAnnotation, 'from' | 'to'>,
  ink: number
): [PicturePoint, PicturePoint, PicturePoint] {
  const [dx, dy] = rightAngleDiagonal(annotation);
  const [a, b, c] = rightAngleSquare(
    { x: annotation.from[0], y: annotation.from[1] },
    { x: dx, y: dy },
    DIAGRAM_RIGHT_ANGLE_INK.side * ink
  );
  return [
    [a.x, a.y],
    [b.x, b.y],
    [c.x, c.y],
  ];
}

/**
 * Where the selected right angle is taken hold of: its corner, which moves it
 * whole, and the square's far corner, which turns the way it opens.
 */
export function rightAngleGrips(
  annotation: Pick<KnownDiagramAnnotation, 'from' | 'to'>,
  ink: number
): { corner: PicturePoint; direction: PicturePoint } {
  return { corner: annotation.from, direction: rightAngleLegs(annotation, ink)[1] };
}

/**
 * How far a press is from a right-angle mark: 0 in its square — the corner
 * it sits in included, which is its whole place — else the distance to its
 * legs.
 */
function rightAngleDistance(annotation: KnownDiagramAnnotation, point: PicturePoint, ink: number): number {
  const legs = rightAngleLegs(annotation, ink);
  if (insidePolygon(point, [annotation.from, ...legs])) return 0;
  return distanceToPolyline(point, legs);
}

/**
 * How far a press is from an annotation's body, as it is drawn; 0 inside a
 * glyph, a label, a push, a white arrow or a callout's box. A circle is its
 * ring, not its inside: an arrow that lands on it ends at its centre, and a
 * press there is the arrow's. Every kind is measured as it is drawn (a
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
      const halfWidth = labelHalfWidth(annotation.text ?? '');
      const halfHeight = sizes.label * 0.6;
      const dx = Math.max(0, Math.abs(point[0] - annotation.from[0]) - halfWidth);
      const dy = Math.max(0, Math.abs(point[1] - annotation.from[1]) - halfHeight);
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
    case 'white-arrow':
      return whiteArrowDistance(annotation, point, sizes.ink);
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
      return distanceToSegment(point, annotation.from, annotation.to);
    case 'circle':
      return Math.abs(Math.hypot(point[0] - annotation.from[0], point[1] - annotation.from[1]) - circleRadius(sizes.ink));
    case 'right-angle':
      return rightAngleDistance(annotation, point, sizes.ink);
    case 'callout': {
      const { box, line } = calloutDistances(annotation, point);
      return Math.min(box, line);
    }
  }
}

/**
 * What a press at `point` takes hold of: an end of the selected annotation
 * first — the dots it shows (`annotationEnds`) — then the topmost annotation
 * whose body is within reach: a callout by its box, which moves alone, or
 * its line, which moves the whole. Null for empty paper.
 */
/** The marks filled with the page inside their outline: they hide what was drawn under them. */
const HOLLOW_KINDS: ReadonlySet<DiagramAnnotationKind> = new Set(['push-arrow', 'white-arrow']);

export function hitAnnotation(
  annotations: readonly DiagramAnnotation[],
  point: PicturePoint,
  sizes: HitSizes,
  selectedId: string | null
): AnnotationGrip | null {
  const known = annotations.filter(isKnownAnnotation);
  const selected = known.find((annotation) => annotation.id === selectedId);
  if (selected && isCornerKind(selected.kind)) {
    // A right angle's corner, and the way it opens: no ends.
    const grips = rightAngleGrips(selected, sizes.ink);
    const near = (['direction', 'corner'] as const)
      .map((part) => ({ part, distance: Math.hypot(point[0] - grips[part][0], point[1] - grips[part][1]) }))
      .filter(({ distance }) => distance <= sizes.tolerance)
      .sort((a, b) => a.distance - b.distance);
    if (near[0]) return { annotationId: selected.id, part: near[0].part };
  } else if (selected) {
    const ends = annotationEnds(selected.kind)
      .map((part) => ({ part, distance: Math.hypot(point[0] - selected[part][0], point[1] - selected[part][1]) }))
      .filter(({ distance }) => distance <= sizes.tolerance)
      .sort((a, b) => a.distance - b.distance);
    if (ends[0]) return { annotationId: selected.id, part: ends[0].part };
  }
  // An arrow that lands in a circle is drawn stopped on its ring: its head is pressed there.
  const marks = known.filter((annotation) => annotation.kind === 'circle').map(({ from }) => from);
  // Topmost first, as they are drawn: labels over callouts over marks over
  // lines — and a circle over the other marks, its ring the one place to
  // take it, where an arrow that lands on it has the rest of its length;
  // but not where a hollow arrow drawn after it hides it.
  const last = new Set(['circle', 'callout', 'label']);
  const drawn = [
    ...known.filter((annotation) => LINE_KINDS.has(annotation.kind)),
    ...known.filter((annotation) => !LINE_KINDS.has(annotation.kind) && !last.has(annotation.kind)),
    ...known.filter((annotation) => annotation.kind === 'circle'),
    ...known.filter((annotation) => annotation.kind === 'callout'),
    ...known.filter((annotation) => annotation.kind === 'label'),
  ];
  for (let index = drawn.length - 1; index >= 0; index -= 1) {
    const annotation = drawn[index]!;
    if (bodyDistance(annotation, point, sizes, marks) > sizes.tolerance) continue;
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
    // A callout's box is taken on its own; its line takes the whole.
    const onBox = annotation.kind === 'callout' && calloutDistances(annotation, point).box <= sizes.tolerance;
    return { annotationId: annotation.id, part: onBox ? 'box' : 'body' };
  }
  return null;
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
