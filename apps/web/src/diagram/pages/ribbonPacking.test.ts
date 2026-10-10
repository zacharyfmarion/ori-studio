import { describe, expect, it } from 'vitest';
import { packRibbon, rectangle, ribbonGaps, type PackingShape, type Polygon } from './ribbonPacking';
function diamond(size: number, ratio: number): PackingShape {
  const w = size * Math.min(1, ratio),
    h = size * Math.min(1, 1 / ratio);
  const picture = [
    { x: 0, y: -h / 2 },
    { x: w / 2, y: 0 },
    { x: 0, y: h / 2 },
    { x: -w / 2, y: 0 },
  ];
  return {
    picture,
    polygons: [picture, rectangle(-w / 2 - 6, -h / 2, 4, 6), rectangle(-w * 0.4, h / 2 + 3, w * 0.8, 7)],
    bounds: { x: -w / 2 - 6, y: -h / 2, w: w + 6, h: h + 10 },
  };
}
// Check physical edge distances independently of the packer's separating-axis solver.
function edgeDistance(a: Polygon, b: Polygon): number {
  const pointToEdge = (p: Polygon[number], q: Polygon[number], r: Polygon[number]) => {
    const dx = r.x - q.x,
      dy = r.y - q.y;
    const t = Math.max(0, Math.min(1, ((p.x - q.x) * dx + (p.y - q.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.x - q.x - t * dx, p.y - q.y - t * dy);
  };
  return Math.min(
    ...a.flatMap((p) => b.map((q, i) => pointToEdge(p, q, b[(i + 1) % b.length]!))),
    ...b.flatMap((p) => a.map((q, i) => pointToEdge(p, q, a[(i + 1) % a.length]!))),
  );
}
describe('balanced ribbon packing', () => {
  for (const count of [7, 12])
    for (const ratio of [0.714, 1, 1.7])
      it(`${count} pictures at ${ratio} fill the paper with bounded visible gaps`, () => {
        const packed = packRibbon({
          count,
          area: { x: 15, y: 20, w: 180, h: 253 },
          shape: (_, size) => diamond(size, ratio),
          oddRows: true,
          up: false,
        });
        expect(packed).not.toBeNull();
        if (!packed) return;
        const polygons = packed.shapes.map((shape, i) =>
          shape.polygons.map((polygon) =>
            polygon.map((p) => ({ x: p.x + packed.stops[i]!.x, y: p.y + packed.stops[i]!.y })),
          ),
        );
        for (const [i, group] of polygons.entries())
          for (const polygon of group) {
            for (const p of polygon) {
              expect(p.x).toBeGreaterThanOrEqual(14.9);
              expect(p.x).toBeLessThanOrEqual(195.1);
              expect(p.y).toBeGreaterThanOrEqual(19.9);
              expect(p.y).toBeLessThanOrEqual(273.1);
            }
            for (const otherGroup of polygons.slice(i + 1))
              for (const other of otherGroup) expect(edgeDistance(polygon, other)).toBeGreaterThanOrEqual(5.9);
          }
        const gaps = ribbonGaps(packed.stops, packed.shapes);
        expect(Math.max(...gaps) / Math.min(...gaps)).toBeLessThanOrEqual(1.51);
        expect(packed.stops[0]!.rightToLeft).toBe(false);
        expect(packed.rows % 2).toBe(1);
        expect(packed.size).toBeGreaterThan(count === 7 ? 47.5 : ratio < 1 ? 44 : ratio > 1 ? 38 : 30);
      });
});

it('keeps caption-wrap identities separate even when their measured probe sizes agree', () => {
  const shape = (threshold: number) => (_: number, size: number): PackingShape => {
    const base = diamond(size, 1);
    const captionHeight = size < threshold ? 12 : 7;
    return { ...base, polygons: [...base.polygons.slice(0, 2), rectangle(-size * .4, size / 2 + 3, size * .8, captionHeight)],
      bounds: { ...base.bounds, h: size + 3 + captionHeight } };
  };
  const common = {count: 7, area: {x:15,y:20,w:180,h:253}, oddRows: true, up: false};
  const late = packRibbon({...common, contentKey: 'wraps-later', shape: shape(55)})!;
  const early = packRibbon({...common, contentKey: 'wraps-earlier', shape: shape(45)})!;
  expect(shape(55)(0,40)).toEqual(shape(45)(0,40));
  expect(shape(55)(0,60)).toEqual(shape(45)(0,60));
  expect(early.shapes[0]!.bounds.h - early.size).toBe(10);
  expect(late.shapes[0]!.bounds.h - late.size).toBe(15);
});
