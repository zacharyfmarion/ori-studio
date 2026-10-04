import { describe, expect, it } from 'vitest';
import { distanceToSegment, LineHitIndex } from './lineHitIndex';

describe('distanceToSegment', () => {
  it('measures perpendicular distance within the segment', () => {
    expect(distanceToSegment(5, 3, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3);
  });
  it('clamps to endpoints beyond the segment', () => {
    expect(distanceToSegment(-4, 0, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(4);
  });
});

describe('LineHitIndex', () => {
  const segments = [
    { id: 1, a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, // long horizontal
    { id: 2, a: { x: 50, y: 20 }, b: { x: 50, y: 80 } }, // vertical
    { id: 3, a: { x: 200, y: 200 }, b: { x: 210, y: 210 } }, // far away
  ];
  const index = new LineHitIndex(segments);

  it('finds a long segment far from its midpoint (bbox binning)', () => {
    // near the far end of segment 1, nowhere near its midpoint
    expect(index.query(98, 1, 3)).toBe(1);
  });

  it('finds the nearest of overlapping candidates', () => {
    expect(index.query(50, 21, 5)).toBe(2);
  });

  it('returns -1 when nothing is within tolerance', () => {
    expect(index.query(150, 150, 3)).toBe(-1);
  });

  it('handles an empty index', () => {
    expect(new LineHitIndex([]).query(0, 0, 5)).toBe(-1);
  });

  it('handles a point cloud (zero-length segments) without exploding', () => {
    // Points indexed as zero-length segments give meanLen 0; a naive cellSize
    // collapses to ~1e-6 and query's reach blows up. This must stay fast.
    const points = [
      { id: 1, a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
      { id: 2, a: { x: 100, y: 0 }, b: { x: 100, y: 0 } },
      { id: 3, a: { x: 50, y: 50 }, b: { x: 50, y: 50 } },
    ];
    const index = new LineHitIndex(points);
    const start = performance.now();
    expect(index.query(100.5, 0.5, 3)).toBe(2);
    expect(index.query(50, 51, 3)).toBe(3);
    expect(index.query(200, 200, 3)).toBe(-1);
    expect(performance.now() - start).toBeLessThan(50);
  });

  describe('segmentsNear', () => {
    const ids = (found: { id: number }[]) => found.map((s) => s.id).sort((a, b) => a - b);

    it('returns every segment within reach, not only the nearest', () => {
      // (50, 2) is 2 from the horizontal and 18 from the vertical's end.
      expect(ids(index.segmentsNear(50, 2, 20))).toEqual([1, 2]);
      expect(ids(index.segmentsNear(50, 2, 5))).toEqual([1]);
    });

    it('finds a long segment far from its midpoint, once', () => {
      expect(ids(index.segmentsNear(99, 1, 2))).toEqual([1]);
    });

    it('returns nothing out of reach, and nothing from an empty index', () => {
      expect(index.segmentsNear(150, 150, 3)).toEqual([]);
      expect(new LineHitIndex([]).segmentsNear(0, 0, 5)).toEqual([]);
    });

    it('agrees with a flat scan wherever it is asked, at any reach', () => {
      // A grid of short and long segments, crossing one another unsplit.
      const many = Array.from({ length: 40 }, (_, i) => ({
        id: i,
        a: { x: (i * 37) % 100, y: (i * 61) % 100 },
        b: { x: ((i * 37) % 100) + (i % 3 === 0 ? 80 : 6), y: ((i * 61) % 100) + (i % 2 === 0 ? 5 : -30) },
      }));
      const grid = new LineHitIndex(many);
      const asked = [
        { x: 10, y: 10 },
        { x: 55, y: 47 },
        { x: 90, y: 3 },
        { x: -20, y: 140 },
      ];
      for (const { x, y } of asked) {
        for (const reach of [0.5, 4, 25, 400]) {
          const flat = many.filter((s) => distanceToSegment(x, y, s.a, s.b) <= reach);
          expect(ids(grid.segmentsNear(x, y, reach))).toEqual(ids(flat));
        }
      }
    });
  });

  it('finds the nearest coincident-point when tolerance dwarfs spacing', () => {
    const points = [
      { id: 1, a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
      { id: 2, a: { x: 1, y: 0 }, b: { x: 1, y: 0 } },
    ];
    const index = new LineHitIndex(points);
    // Huge tolerance would explode the grid neighbourhood → linear fallback.
    expect(index.query(0.9, 0, 1e9)).toBe(2);
  });
});
