export interface Point {
  x: number;
  y: number;
}

export interface PlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function paperToSvg(point: Point, rect: PlotRect): Point {
  return {
    x: rect.x + point.x * rect.width,
    y: rect.y + (1 - point.y) * rect.height,
  };
}

export function svgToPaper(point: Point, rect: PlotRect): Point {
  return {
    x: (point.x - rect.x) / rect.width,
    y: 1 - (point.y - rect.y) / rect.height,
  };
}

export function clampPaperPoint(point: Point): Point {
  return {
    x: Math.min(1, Math.max(0, point.x)),
    y: Math.min(1, Math.max(0, point.y)),
  };
}

export function formatNumber(value: number, digits = 3): string {
  return value.toFixed(digits).replace(/\.?0+$/, '');
}

/** The convex hull of `points`, counter-clockwise (Andrew's monotone chain). */
export function convexHull(points: readonly Point[]): Point[] {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (source: readonly Point[]) => {
    const out: Point[] = [];
    for (const p of source) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  const lower = half(sorted);
  const upper = half([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
