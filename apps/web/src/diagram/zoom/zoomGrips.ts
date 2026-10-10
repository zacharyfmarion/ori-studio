/**
 * The grips of an enlarge area, and of an enlarged step's frame (Revision 2,
 * S3): what a press on a selected outline takes hold of, and the outline a
 * drag of each makes. A circle has its centre's dot, which moves it, and its
 * rim, which resizes it; a rounded rectangle its centre, four corners and
 * four edges — its aspect free (Zach, 2026-10-06), Shift keeping it, Alt
 * resizing about the centre — turned with the rectangle.
 *
 * Everything is in the outline's own units: an area's picture units, or an
 * enlarged step's window. Nothing is clamped: an area is held to its range as
 * it is stored (`withZoomOutline`), a frame as its step stores it.
 *
 * Pure: no DOM, no store.
 */
import type { PicturePoint } from '../annotate/annotationModel';
import type { DiagramZoomOutline } from '../document/diagramDocument';
import { zoomShapeOf } from './zoomModel';

/**
 * A part of an outline a press takes hold of: its centre, a circle's rim, a
 * rectangle's corner (0 top left, then clockwise on the page) or edge (0 the
 * top, then clockwise), each on the rectangle's own axes.
 */
export type ZoomGrip =
  | { part: 'centre' }
  | { part: 'rim' }
  | { part: 'corner'; corner: 0 | 1 | 2 | 3 }
  | { part: 'edge'; edge: 0 | 1 | 2 | 3 };

