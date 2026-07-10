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
});
