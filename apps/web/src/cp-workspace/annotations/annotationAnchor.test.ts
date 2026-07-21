import { describe, expect, it } from 'vitest';
import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import { annotationScreenRect, boundingScreenRect, quadCornersModel } from './annotationAnchor';

// model (0,0) at CSS (100,100), 10 CSS px per model unit, y down.
const view: CpOverlayView = {
  origin: [100, 100],
  ex: [10, 0],
  ey: [0, 10],
};

describe('quadCornersModel', () => {
  it('returns TL,TR,BR,BL for an unrotated box', () => {
    const corners = quadCornersModel({ x: 0, y: 0 }, 4, 2, 0);
    expect(corners).toEqual([
      { x: -2, y: -1 },
      { x: 2, y: -1 },
      { x: 2, y: 1 },
      { x: -2, y: 1 },
    ]);
  });

  it('rotates corners about the center', () => {
    const corners = quadCornersModel({ x: 0, y: 0 }, 2, 2, Math.PI / 2);
    // 90° CCW: local +x maps toward +y.
    expect(corners[0].x).toBeCloseTo(1);
    expect(corners[0].y).toBeCloseTo(-1);
    expect(corners[2].x).toBeCloseTo(-1);
    expect(corners[2].y).toBeCloseTo(1);
  });
});

describe('boundingScreenRect', () => {
  it('projects corners to a viewport-space rect including the container offset', () => {
    const corners = quadCornersModel({ x: 0, y: 0 }, 4, 2, 0);
    const rect = boundingScreenRect(view, { left: 50, top: 20 }, corners);
    // model x∈[-2,2] -> css x∈[80,120] -> viewport [130,170]; width 40.
    // model y∈[-1,1] -> css y∈[90,110] -> viewport [110,130]; height 20.
    expect(rect).toEqual({ left: 130, top: 110, width: 40, height: 20 });
  });

  it('returns null for no corners', () => {
    expect(boundingScreenRect(view, { left: 0, top: 0 }, [])).toBeNull();
  });

  it('bounds a rotated box by its extremes', () => {
    const rect = annotationScreenRect(view, { left: 0, top: 0 }, {
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      rotation: Math.PI / 4,
    });
    // A 2×2 square rotated 45° spans ±√2 in model space on both axes.
    const half = Math.SQRT2 * 10;
    expect(rect?.left).toBeCloseTo(100 - half);
    expect(rect?.width).toBeCloseTo(half * 2);
  });
});
