/**
 * A face's ring on the Layer order dialog's panes, drawn inside the face
 * (`implementation-plans/layer-order-dialog.md`, D20): a pick's outline sits
 * a pixel clear of the line drawn along the face's edge, half that line's
 * width plus half its own stroke plus a pixel in, so it never covers the
 * colour of a crease or an edge along that side, however wide it is drawn.
 *
 * {@link insetRing} moves every side of a ring inward by the same distance and
 * meets each pair of neighbours at a mitred corner, which is the inset of a
 * convex ring, and of a ring with a reflex corner while the inset stays well
 * short of its features (the L-shaped face a refusal names, D4). A ring with
 * no room for it — moved in past its inradius, a ring turns about its middle,
 * and a sliver's opposite sides cross — gets null: such a face keeps its tint
 * and its letter, and no ring.
 *
 * Corners along a side are dropped first: a folded face's outline names every
 * point a crease meets it at, and two sides in one line have no corner to
 * meet at.
 *
 * Pure: no React, no store, no engine.
 */
import type { Point } from '../../lib/geometry';
import { insideEvenOdd } from '../../cp-workspace/picking/polygonContains';
import { distanceToSegment } from '../../cp-workspace/picking/lineHitIndex';

/** How small a turn, or a side, counts as none: a share of the ring's extent. */
const STRAIGHT = 1e-9;

/**
 * How far in from a face's edge its ring's middle is drawn, in the pane's px:
 * half the width of the line drawn along the edge (`linePx`, a crease or the
 * paper's edge, as wide as it is drawn on screen), half the ring's stroke,
 * then a pixel.
 */
export function ringInsetPx(strokePx: number, linePx = 0): number {
  return linePx / 2 + strokePx / 2 + 1;
}

/** Twice the signed area: positive when the ring turns from +x toward +y. */
function twiceArea(ring: readonly Point[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice;
}

/** The ring with repeated corners and corners along a side taken out. */
function cornersOf(ring: readonly Point[]): Point[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const span = Math.max(maxX - minX, maxY - minY);
  if (!(span > 0)) return [];
  const step = STRAIGHT * span;
  let points = ring.filter((p, i) => {
    const next = ring[(i + 1) % ring.length]!;
    return Math.hypot(next.x - p.x, next.y - p.y) > step;
  });
  // Dropping one corner can put its neighbours in line: go round until none is.
  for (let changed = true; changed && points.length >= 3; ) {
    changed = false;
    const kept: Point[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const prev = kept.length > 0 ? kept[kept.length - 1]! : points[points.length - 1]!;
      const p = points[i]!;
      const next = points[(i + 1) % points.length]!;
      const ux = p.x - prev.x;
      const uy = p.y - prev.y;
      const vx = next.x - p.x;
      const vy = next.y - p.y;
      const cross = ux * vy - uy * vx;
      const lengths = Math.hypot(ux, uy) * Math.hypot(vx, vy);
      // In line and going on, not back: no corner. A side that turns straight back is kept, and fails below.
      if (Math.abs(cross) <= STRAIGHT * lengths && ux * vx + uy * vy > 0) {
        changed = true;
        continue;
      }
      kept.push(p);
    }
    points = kept;
  }
  return points;
}

/**
 * `ring` with every side moved `inset` inward, in its own units; null when it
 * has no room for that (see the module docs). Either winding; the answer
 * winds the same way.
 */
export function insetRing(ring: readonly Point[], inset: number): Point[] | null {
  if (!(inset >= 0) || !Number.isFinite(inset)) return null;
  const corners = cornersOf(ring);
  const n = corners.length;
  if (n < 3) return null;
  const area = twiceArea(corners);
  if (area === 0) return null;
  if (inset === 0) return corners;
  const sign = area > 0 ? 1 : -1;
  // Each side as a point on its moved line and its direction.
  const sides = corners.map((p, i) => {
    const q = corners[(i + 1) % n]!;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const length = Math.hypot(dx, dy);
    // Inward is to the left of a side of a ring with positive area.
    return { x: p.x - (dy / length) * sign * inset, y: p.y + (dx / length) * sign * inset, dx, dy };
  });
  const out: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = sides[(i + n - 1) % n]!;
    const b = sides[i]!;
    const den = a.dx * b.dy - a.dy * b.dx;
    if (den === 0) return null;
    const t = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / den;
    out.push({ x: a.x + a.dx * t, y: a.y + a.dy * t });
  }
  // A true inset's corners lie inside the ring, at least the inset from every side of it.
  const clear = (p: Point) =>
    insideEvenOdd(corners, p) &&
    corners.every((c, i) => distanceToSegment(p.x, p.y, c, corners[(i + 1) % n]!) >= inset * (1 - 1e-6));
  if (!out.every(clear)) return null;
  // Moved past its middle, a ring can come out turned the other way.
  if (Math.sign(twiceArea(out)) !== sign) return null;
  return out;
}
