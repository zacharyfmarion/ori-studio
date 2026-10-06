/**
 * Enlarged steps' shapes as data (Revision 2,
 * `implementation-plans/diagram-revision-2.md`, "1. Enlarged steps"): an
 * enlarge area on a step, and the frame an enlarged step shows of its own
 * picture — each a circle or a rectangle with rounded corners — their sizes,
 * their defaults by shape, and the settings a page prints them by.
 *
 * An area is an annotation (`kind: 'zoom'`), cleaned and carried with the
 * paper by `annotationModel.ts` beside the close-up it is modelled on; this
 * module reads it as an outline, and holds what both an area and a frame
 * share. Everything is in whatever units the outline is in — a step's
 * picture units, or the paper's — so nothing here knows how large anything
 * is drawn.
 *
 * Pure: no DOM, no store, no React.
 */
import {
  ZOOM_CLICK,
  ZOOM_SCALE,
  rectangleAngle,
  withinReach,
  zoomRadiusWithin,
  zoomSideWithin,
  type PicturePoint,
} from '../annotate/annotationModel';
import type {
  DiagramIdFactory,
  DiagramZoomEdge,
  DiagramZoomOutline,
  DiagramZoomShape,
  KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { randomDiagramId } from '../document/diagramDocument';

export { ZOOM_CLICK, ZOOM_SCALE };

/** A rounded rectangle's corners: 0.22 of its shorter side, as both of Zach's examples draw them (45/205 = 75/342). */
export const ZOOM_CORNER = 0.22;

/**
 * Fill (Z4): an enlarged step prints as large as its room allows, and never
 * smaller than its area as it prints nor more than six times it.
 */
export const ZOOM_FILL = { min: 1, max: 6 } as const;

/**
 * How far a cut frame's arc runs past where it leaves the paper: a share of
 * its printed radius — a rectangle's shorter half-side — held to 2–6 mm. Look
 * 1 runs about 0.2 r past; a fixed 2 mm reads as a stub.
 */
export const ZOOM_OVERSHOOT = { share: 0.2, minMm: 2, maxMm: 6 } as const;

/** A cut frame whose pieces over paper cover this share of it or more draws whole: it lies over paper. */
export const ZOOM_CLOSED_SHARE = 0.97;

/** Gaps between a cut frame's pieces under this, in mm as it prints, are drawn through. */
export const ZOOM_GAP_MM = 2;

/** An area's, or a frame's, shape: a circle when it has a radius, else a rounded rectangle. */
export function zoomShapeOf(outline: Pick<DiagramZoomOutline, 'radius' | 'size'>): DiagramZoomShape {
  return outline.radius === undefined && outline.size !== undefined ? 'rounded' : 'circle';
}

/**
 * How a frame of `shape` draws its edge when none was chosen: a circle only
 * where it crosses paper (look 1), a rounded rectangle whole (look 2), whose
 * frame runs off the paper at a corner and would print broken cut. A chosen
 * one is kept whatever the shape, so changing Shape never overrides it.
 */
export function zoomEdgeOf(shape: DiagramZoomShape, edge: DiagramZoomEdge | undefined): DiagramZoomEdge {
  return edge ?? (shape === 'circle' ? 'cut' : 'whole');
}

/** An enlarge area as an outline, in its step's picture units. */
export function zoomOutlineOf(
  area: Pick<KnownDiagramAnnotation, 'from' | 'radius' | 'size' | 'angle'>
): DiagramZoomOutline {
  const centre: [number, number] = [area.from[0], area.from[1]];
  if (zoomShapeOf(area) === 'rounded') {
    return {
      centre,
      size: [area.size![0], area.size![1]],
      ...(area.angle ? { angle: area.angle } : {}),
    };
  }
  return { centre, radius: area.radius ?? ZOOM_CLICK.radius };
}

/** An area set to `outline`: its centre, and its circle's radius or its rectangle's size and turn. */
export function withZoomOutline(area: KnownDiagramAnnotation, outline: DiagramZoomOutline): KnownDiagramAnnotation {
  const { radius: _radius, size: _size, angle: _angle, ...rest } = area;
  const centre = withinReach(outline.centre);
  const at = { from: centre, to: [centre[0], centre[1]] as [number, number] };
  if (zoomShapeOf(outline) === 'circle') return { ...rest, ...at, radius: zoomRadiusWithin(outline.radius!) };
  const angle = rectangleAngle(outline.angle ?? 0);
  return {
    ...rest,
    ...at,
    size: [zoomSideWithin(outline.size![0]), zoomSideWithin(outline.size![1])],
    ...(angle !== 0 ? { angle } : {}),
  };
}

/**
 * An outline as the other shape, about the same centre: a circle of radius r
 * the 2r square, upright; a w × h rectangle the circle of radius ½·max(w, h),
 * which takes in its long side. A circle made a square and back is the circle
 * it was. The same outline when it is that shape already.
 */
export function outlineAsShape(outline: DiagramZoomOutline, shape: DiagramZoomShape): DiagramZoomOutline {
  if (zoomShapeOf(outline) === shape) return outline;
  const centre: [number, number] = [outline.centre[0], outline.centre[1]];
  if (shape === 'rounded') {
    const side = 2 * outline.radius!;
    return { centre, size: [side, side] };
  }
  return { centre, radius: Math.max(outline.size![0], outline.size![1]) / 2 };
}

/**
 * An area as the other shape ({@link outlineAsShape}). Its Edge, when chosen,
 * is kept; unsaid, it follows the new shape by itself ({@link zoomEdgeOf}).
 */
export function withZoomShape(area: KnownDiagramAnnotation, shape: DiagramZoomShape): KnownDiagramAnnotation {
  const outline = zoomOutlineOf(area);
  return zoomShapeOf(outline) === shape ? area : withZoomOutline(area, outlineAsShape(outline, shape));
}

/** An area at Size `scale`, held to its range; Fill for null. */
export function withZoomScale(area: KnownDiagramAnnotation, scale: number | null): KnownDiagramAnnotation {
  const { scale: _was, ...rest } = area;
  if (scale === null || !Number.isFinite(scale)) return rest;
  return {
    ...rest,
    scale: Math.min(ZOOM_SCALE.max, Math.max(ZOOM_SCALE.min, scale)),
  };
}

/** An area drawing its frames `edge`; its shape's own for null, unsaid. */
export function withZoomEdge(area: KnownDiagramAnnotation, edge: DiagramZoomEdge | null): KnownDiagramAnnotation {
  const { edge: _was, ...rest } = area;
  return edge === null ? rest : { ...rest, edge };
}

/** An area anchored at `anchor`, a point on the paper; the default rule for null. */
export function withZoomAnchor(area: KnownDiagramAnnotation, anchor: PicturePoint | null): KnownDiagramAnnotation {
  const { anchor: _was, ...rest } = area;
  return anchor === null ? rest : { ...rest, anchor: [anchor[0], anchor[1]] };
}

/**
 * A new rounded-rectangle area, dragged corner to corner (Enlarge in Frame):
 * `square` makes it square on its longer side, `fromMiddle` drags it from its
 * centre. A drag shorter than a slip either way puts down a click's square
 * at `start`.
 */
export function zoomAreaFromCorners(
  start: PicturePoint,
  end: PicturePoint,
  { square = false, fromMiddle = false }: { square?: boolean; fromMiddle?: boolean } = {},
  newId: DiagramIdFactory = randomDiagramId
): KnownDiagramAnnotation {
  const id = newId('annotation');
  let dx = end[0] - start[0];
  let dy = end[1] - start[1];
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  const scale = fromMiddle ? 2 : 1;
  const [width, height] = [Math.abs(dx) * scale, Math.abs(dy) * scale];
  const centre: PicturePoint = fromMiddle ? start : [start[0] + dx / 2, start[1] + dy / 2];
  const clicked = Math.min(width, height) < ZOOM_CLICK.size[0] / 20;
  const size: [number, number] = clicked
    ? [ZOOM_CLICK.size[0], ZOOM_CLICK.size[1]]
    : [zoomSideWithin(width), zoomSideWithin(height)];
  const at = withinReach(clicked ? start : centre);
  return { id, kind: 'zoom', from: at, to: [at[0], at[1]], size };
}

/** An outline's corner radius: a circle's own radius; a rounded rectangle's {@link ZOOM_CORNER} of its shorter side. */
export function zoomCornerRadius(outline: DiagramZoomOutline): number {
  if (zoomShapeOf(outline) === 'circle') return outline.radius!;
  return ZOOM_CORNER * Math.min(outline.size![0], outline.size![1]);
}

/**
 * An outline as a convex core and a radius about it — the outline is every
 * point within the radius of the core: a circle's centre and its radius; a
 * rounded rectangle's inner rectangle, turned, and its corner radius. What
 * hit tests and overlaps measure against.
 */
export function zoomCore(outline: DiagramZoomOutline): {
  core: PicturePoint[];
  radius: number;
} {
  const radius = zoomCornerRadius(outline);
  if (zoomShapeOf(outline) === 'circle') return { core: [[outline.centre[0], outline.centre[1]]], radius };
  const [w, h] = outline.size!;
  const [hx, hy] = [Math.max(0, w / 2 - radius), Math.max(0, h / 2 - radius)];
  const corners: PicturePoint[] = [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ];
  return {
    core: corners.map((corner) => turnedAbout(outline, corner)),
    radius,
  };
}

/** A point given about an outline's centre, along its own axes, turned with it onto its units. */
function turnedAbout(outline: DiagramZoomOutline, [x, y]: PicturePoint): PicturePoint {
  const radians = ((outline.angle ?? 0) * Math.PI) / 180;
  const [c, s] = [Math.cos(radians), Math.sin(radians)];
  return [outline.centre[0] + x * c - y * s, outline.centre[1] + x * s + y * c];
}

/** How far `point` is from an outline's inside: 0 inside it or on it. */
export function distanceOutside(outline: DiagramZoomOutline, point: PicturePoint): number {
  const { core, radius } = zoomCore(outline);
  return Math.max(0, distanceToConvex(core, point) - radius);
}

/** How far `point` is from an outline's rim, either side of it. */
export function distanceToRim(outline: DiagramZoomOutline, point: PicturePoint): number {
  const { core, radius } = zoomCore(outline);
  const inside = core.length === 1 ? 0 : insideConvex(core, point) ? -depthInConvex(core, point) : 0;
  const away = inside < 0 ? inside : distanceToConvex(core, point);
  return Math.abs(away - radius);
}

/**
 * The outline traced as a closed ring of points: a circle at `sides` points
 * (96, the ring a cut is measured on), a rounded rectangle along its four
 * sides exactly and `perCorner` points round each corner, turned with it.
 */
export function zoomOutlinePoints(outline: DiagramZoomOutline, sides = 96, perCorner = 32): PicturePoint[] {
  if (zoomShapeOf(outline) === 'circle') {
    const r = outline.radius!;
    return Array.from({ length: sides }, (_, index): PicturePoint => {
      const a = (2 * Math.PI * index) / sides;
      return [outline.centre[0] + r * Math.cos(a), outline.centre[1] + r * Math.sin(a)];
    });
  }
  const radius = zoomCornerRadius(outline);
  const [w, h] = outline.size!;
  const [hx, hy] = [w / 2 - radius, h / 2 - radius];
  // Clockwise on the page (y down) from the top side's right end: each corner's arc, its sides between.
  const corners: { at: PicturePoint; from: number }[] = [
    { at: [hx, -hy], from: -Math.PI / 2 },
    { at: [hx, hy], from: 0 },
    { at: [-hx, hy], from: Math.PI / 2 },
    { at: [-hx, -hy], from: Math.PI },
  ];
  const points: PicturePoint[] = [];
  for (const { at, from } of corners) {
    for (let index = 0; index <= perCorner; index += 1) {
      const a = from + ((Math.PI / 2) * index) / perCorner;
      points.push(turnedAbout(outline, [at[0] + radius * Math.cos(a), at[1] + radius * Math.sin(a)]));
    }
  }
  return points;
}

/** A box in picture units: its top-left corner and its size. */
export interface PictureBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A frame's window: its upright box — a circle's square, a turned rounded
 * rectangle's bounds — which an enlarged step's marks are measured in, the
 * window's longer side one unit, as a picture's frame is.
 */
export function frameWindow(outline: DiagramZoomOutline): PictureBox {
  const { core, radius } = zoomCore(outline);
  const xs = core.map(([x]) => x);
  const ys = core.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return {
    x: minX - radius,
    y: minY - radius,
    width: maxX - minX + 2 * radius,
    height: maxY - minY + 2 * radius,
  };
}

/** Where a point of a convex polygon (or a point) is nearest `point`, and how far. */
function distanceToConvex(core: readonly PicturePoint[], point: PicturePoint): number {
  if (core.length === 1) return Math.hypot(point[0] - core[0]![0], point[1] - core[0]![1]);
  if (insideConvex(core, point)) return 0;
  let best = Infinity;
  for (let index = 0; index < core.length; index += 1) {
    best = Math.min(best, distanceToSegment(point, core[index]!, core[(index + 1) % core.length]!));
  }
  return best;
}

/** How deep `point` is inside a convex polygon: its distance to the nearest side. */
function depthInConvex(core: readonly PicturePoint[], point: PicturePoint): number {
  let best = Infinity;
  for (let index = 0; index < core.length; index += 1) {
    best = Math.min(best, distanceToSegment(point, core[index]!, core[(index + 1) % core.length]!));
  }
  return best;
}

/** Whether `point` is inside a convex polygon, or on it, whichever way round its corners run. */
function insideConvex(core: readonly PicturePoint[], point: PicturePoint): boolean {
  let sign = 0;
  for (let index = 0; index < core.length; index += 1) {
    const a = core[index]!;
    const b = core[(index + 1) % core.length]!;
    const cross = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
    if (Math.abs(cross) < 1e-15) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** How far `point` is from the segment `a`–`b`. */
export function distanceToSegment(point: PicturePoint, a: PicturePoint, b: PicturePoint): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const length = dx * dx + dy * dy;
  const t = length > 0 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length)) : 0;
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}
