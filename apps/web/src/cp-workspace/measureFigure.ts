import type { CpMeasureKind } from './measure';

/**
 * Screen-space geometry for the measure tool's on-canvas figure: the arrowheads of a
 * dimension line, the arc of an angle, and where the value label sits. Every input
 * and output is in CSS pixels — the projection happens in {@link CpMeasureLayer},
 * which keeps this DOM-free and unit-testable (the same split
 * `annotations/annotationTransform` uses).
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** Arrowhead length/half-width and the angle arc's radius, all in CSS px. */
const ARROW_LENGTH = 9;
const ARROW_HALF_WIDTH = 3.5;
const ARC_RADIUS = 34;

function polyline(points: readonly Vec2[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

/** The two barbs of an arrowhead at `tip`, pointing back toward `from`. */
export function arrowheadPoints(tip: Vec2, from: Vec2): string | null {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  const ux = dx / length;
  const uy = dy / length;
  const baseX = tip.x - ux * ARROW_LENGTH;
  const baseY = tip.y - uy * ARROW_LENGTH;
  return polyline([
    { x: baseX - uy * ARROW_HALF_WIDTH, y: baseY + ux * ARROW_HALF_WIDTH },
    tip,
    { x: baseX + uy * ARROW_HALF_WIDTH, y: baseY - ux * ARROW_HALF_WIDTH },
  ]);
}

/** SVG arc path from `dir0` to `dir1` about `center`, the short way round. */
export function arcPath(center: Vec2, from: Vec2, to: Vec2): string | null {
  const a0 = Math.atan2(from.y - center.y, from.x - center.x);
  const a1 = Math.atan2(to.y - center.y, to.x - center.x);
  if (!Number.isFinite(a0) || !Number.isFinite(a1)) return null;
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const start = {
    x: center.x + Math.cos(a0) * ARC_RADIUS,
    y: center.y + Math.sin(a0) * ARC_RADIUS,
  };
  const end = { x: center.x + Math.cos(a1) * ARC_RADIUS, y: center.y + Math.sin(a1) * ARC_RADIUS };
  const sweep = delta > 0 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${ARC_RADIUS} ${ARC_RADIUS} 0 0 ${sweep} ${end.x} ${end.y}`;
}

/** Where the label sits: the midpoint of a distance, or just outside the arc of an angle. */
export function labelAnchor(kind: CpMeasureKind, css: readonly Vec2[]): Vec2 | null {
  if (kind === 'angle') {
    if (css.length < 3) return null;
    const [a, vertex, b] = css;
    const a0 = Math.atan2(a.y - vertex.y, a.x - vertex.x);
    const a1 = Math.atan2(b.y - vertex.y, b.x - vertex.x);
    let delta = a1 - a0;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const mid = a0 + delta / 2;
    return {
      x: vertex.x + Math.cos(mid) * (ARC_RADIUS + 18),
      y: vertex.y + Math.sin(mid) * (ARC_RADIUS + 18),
    };
  }
  if (css.length < 2) return null;
  const [a, b] = css;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
