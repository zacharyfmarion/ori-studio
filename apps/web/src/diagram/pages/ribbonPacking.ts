import { laneCrosses, type LanePoint, type LaneStop } from './flowLane';
import type { PageBox } from './pagePlacement';
import { ribbonPath, pointOnRibbon } from './ribbonPath';

export const RIBBON_CLEARANCE_MM = 6;
export const RIBBON_GAP_RATIO = 1.5;
export type Polygon = readonly LanePoint[];
export interface PackingShape {
  /** Picture, number and caption, relative to the picture centre. */
  polygons: readonly Polygon[];
  picture: Polygon;
  bounds: PageBox;
}
export interface PackedRibbon {
  size: number;
  stops: LaneStop[];
  shapes: PackingShape[];
  rows: number;
  gaps: number[];
}
export interface RibbonPackingInput {
  count: number;
  area: PageBox;
  shape: (index: number, size: number) => PackingShape;
  oddRows: boolean;
  up: boolean;
  clearance?: number;
  gapRatio?: number;
  halfWidth?: number;
}

export function rectangle(x: number, y: number, w: number, h: number): Polygon {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/** Convex occupied outlines retain the spare corners of folded paper. */
export function convexHull(points: readonly LanePoint[]): Polygon {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: LanePoint, b: LanePoint, c: LanePoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (items: LanePoint[]) => {
    const result: LanePoint[] = [];
    for (const p of items) {
      while (result.length >= 2 && cross(result.at(-2)!, result.at(-1)!, p) <= 1e-10) result.pop();
      result.push(p);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

function inside(p: LanePoint, polygon: Polygon, at: LanePoint): boolean {
  let positive = false,
    negative = false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!,
      b = polygon[(i + 1) % polygon.length]!;
    const cross = (b.x - a.x) * (p.y - at.y - a.y) - (b.y - a.y) * (p.x - at.x - a.x);
    positive ||= cross > 1e-7;
    negative ||= cross < -1e-7;
  }
  return !(positive && negative);
}

/** Exposed arc length, clipped by both occupied picture outlines, including bends. */
export function ribbonGaps(
  stops: readonly LaneStop[],
  shapes: readonly PackingShape[],
  samples = 40,
  halfWidth = 10,
): number[] {
  return ribbonPath(stops, halfWidth).segments.map((curves, i) => {
    const a = stops[i]!,
      b = stops[i + 1]!;
    let length = 0,
      previous: LanePoint = a,
      from: LanePoint = a;
    for (const curve of curves) {
      for (let j = 1; j <= samples; j++) {
        const p = pointOnRibbon(from, curve, j / samples);
        const midpoint = { x: (p.x + previous.x) / 2, y: (p.y + previous.y) / 2 };
        if (!inside(midpoint, shapes[i]!.picture, a) && !inside(midpoint, shapes[i + 1]!.picture, b))
          length += Math.hypot(p.x - previous.x, p.y - previous.y);
        previous = p;
      }
      from = curve.to;
    }
    return length;
  });
}

/** Separating-axis displacement: polygons need at least `clearance` on one separating axis. */
function separate(a: Polygon, at: LanePoint, b: Polygon, bt: LanePoint, clearance: number): LanePoint | null {
  let depth = Infinity,
    axis: LanePoint = { x: 0, y: 0 };
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!,
        q = poly[(i + 1) % poly.length]!;
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      if (length < 1e-8) continue;
      const x = -(q.y - p.y) / length,
        y = (q.x - p.x) / length;
      let a0 = Infinity,
        a1 = -Infinity,
        b0 = Infinity,
        b1 = -Infinity;
      for (const v of a) {
        const n = (v.x + at.x) * x + (v.y + at.y) * y;
        a0 = Math.min(a0, n);
        a1 = Math.max(a1, n);
      }
      for (const v of b) {
        const n = (v.x + bt.x) * x + (v.y + bt.y) * y;
        b0 = Math.min(b0, n);
        b1 = Math.max(b1, n);
      }
      if (a1 + clearance <= b0 || b1 + clearance <= a0) return null;
      const forward = a1 + clearance - b0,
        back = b1 + clearance - a0;
      const d = Math.min(forward, back);
      if (d < depth) {
        depth = d;
        const sign = forward < back ? 1 : -1;
        axis = { x: x * sign, y: y * sign };
      }
    }
  return { x: axis.x * depth, y: axis.y * depth };
}

function clampStops(stops: LaneStop[], shapes: PackingShape[], area: PageBox): void {
  stops.forEach((stop, i) => {
    const b = shapes[i]!.bounds;
    stop.x = Math.max(area.x - b.x, Math.min(area.x + area.w - b.x - b.w, stop.x));
    stop.y = Math.max(area.y - b.y, Math.min(area.y + area.h - b.y - b.h, stop.y));
  });
}

/** Keep automatic turns round enough for the band and inside the paper. */
function constrainBends(stops: LaneStop[], input: RibbonPackingInput): void {
  const half = input.halfWidth ?? 10;
  const width = input.area.x * 2 + input.area.w;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!,
      b = stops[i]!;
    if (a.row === b.row) continue;
    const pitch = Math.max(0.1, Math.abs(b.y - a.y) / 2),
      radius = Math.min(half, pitch);
    const least = Math.sqrt((radius * pitch) / 0.97),
      most = (0.97 * pitch * pitch) / Math.max(0.1, radius);
    const difference = b.x - a.x,
      allowed = Math.max(0, most - least);
    if (Math.abs(difference) > allowed) {
      const move = ((Math.abs(difference) - allowed) * Math.sign(difference)) / 2;
      a.x += move;
      b.x -= move;
    }
    const reach =
      most < least
        ? pitch
        : Math.min(Math.max(0.1, most - Math.abs(b.x - a.x)), Math.max(least, Math.min(20, pitch * 0.8)));
    const apex = a.rightToLeft ? Math.min(a.x, b.x) - reach : Math.max(a.x, b.x) + reach;
    const shift = Math.max(half / 2, Math.min(width - half / 2, apex)) - apex;
    a.x += shift;
    b.x += shift;
  }
}

function collisions(stops: LaneStop[], shapes: PackingShape[], clearance: number, resolve: boolean): number {
  let worst = 0;
  for (let i = 0; i < stops.length; i++)
    for (let j = i + 1; j < stops.length; j++) {
      const a = stops[i]!,
        b = stops[j]!;
      const ab = shapes[i]!.bounds,
        bb = shapes[j]!.bounds;
      if (
        a.x + ab.x > b.x + bb.x + bb.w + clearance ||
        b.x + bb.x > a.x + ab.x + ab.w + clearance ||
        a.y + ab.y > b.y + bb.y + bb.h + clearance ||
        b.y + bb.y > a.y + ab.y + ab.h + clearance
      )
        continue;
      for (const ap of shapes[i]!.polygons)
        for (const bp of shapes[j]!.polygons) {
          const push = separate(ap, a, bp, b, clearance);
          if (!push) continue;
          worst = Math.max(worst, Math.hypot(push.x, push.y));
          if (resolve) {
            a.x -= push.x * 0.51;
            a.y -= push.y * 0.51;
            b.x += push.x * 0.51;
            b.y += push.y * 0.51;
          }
        }
    }
  return worst;
}

function balancedCounts(count: number, rows: number, variant: number): number[] {
  const counts = Array.from({ length: rows }, () => Math.floor(count / rows));
  const order = Array.from({ length: rows }, (_, i) => i).sort((a, b) =>
    variant % 2
      ? Math.abs(a - (rows - 1) / 2) - Math.abs(b - (rows - 1) / 2)
      : Math.abs(b - (rows - 1) / 2) - Math.abs(a - (rows - 1) / 2),
  );
  for (let i = 0; i < count % rows; i++) counts[order[i]!]!++;
  return counts;
}

function candidate(input: RibbonPackingInput, size: number, rows: number, variant: number): PackedRibbon | null {
  const { area, count } = input;
  const clearance = input.clearance ?? RIBBON_CLEARANCE_MM;
  const cap = input.gapRatio ?? RIBBON_GAP_RATIO;
  const shapes = Array.from({ length: count }, (_, i) => input.shape(i, size));
  if (shapes.some((s) => s.bounds.w > area.w || s.bounds.h > area.h)) return null;
  const counts = balancedCounts(count, rows, variant);
  const stops: LaneStop[] = [];
  counts.forEach((columns, row) => {
    for (let col = 0; col < columns; col++) {
      const shape = shapes[stops.length]!,
        b = shape.bounds;
      const rtl = row % 2 === 1,
        across = rtl ? columns - 1 - col : col;
      const spread = columns === 1 ? 0.5 : across / (columns - 1);
      const down = rows === 1 ? (input.up ? 1 : 0) : (input.up ? rows - 1 - row : row) / (rows - 1);
      const top = area.y - b.y,
        bottom = area.y + area.h - b.y - b.h;
      // Stagger in both axes: tall pictures can nest into the previous pass's corners.
      const stagger =
        variant >= 2 ? (across % 2 ? 1 : -1) * size * [0, 0, 0.18, 0.4, 0.65, 0.9][variant]! * (input.up ? -1 : 1) : 0;
      stops.push({
        x: area.x - b.x + spread * (area.w - b.w),
        y: top + down * (bottom - top) + stagger,
        row,
        rightToLeft: rtl,
      });
    }
  });
  const seeds = stops.map((p) => ({ ...p }));
  // Bounded deterministic relaxation. Collision projections alternate with exposed-gap springs.
  for (let pass = 0; pass < 64; pass++) {
    const gaps = ribbonGaps(stops, shapes, 12, input.halfWidth);
    const target = gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(1, gaps.length);
    for (let i = 1; i < count; i++) {
      const a = stops[i - 1]!,
        b = stops[i]!,
        d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d < 0.01) continue;
      const error = (gaps[i - 1]! - target) * 0.22;
      a.x += ((b.x - a.x) / d) * error;
      a.y += ((b.y - a.y) / d) * error;
      b.x -= ((b.x - a.x) / d) * error;
      b.y -= ((b.y - a.y) / d) * error;
    }
    stops.forEach((p, i) => {
      const seed = seeds[i]!;
      // Keep the page filled and reading order clear without locking centres to a grid.
      p.x += (seed.x - p.x) * 0.008;
      p.y += (seed.y - p.y) * 0.008;
    });
    collisions(stops, shapes, clearance, true);
    clampStops(stops, shapes, area);
    constrainBends(stops, input);
  }
  if (collisions(stops, shapes, clearance - 0.05, false) > 0.05) return null;
  if (
    stops.some((p, i) => {
      const b = shapes[i]!.bounds;
      return (
        p.x + b.x < area.x - 0.1 ||
        p.x + b.x + b.w > area.x + area.w + 0.1 ||
        p.y + b.y < area.y - 0.1 ||
        p.y + b.y + b.h > area.y + area.h + 0.1
      );
    })
  )
    return null;
  for (let i = 1; i < count; i++) {
    const a = stops[i - 1]!,
      b = stops[i]!;
    if (a.row === b.row ? (b.x - a.x) * (a.rightToLeft ? -1 : 1) <= 1 : (b.y - a.y) * (input.up ? -1 : 1) <= 1)
      return null;
  }
  if (laneCrosses(ribbonPath(stops, input.halfWidth).lane)) return null;
  const gaps = ribbonGaps(stops, shapes, 40, input.halfWidth);
  if (gaps.length && Math.max(...gaps) > cap * Math.max(0.01, Math.min(...gaps)) + 0.1) return null;
  return { size, rows, stops, shapes, gaps: ribbonGaps(stops, shapes, 40, input.halfWidth) };
}

