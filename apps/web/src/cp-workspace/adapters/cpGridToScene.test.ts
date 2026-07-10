import { describe, expect, it } from 'vitest';
import { cpGridLinesToStrokes, gridBoundsKey, visibleGridBounds } from './cpGridToScene';
import type { ViewTransform, Rgba } from '../renderer/types';
import type { CpModelBounds } from '../../lib/creasePatternViewport';
import type { OristudioCpGridMetadata } from '../../engine/oristudioCpTypes';

// Uniform 2 px/unit, model (0,0) at device (0,0), y-down.
const view: ViewTransform = { origin: [0, 0], ex: [2, 0], ey: [0, 2] };

describe('visibleGridBounds', () => {
  it('unprojects the canvas corners to a model rectangle (+margin)', () => {
    const b = visibleGridBounds(view, 200, 100);
    expect(b).not.toBeNull();
    // device 0..200 / 2 = model 0..100 (x), 0..50 (y), then margin + snap
    expect(b!.minX).toBeLessThanOrEqual(0);
    expect(b!.maxX).toBeGreaterThanOrEqual(100);
    expect(b!.minY).toBeLessThanOrEqual(0);
    expect(b!.maxY).toBeGreaterThanOrEqual(50);
  });

  it('returns null for a degenerate view', () => {
    expect(visibleGridBounds({ origin: [0, 0], ex: [0, 0], ey: [0, 0] }, 100, 100)).toBeNull();
  });
});

describe('gridBoundsKey', () => {
  const grid = { grid_size: 8, grid_angle: 0, grid_xa: 1, grid_ya: 1, interval_grid_size: 1 } as OristudioCpGridMetadata;
  const bounds: CpModelBounds = { minX: 0, minY: 0, maxX: 10, maxY: 10, spanX: 10, spanY: 10 };
  it('is stable for equal inputs and differs when bounds move', () => {
    expect(gridBoundsKey(bounds, grid)).toBe(gridBoundsKey({ ...bounds }, grid));
    expect(gridBoundsKey(bounds, grid)).not.toBe(gridBoundsKey({ ...bounds, minX: 1 }, grid));
  });
});

describe('cpGridLinesToStrokes', () => {
  it('packs lines with a single colour', () => {
    const color: Rgba = [0.4, 0.4, 0.4, 0.82];
    const geo = cpGridLinesToStrokes(
      [{ id: 'g', a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, major: false }],
      color
    );
    expect(geo.count).toBe(1);
    expect(Array.from(geo.a)).toEqual([0, 0]);
    expect(Array.from(geo.b)).toEqual([5, 0]);
    [0.4, 0.4, 0.4, 0.82].forEach((v, i) => expect(geo.color[i]).toBeCloseTo(v, 5));
  });
});
