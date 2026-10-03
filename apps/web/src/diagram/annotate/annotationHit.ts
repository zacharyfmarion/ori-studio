/**
 * What a press on the Annotate canvas lands on: an end of the selected
 * annotation, or an annotation's body — the topmost, as drawn — in picture
 * units.
 *
 * Pure: no DOM, no store.
 */
import { isKnownAnnotation, type DiagramAnnotation, type KnownDiagramAnnotation } from '../document/diagramDocument';
import { ARROW_BEND, LINE_KINDS, arrowApex, isArrowKind, isPointKind, type PicturePoint } from './annotationModel';

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

/** How far a press is from an annotation's body; 0 inside a glyph or a label. */
function bodyDistance(annotation: KnownDiagramAnnotation, point: PicturePoint, sizes: HitSizes): number {
  if (annotation.kind === 'label') {
    const characters = Math.max(1, [...(annotation.text ?? '')].length);
    const halfWidth = sizes.label * (0.3 * characters + 0.2);
    const halfHeight = sizes.label * 0.6;
    const dx = Math.max(0, Math.abs(point[0] - annotation.from[0]) - halfWidth);
    const dy = Math.max(0, Math.abs(point[1] - annotation.from[1]) - halfHeight);
    return Math.hypot(dx, dy);
  }
  if (isPointKind(annotation.kind)) {
    return Math.max(0, Math.hypot(point[0] - annotation.from[0], point[1] - annotation.from[1]) - sizes.glyph);
  }
  if (isArrowKind(annotation.kind)) return distanceToPolyline(point, arrowPolyline(annotation));
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