/** Largest feasible candidate in a bounded family of balanced serpentine packings. No stored placement participates. */
const packingCache = new Map<string, PackedRibbon | null>();
export function packRibbon(input: RibbonPackingInput): PackedRibbon | null {
  const key = JSON.stringify([
    input.area,
    input.oddRows,
    input.up,
    input.clearance,
    input.gapRatio,
    input.halfWidth,
    Array.from({ length: input.count }, (_, i) => [input.shape(i, 40), input.shape(i, 60)]),
  ]);
  if (packingCache.has(key)) return packingCache.get(key)!;
  if (!input.count) return null;
  let best: PackedRibbon | null = null;
  const mostRows = Math.min(9, Math.max(1, Math.ceil(input.count / 2)));
  for (let rows = 1; rows <= mostRows; rows++) {
    if (input.oddRows && rows % 2 === 0) continue;
    for (const variant of [0, 1, 2, 3, 5]) {
      let low = 0,
        high = Math.min(input.area.w, input.area.h);
      for (let iteration = 0; iteration < 9; iteration++) {
        const size = (low + high) / 2;
        const packed = candidate(input, size, rows, variant);
        if (packed) {
          low = size;
          if (!best || size > best.size + 0.05) best = packed;
        } else high = size;
      }
    }
  }
  if (packingCache.size >= 256) packingCache.delete(packingCache.keys().next().value!);
  packingCache.set(key, best);
  return best;
}
