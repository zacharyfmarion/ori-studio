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
  type DiagramPathNode,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import {
  DIAGRAM_ARROWHEAD_INK,
  DIAGRAM_FOLD_RETURN_INK,
  DIAGRAM_PUSH_INK,
} from '../../cp-workspace/references/diagram/diagramInk';
import {
  arcPolyline,
  arcThroughPoints,
  pathArrowGeometry,
  pushArrowOutline,
  returnStroke,
} from '../../cp-workspace/references/stepDiagramGeometry';
import { flattenPath } from '../../lib/cubicBezier';
import {
  LINE_KINDS,
  arrowApex,
  arrowShape,
  isPointKind,
  labelHalfWidth,
  pathCubics,
  pathLength,
  type PicturePoint,
} from './annotationModel';
import { nearestPathPoint, pathNodesOf, visiblePathHandles } from './annotationPath';
import { perAnnotation } from './perAnnotation';

/**
 * Which part of an annotation a press took hold of: its body, or one end; in
 * Edit Path a node of an arrow's path, one of a node's two handles, or the
 * segment between two nodes (and where along it, `t` in [0, 1],
 * {@link hitPathGrip}); and, as the right-angle mark comes to offer them, a
 * mark's corner or the direction it opens in. Nothing offers the last two
 * yet.
 */
export type AnnotationGripPart =
  | { part: 'body' }
  | { part: 'from' }
  | { part: 'to' }
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
 * whichever carries it.
 */
function arrowDistance(annotation: KnownDiagramAnnotation, point: PicturePoint, ink: number): number {
  const shape = arrowShape(annotation);
  if (shape.kind === 'path') return pathArrowDistance(annotation, shape.path, point, ink);
  const { from, to } = annotation;
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const outgoing = arrowPolyline(annotation);
  let distance = distanceToPolyline(point, outgoing);
  let tip = to;
  if (annotation.kind === 'fold-unfold-arrow') {
    const out = arcThroughPoints(up(from), up(arrowApex(from, to, shape.bend)), up(to));
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

/**
 * A shaped arrow's return and head as a press finds them, by the drawing's
 * own geometry (`pathArrowGeometry`) in picture units, at the ink a press is
 * measured in: worked out once per annotation and ink.
 */
const pathArrowReach = perAnnotation(
  () => new Map<number, { back: PicturePoint[]; tip: PicturePoint; head: number } | null>()
);

function pathArrowAt(annotation: KnownDiagramAnnotation, path: readonly DiagramPathNode[], ink: number) {
  const byInk = pathArrowReach(annotation);
  const known = byInk.get(ink);
  if (known !== undefined) return known;
  const fold = annotation.kind === 'fold-unfold-arrow' ? 'fold-unfold' : 'valley';
  const geometry = pathArrowGeometry(
    pathCubics(path),
    fold,
    (length) => ({ head: headLength(length, ink), offset: returnOffset(length, ink), rim: 0 }),
    [],
    PATH_TOLERANCE
  );
  const found = geometry && {
    back: (geometry.back ?? []).map(([x, y]): PicturePoint => [x, y]),
    tip: [geometry.head.tip.x, geometry.head.tip.y] as PicturePoint,
    head: headLength(pathLength(path), ink),
  };
  byInk.set(ink, found);
  return found;
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
  ink: number
): number {
  const distance = distanceToPolyline(point, arrowPolyline(annotation));
  const drawn = pathArrowAt(annotation, path, ink);
  if (!drawn) return distance;
  const back = drawn.back.length > 1 ? distanceToPolyline(point, drawn.back) : Infinity;
  const head = Math.hypot(point[0] - drawn.tip[0], point[1] - drawn.tip[1]) - drawn.head * 0.5;
  return Math.min(distance, back, head);
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
 * How far a press is from an annotation's body, as it is drawn; 0 inside a
 * glyph, a label or a push. Every kind is measured as it is drawn (a switch,
 * so a new kind is a compile error here until it is).
 */
function bodyDistance(annotation: KnownDiagramAnnotation, point: PicturePoint, sizes: HitSizes): number {
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
      return arrowDistance(annotation, point, sizes.ink);
    case 'push-arrow':
      return pushDistance(annotation, point, sizes.ink);
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
      return distanceToSegment(point, annotation.from, annotation.to);
  }
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
