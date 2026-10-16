import { describe, it, expect } from 'vitest';
import { BoundsIndex } from './boundsIndex';
describe('BoundsIndex', () => {
  it('preserves brute-force candidates including overlapping boxes, boundaries and tolerance', () => {
    const bounds = Array.from({ length: 205 }, (_, i) => ({
      minX: (i % 15) * 500,
      minY: Math.floor(i / 15) * 500,
      maxX: (i % 15) * 500 + 400,
      maxY: Math.floor(i / 15) * 500 + 400,
    }));
    bounds.push({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 });
    const index = new BoundsIndex(bounds);
    for (let x = -1; x <= 8000; x += 97)
      for (let y = -1; y <= 7500; y += 131)
        expect(index.at(x, y, 1).sort((a, b) => a - b)).toEqual(
          bounds.flatMap((b, i) =>
            x >= b.minX - 1 && x <= b.maxX + 1 && y >= b.minY - 1 && y <= b.maxY + 1 ? [i] : [],
          ),
        );
  });
  it('returns exactly the brute-force intersecting pairs for disjoint sheets and overlapping slivers', () => {
    const bounds = Array.from({ length: 205 }, (_, i) => ({
      minX: (i % 15) * 500,
      minY: Math.floor(i / 15) * 500,
      maxX: (i % 15) * 500 + 400,
      maxY: Math.floor(i / 15) * 500 + 400,
    }));
    bounds.push({ minX: 390, minY: -1, maxX: 510, maxY: 7100 });
    const index = new BoundsIndex(bounds);
    for (const a of bounds)
      expect(index.intersecting(a).sort((x, y) => x - y)).toEqual(
        bounds.flatMap((b, i) =>
          a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY ? [i] : [],
        ),
      );
  });
});
