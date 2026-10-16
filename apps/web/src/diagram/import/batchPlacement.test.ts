import { describe, it, expect } from 'vitest';
import { batchPlacement } from './batchPlacement';
const square = { minX: -200, minY: -200, maxX: 200, maxY: 200 };
describe('batch placement', () => {
  it('centers 205 sheets in a 15 by 14 grid without changing scale', () => {
    const placed = batchPlacement(Array(205).fill(square), null);
    expect(placed).toHaveLength(205);
    expect(placed[0]!.bounds).toEqual({ minX: -3700, maxX: -3300, minY: -3450, maxY: -3050 });
    expect(placed[15]!.bounds.minY).toBe(placed[0]!.bounds.minY + 500);
    for (const p of placed) expect(p.bounds.maxX - p.bounds.minX).toBe(400);
  });
  it('packs variable extents to the right of existing content', () => {
    const placed = batchPlacement(
      [square, { minX: 0, maxX: 900, minY: 0, maxY: 100 }, square],
      { minX: -100, maxX: 1000, minY: -300, maxY: 300 },
      2,
      100,
    );
    expect(placed[0]!.bounds.minX).toBe(1100);
    expect(placed[1]!.bounds.minX).toBe(1600);
    expect(placed[2]!.bounds.minY).toBe(200);
  });
  it('rejects touching sheets and invalid layouts', () => {
    expect(() => batchPlacement([square], null, 1, 0)).toThrow();
    expect(() => batchPlacement([square], null, NaN)).toThrow();
  });
});
