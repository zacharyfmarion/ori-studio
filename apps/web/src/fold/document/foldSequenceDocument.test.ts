import { describe, expect, it } from 'vitest';

import { builtInPaperPreset } from '../../lib/paper/paperPresets';
import {
  createFoldSequence,
  markPoints,
  rectangleShape,
  regularPolygonShape,
  turnKindOf,
  type SheetPoint,
} from './foldSequenceDocument';
import { sequentialIds } from './foldSequence.fixtures';

describe('paper shapes', () => {
  it('normalises a rectangle to longer side 1, either way up', () => {
    expect(rectangleShape(2, 1)).toEqual({ kind: 'rectangle', aspect: [1, 0.5] });
    expect(rectangleShape(3, 4)).toEqual({ kind: 'rectangle', aspect: [0.75, 1] });
    for (const [w, h] of [[0, 1], [1, -1], [Number.NaN, 1], [1, Number.POSITIVE_INFINITY]]) {
      expect(rectangleShape(w, h), `${w}:${h}`).toBeNull();
    }
  });

  it('places a regular polygon in the unit frame, its first vertex at the bottom', () => {
    for (let sides = 3; sides <= 8; sides += 1) {
      const shape = regularPolygonShape(sides);
      if (shape?.kind !== 'polygon') throw new Error(`no polygon for ${sides}`);
      const { points } = shape;
      expect(points).toHaveLength(sides);
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      expect(Math.min(...xs)).toBeCloseTo(0, 12);
      expect(Math.min(...ys)).toBeCloseTo(0, 12);
      expect(Math.max(Math.max(...xs), Math.max(...ys))).toBeCloseTo(1, 12);
      // The first vertex is the lowest point, and the ring turns counter-clockwise.
      expect(points[0][1]).toBeCloseTo(0, 12);
      const area = points.reduce((sum, [x, y], k) => {
        const [nx, ny] = points[(k + 1) % sides];
        return sum + x * ny - nx * y;
      }, 0);
      expect(area).toBeGreaterThan(0);
    }
    for (const sides of [2, 9, 4.5]) expect(regularPolygonShape(sides)).toBeNull();
  });
});

describe('markPoints', () => {
  const near = (points: SheetPoint[], expected: [number, number][]) => {
    expect(points).toHaveLength(expected.length);
    points.forEach(([x, y], k) => {
      expect(x).toBeCloseTo(expected[k][0], 12);
      expect(y).toBeCloseTo(expected[k][1], 12);
    });
  };

  it('divides a segment into equal parts', () => {
    near(markPoints({ id: 'm', from: [0, 0], to: [1, 0.5], divide: { mode: 'count', parts: 4 } }), [
      [0.25, 0.125],
      [0.5, 0.25],
      [0.75, 0.375],
    ]);
  });

  it('places the point at an exact ratio from `from`', () => {
    // 1 : √2 from the left end.
    const ratio = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 2 };
    near(markPoints({ id: 'm', from: [0, 0], to: [1, 0], divide: { mode: 'ratio', ratio } }), [[1 / (1 + Math.SQRT2), 0]]);
  });
});

describe('the rest of the vocabulary', () => {
  it('spells turns as the Diagram’s turn entries do', () => {
    expect(turnKindOf({ kind: 'turn', axis: 'horizontal' })).toEqual({ kind: 'turn-over', axis: 'horizontal' });
    expect(turnKindOf({ kind: 'rotate', rotate: { amount: 'eighth', direction: 'cw' } })).toEqual({
      kind: 'rotate',
      rotate: { amount: 'eighth', direction: 'cw' },
    });
  });

  it('starts a sequence at the square, front up, with no steps, in the Diagram style', () => {
    expect(createFoldSequence(undefined, 'Crane', sequentialIds())).toEqual({
      formatVersion: 2,
      id: 'fold-1',
      title: 'Crane',
      paper: { shape: { kind: 'square' }, startSide: 'front' },
      style: { preset: 'diagram', style: builtInPaperPreset('diagram').style },
      steps: [],
    });
  });
});
