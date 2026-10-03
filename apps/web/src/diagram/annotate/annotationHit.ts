/**
 * What a press on the Annotate canvas lands on: an end of the selected
 * annotation, or an annotation's body — the topmost, as drawn — in picture
 * units.
 *
 * Pure: no DOM, no store.
 */
import { isKnownAnnotation, type DiagramAnnotation, type KnownDiagramAnnotation } from '../document/diagramDocument';
import {
  DIAGRAM_ARROWHEAD_INK,
  DIAGRAM_FOLD_RETURN_INK,
  DIAGRAM_PUSH_INK,
} from '../../cp-workspace/references/diagram/diagramInk';
import {
  arcPolyline,
  arcThroughPoints,
  pushArrowOutline,
  returnStroke,
} from '../../cp-workspace/references/stepDiagramGeometry';
import {
  ARROW_BEND,
  LINE_KINDS,
  arrowApex,
  isArrowKind,
  isPointKind,
  labelHalfWidth,
  type PicturePoint,
} from './annotationModel';

/** What a press took hold of: the annotation, and its body or one end. */
export interface AnnotationGrip {
  annotationId: string;
  part: 'body' | 'from' | 'to';
}

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

/** The points along an arrow's arc, from its tail to its tip. */
export function arrowPolyline(annotation: KnownDiagramAnnotation, samples = 24): PicturePoint[] {
  const { from, to } = annotation;
  const apex = arrowApex(from, to, annotation.bend ?? ARROW_BEND);
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
 * whichever carries it.
 */
function arrowDistance(annotation: KnownDiagramAnnotation, point: PicturePoint, ink: number): number {
  const { from, to } = annotation;
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const outgoing = arrowPolyline(annotation);
  let distance = distanceToPolyline(point, outgoing);
  let tip = to;
  if (annotation.kind === 'fold-unfold-arrow') {
    const out = arcThroughPoints(up(from), up(arrowApex(from, to, annotation.bend ?? ARROW_BEND)), up(to));
    const offset = Math.min(DIAGRAM_FOLD_RETURN_INK.offset * ink, DIAGRAM_FOLD_RETURN_INK.ofChord * chord);
    const back = out ? returnStroke(out, offset) : null;
    if (back) {
      const returning = arcPolyline(back).map(down);
      distance = Math.min(distance, distanceToPolyline(point, returning));
      tip = returning[returning.length - 1]!;
    }
  }
  // The head's barbs stand off its spine by under half its length.
  const head = headLength(chord, ink);
  return Math.min(distance, Math.hypot(point[0] - tip[0], point[1] - tip[1]) - head * 0.5);
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

/** How far a press is from an annotation's body, as it is drawn; 0 inside a glyph, a label or a push. */
function bodyDistance(annotation: KnownDiagramAnnotation, point: PicturePoint, sizes: HitSizes): number {
  if (annotation.kind === 'label') {
    const halfWidth = labelHalfWidth(annotation.text ?? '');
    const halfHeight = sizes.label * 0.6;
    const dx = Math.max(0, Math.abs(point[0] - annotation.from[0]) - halfWidth);
    const dy = Math.max(0, Math.abs(point[1] - annotation.from[1]) - halfHeight);
    return Math.hypot(dx, dy);
  }
  if (isPointKind(annotation.kind)) {
    return Math.max(0, Math.hypot(point[0] - annotation.from[0], point[1] - annotation.from[1]) - sizes.glyph);
  }
  if (isArrowKind(annotation.kind)) return arrowDistance(annotation, point, sizes.ink);
  if (annotation.kind === 'push-arrow') return pushDistance(annotation, point, sizes.ink);
  return distanceToSegment(point, annotation.from, annotation.to);
}

/**
 * What a press at `point` takes hold of: an end of the selected annotation
 * first — the dots it shows — then the topmost annotation whose body is
 * within reach. Null for empty paper.
 */
export function hitAnnotation(
  annotations: readonly DiagramAnnotation[],
  point: PicturePoint,
  sizes: HitSizes,
  selectedId: string | null
): AnnotationGrip | null {
  const known = annotations.filter(isKnownAnnotation);
  const selected = known.find((annotation) => annotation.id === selectedId);
  if (selected && !isPointKind(selected.kind)) {
    const ends = (['to', 'from'] as const)
      .map((part) => ({ part, distance: Math.hypot(point[0] - selected[part][0], point[1] - selected[part][1]) }))
      .filter(({ distance }) => distance <= sizes.tolerance)
      .sort((a, b) => a.distance - b.distance);
    if (ends[0]) return { annotationId: selected.id, part: ends[0].part };
  }
  // Topmost first, as they are drawn: labels over marks over lines.
  const drawn = [
    ...known.filter((annotation) => LINE_KINDS.has(annotation.kind)),
    ...known.filter((annotation) => !LINE_KINDS.has(annotation.kind) && annotation.kind !== 'label'),
    ...known.filter((annotation) => annotation.kind === 'label'),
  ];
  for (let index = drawn.length - 1; index >= 0; index -= 1) {
    const annotation = drawn[index]!;
    if (bodyDistance(annotation, point, sizes) <= sizes.tolerance) return { annotationId: annotation.id, part: 'body' };
  }
  return null;
}
