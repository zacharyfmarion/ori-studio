import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import type { IndexedBounds } from '../../lib/boundsIndex';
const coordinate = (v: number | { 0: number }) => (typeof v === 'number' ? v : v[0]);
export type Placement = { x: number; y: number; bounds: IndexedBounds };
export function geometryBounds(g: CpGeometryTransport): IndexedBounds {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const point = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Non-finite geometry');
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x);
    b.minY = Math.min(b.minY, y);
    b.maxY = Math.max(b.maxY, y);
  };
  for (const coords of [g.segEndpoints, g.auxEndpoints, g.pointCoords])
    for (let i = 0; i < coords.length; i += 2) point(coords[i]!, coords[i + 1]!);
  for (let i = 0; i < g.circleData.length; i += 3) {
    const [x, y, r] = g.circleData.subarray(i, i + 3);
    point(x! - Math.abs(r!), y! - Math.abs(r!));
    point(x! + Math.abs(r!), y! + Math.abs(r!));
  }
  for (const text of g.tail.texts) point(coordinate(text.x), coordinate(text.y));
  if (!Number.isFinite(b.minX)) throw new Error('Empty crease pattern');
  return b;
}
/** Translation only. Column and row extents account for differently sized sheets. */
export function batchPlacement(
  bounds: readonly IndexedBounds[],
  existing: IndexedBounds | null,
  columns = Math.ceil(Math.sqrt(bounds.length)),
  gap = 100,
): Placement[] {
  if (!bounds.length) return [];
  if (columns === 0) columns = Math.ceil(Math.sqrt(bounds.length));
  if (!Number.isInteger(columns) || columns < 1 || columns > 1000 || !Number.isFinite(gap) || gap <= 0)
    throw new Error('Invalid layout');
  columns = Math.min(columns, bounds.length);
  const widths = Array<number>(columns).fill(0),
    heights = Array<number>(Math.ceil(bounds.length / columns)).fill(0);
  for (const [i, b] of bounds.entries()) {
    widths[i % columns] = Math.max(widths[i % columns]!, b.maxX - b.minX);
    heights[Math.floor(i / columns)] = Math.max(heights[Math.floor(i / columns)]!, b.maxY - b.minY);
  }
  const starts = (sizes: number[]) => {
    let at = 0;
    return sizes.map((size) => {
      const start = at;
      at += size + gap;
      return start;
    });
  };
  const xs = starts(widths),
    ys = starts(heights);
  const width = xs.at(-1)! + widths.at(-1)!,
    height = ys.at(-1)! + heights.at(-1)!;
  const left = existing ? existing.maxX + gap : -width / 2,
    top = existing ? existing.minY : -height / 2;
  return bounds.map((b, i) => {
    const x = left + xs[i % columns]! - b.minX,
      y = top + ys[Math.floor(i / columns)]! - b.minY;
    return { x, y, bounds: { minX: b.minX + x, maxX: b.maxX + x, minY: b.minY + y, maxY: b.maxY + y } };
  });
}
export function placedGeometry(g: CpGeometryTransport, p: Placement): CpGeometryTransport {
  const shift = (values: Float64Array, stride = 2) => {
    const out = values.slice();
    for (let i = 0; i < out.length; i += stride) {
      out[i] += p.x;
      out[i + 1] += p.y;
    }
    return out;
  };
  return {
    ...g,
    segEndpoints: shift(g.segEndpoints),
    auxEndpoints: shift(g.auxEndpoints),
    pointCoords: shift(g.pointCoords),
    circleData: shift(g.circleData, 3),
    tail: {
      ...g.tail,
      texts: g.tail.texts.map((t) => ({ ...t, x: coordinate(t.x) + p.x, y: coordinate(t.y) + p.y })),
    },
  };
}
