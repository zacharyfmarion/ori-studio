import type { Lane, LaneCurve, LanePoint, LaneStop } from './flowLane';

const QUARTER = (4 / 3) * (Math.SQRT2 - 1);
// Conservative curvature bound over the entire quarter cubic, not only its endpoint.
const END_RADIUS = 0.97;

/** The shared geometry for packing, gap measurement and the printed ribbon. */
export function ribbonPath(
  stops: readonly LaneStop[],
  halfWidth = 10,
): { lane: Lane; segments: LaneCurve[][]; bends: Map<number, number> } {
  const segments: LaneCurve[][] = [],
    bends = new Map<number, number>();
  let curveCount = 0;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!,
      b = stops[i]!;
    const direction = a.rightToLeft ? -1 : 1;
    if (a.row === b.row) {
      const handle = Math.abs(b.x - a.x) / 3;
      segments.push([
        { c1: { x: a.x + direction * handle, y: a.y }, c2: { x: b.x - direction * handle, y: b.y }, to: b },
      ]);
      curveCount++;
      continue;
    }
    const pitch = Math.max(0.1, Math.abs(b.y - a.y) / 2),
      half = Math.min(halfWidth, pitch);
    const least = Math.sqrt((half * pitch) / END_RADIUS),
      most = (END_RADIUS * pitch * pitch) / Math.max(0.1, half);
    const reach =
      most < least
        ? pitch
        : Math.min(Math.max(0.1, most - Math.abs(b.x - a.x)), Math.max(least, Math.min(20, pitch * 0.8)));
    const x = (direction > 0 ? Math.max(a.x, b.x) : Math.min(a.x, b.x)) + direction * reach;
    const middle = { x, y: (a.y + b.y) / 2 },
      down = b.y > a.y ? 1 : -1;
    const curves: LaneCurve[] = [
      { c1: { x: a.x + (x - a.x) * QUARTER, y: a.y }, c2: { x, y: middle.y - down * pitch * QUARTER }, to: middle },
      { c1: { x, y: middle.y + down * pitch * QUARTER }, c2: { x: b.x + (x - b.x) * QUARTER, y: b.y }, to: b },
    ];
    bends.set(i, curveCount);
    curveCount += 2;
    segments.push(curves);
  }
  // At picture centres the tangents are horizontal on both sides. Their lengths
  // may differ (G1 continuity); this avoids tightening a turn to match a short run.
  return { lane: { from: stops[0] ?? { x: 0, y: 0 }, curves: segments.flat() }, segments, bends };
}

export function pointOnRibbon(from: LanePoint, curve: LaneCurve, t: number): LanePoint {
  const u = 1 - t;
  return {
    x: u ** 3 * from.x + 3 * u * u * t * curve.c1.x + 3 * u * t * t * curve.c2.x + t ** 3 * curve.to.x,
    y: u ** 3 * from.y + 3 * u * u * t * curve.c1.y + 3 * u * t * t * curve.c2.y + t ** 3 * curve.to.y,
  };
}