/** Each corner's direction from the centre, on the rectangle's own axes, y down. */
const CORNERS: readonly PicturePoint[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
/** Each edge's direction from the centre. */
const EDGES: readonly PicturePoint[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Modifiers held through a drag: Shift keeps a rectangle's aspect, Alt resizes it about its centre. */
export interface ZoomDragKeys {
  shift?: boolean;
  alt?: boolean;
}

/** The smallest side or radius a drag leaves, in the outline's units: never nothing, never turned inside out. */
const LEAST = 1e-6;

function radiansOf(outline: DiagramZoomOutline): number {
  return ((outline.angle ?? 0) * Math.PI) / 180;
}

/** A vector on the outline's own axes, turned onto its units. */
function turned(outline: DiagramZoomOutline, [x, y]: PicturePoint): PicturePoint {
  const a = radiansOf(outline);
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return [x * c - y * s, x * s + y * c];
}

/** A vector in the outline's units, on its own axes. */
function unturned(outline: DiagramZoomOutline, [x, y]: PicturePoint): PicturePoint {
  const a = -radiansOf(outline);
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return [x * c - y * s, x * s + y * c];
}

/** Where a grip sits: a rim's on the circle's right, a corner or an edge's middle on the rectangle as it is turned. */
export function zoomGripPoint(outline: DiagramZoomOutline, grip: ZoomGrip): PicturePoint {
  const [cx, cy] = outline.centre;
  switch (grip.part) {
    case 'centre':
      return [cx, cy];
    case 'rim':
      return [cx + (outline.radius ?? 0), cy];
    case 'corner':
    case 'edge': {
      const [w, h] = outline.size ?? [2 * (outline.radius ?? 0), 2 * (outline.radius ?? 0)];
      const [dx, dy] = grip.part === 'corner' ? CORNERS[grip.corner]! : EDGES[grip.edge]!;
      const [x, y] = turned(outline, [(dx * w) / 2, (dy * h) / 2]);
      return [cx + x, cy + y];
    }
  }
}

/** Every grip an outline shows: a circle's centre and rim; a rectangle's centre, corners and edges. */
export function zoomGrips(outline: DiagramZoomOutline): { grip: ZoomGrip; at: PicturePoint }[] {
  const grips: ZoomGrip[] =
    zoomShapeOf(outline) === 'circle'
      ? [{ part: 'centre' }, { part: 'rim' }]
      : [
          { part: 'centre' },
          ...([0, 1, 2, 3] as const).map((corner): ZoomGrip => ({ part: 'corner', corner })),
          ...([0, 1, 2, 3] as const).map((edge): ZoomGrip => ({ part: 'edge', edge })),
        ];
  return grips.map((grip) => ({ grip, at: zoomGripPoint(outline, grip) }));
}

/**
 * What of a selected outline a press within `tolerance` takes hold of, or
 * null. A circle's rim anywhere along it, or its centre's dot — the nearer, the
 * rim on a tie, so a small circle can still be resized — as a close-up's
 * ring and dot are; a rectangle's nearest corner, edge or centre dot, a
 * corner or an edge before the centre on a tie.
 */
export function zoomGripAt(outline: DiagramZoomOutline, point: PicturePoint, tolerance: number): ZoomGrip | null {
  const [cx, cy] = outline.centre;
  if (zoomShapeOf(outline) === 'circle') {
    const away = Math.hypot(point[0] - cx, point[1] - cy);
    const rim = Math.abs(away - (outline.radius ?? 0));
    if (rim <= tolerance && rim <= away) return { part: 'rim' };
    return away <= tolerance ? { part: 'centre' } : null;
  }
  let best: { grip: ZoomGrip; distance: number } | null = null;
  // The centre last: a corner or an edge on a tie with it, as a small frame's are.
  for (const { grip, at } of [...zoomGrips(outline).slice(1), zoomGrips(outline)[0]!]) {
    const distance = Math.hypot(point[0] - at[0], point[1] - at[1]);
    if (distance <= tolerance && (best === null || distance < best.distance)) best = { grip, distance };
  }
  return best?.grip ?? null;
}

/**
 * The outline a drag of `grip` makes, the press at `start` and the pointer at
 * `at`: the centre moves it by the pointer's travel; a circle's rim goes in
 * or out as far as the pointer has from where it took hold, as a close-up's
 * ring does; a rectangle's corner follows the pointer with the opposite
 * corner held, and an edge with the opposite edge held — about the centre
 * with Alt, and keeping its aspect with Shift. Its turn is kept.
 */
export function draggedOutline(
  outline: DiagramZoomOutline,
  grip: ZoomGrip,
  start: PicturePoint,
  at: PicturePoint,
  { shift = false, alt = false }: ZoomDragKeys = {}
): DiagramZoomOutline {
  const [cx, cy] = outline.centre;
  const travel: PicturePoint = [at[0] - start[0], at[1] - start[1]];
  if (grip.part === 'centre') return { ...outline, centre: [cx + travel[0], cy + travel[1]] };
  if (grip.part === 'rim') {
    const away = (point: PicturePoint) => Math.hypot(point[0] - cx, point[1] - cy);
    return { ...outline, radius: Math.max(LEAST, (outline.radius ?? 0) + away(at) - away(start)) };
  }
  const [w, h] = outline.size ?? [2 * (outline.radius ?? 0), 2 * (outline.radius ?? 0)];
  const [tx, ty] = unturned(outline, travel);
  const [dx, dy] = grip.part === 'corner' ? CORNERS[grip.corner]! : EDGES[grip.edge]!;
  // On the rectangle's own axes, an axis at a time, as a scale `k` of its
  // half-size `a` there: the side dragged is held from the opposite side —
  // or from the centre, with Alt — and has gone `s·t` further from it, which
  // a scale below 0 takes past it, the rectangle turned inside out that way.
  const scaleOf = (s: number, a: number, t: number): number | null => {
    if (s === 0) return null;
    const base = alt ? a : 2 * a;
    return base > 0 ? (base + s * t) / base : 1;
  };
  const scales: [number | null, number | null] = [scaleOf(dx, w / 2, tx), scaleOf(dy, h / 2, ty)];
  // Shift: one scale for both axes — the larger, for a corner; an edge's own
  // — each the way it was dragged, so the aspect is kept.
  const dragged = scales.filter((k): k is number => k !== null);
  const shared = shift && dragged.length > 0 ? Math.max(...dragged.map(Math.abs)) : null;
  const place = (s: number, a: number, k: number | null) => {
    // An axis no grip drags keeps its size — Shift scales it with the other, about the centre line.
    if (k === null) return { centre: 0, size: 2 * a * (shared ?? 1) };
    const scale = shared === null ? k : Math.sign(k || 1) * shared;
    // From the side held at -s·a, the dragged one is now at -s·a + s·2a·scale: their middle.
    return { centre: alt ? 0 : s * a * (scale - 1), size: 2 * a * Math.abs(scale) };
  };
  const [x, y] = [place(dx, w / 2, scales[0]), place(dy, h / 2, scales[1])];
  const [ox, oy] = turned(outline, [x.centre, y.centre]);
  return {
    ...outline,
    centre: [cx + ox, cy + oy],
    size: [Math.max(LEAST, x.size), Math.max(LEAST, y.size)],
  };
}

/** Whether two outlines are one, number for number. */
export function sameOutline(a: DiagramZoomOutline, b: DiagramZoomOutline): boolean {
  return (
    a.centre[0] === b.centre[0] &&
    a.centre[1] === b.centre[1] &&
    a.radius === b.radius &&
    (a.angle ?? 0) === (b.angle ?? 0) &&
    (a.size === undefined ? b.size === undefined : b.size !== undefined && a.size[0] === b.size[0] && a.size[1] === b.size[1])
  );
}
