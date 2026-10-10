import { describe, expect, it } from 'vitest';
import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import * as transformBox from '../../lib/transformBox';
import {
  boxCornersModel,
  boxContainsModelPoint,
  overlayCssDeltaToModel,
  overlayCssPerModel,
  overlayCssToModel,
  overlayModelToCss,
  resizeAnnotationBox,
  resizeAspectLock,
  snapAngle,
  uprightRotationForView,
} from './annotationTransform';

// A simple view: object (0,0) at CSS (100,100), 10 CSS px per unit, y down.
const view: CpOverlayView = {
  origin: [100, 100],
  ex: [10, 0],
  ey: [0, 10],
};

describe('overlay projection', () => {
  it('projects object space -> css and back', () => {
    const css = overlayModelToCss(view, { x: 3, y: -2 });
    expect(css).toEqual({ x: 130, y: 80 });
    const model = overlayCssToModel(view, css);
    expect(model?.x).toBeCloseTo(3);
    expect(model?.y).toBeCloseTo(-2);
  });

  it('converts a css delta to an object-space delta (no origin)', () => {
    const d = overlayCssDeltaToModel(view, { x: 20, y: -50 });
    expect(d?.x).toBeCloseTo(2);
    expect(d?.y).toBeCloseTo(-5);
  });

  it('reports the linear css-per-unit scale', () => {
    expect(overlayCssPerModel(view)).toBeCloseTo(10);
  });

  it('returns null for a degenerate basis', () => {
    const degenerate: CpOverlayView = { origin: [0, 0], ex: [0, 0], ey: [0, 0] };
    expect(overlayCssToModel(degenerate, { x: 1, y: 1 })).toBeNull();
    expect(overlayCssDeltaToModel(degenerate, { x: 1, y: 1 })).toBeNull();
  });
});

describe('the box math', () => {
  it('is lib/transformBox.ts\'s, re-exported under the names this canvas has always used', () => {
    // Moved there in Diagram Revision 3 so the Diagram's transform box shares it; its tests went with it.
    expect(boxCornersModel).toBe(transformBox.boxCornersModel);
    expect(boxContainsModelPoint).toBe(transformBox.boxContainsModelPoint);
    expect(resizeAnnotationBox).toBe(transformBox.resizeAnnotationBox);
    expect(resizeAspectLock).toBe(transformBox.resizeAspectLock);
    expect(snapAngle).toBe(transformBox.snapAngle);
  });
});

describe('uprightRotationForView', () => {
  /** An overlay view for a camera turned by `angle` (model -> CSS). */
  const viewAt = (angle: number) => ({
    origin: [0, 0] as const,
    ex: [Math.cos(angle), Math.sin(angle)] as const,
    ey: [-Math.sin(angle), Math.cos(angle)] as const,
  });

  it('is zero for a square view', () => {
    expect(uprightRotationForView(viewAt(0))).toBeCloseTo(0);
  });

  it('is the negation of the view angle, so an object anchored to the paper reads upright', () => {
    for (const angle of [Math.PI / 6, Math.PI / 4, -Math.PI / 3, 2.1]) {
      expect(uprightRotationForView(viewAt(angle))).toBeCloseTo(-angle);
    }
  });

  it('round-trips: a box at this rotation has zero screen angle', () => {
    // The property that matters, stated without reference to the implementation.
    for (const angle of [0, Math.PI / 8, Math.PI / 2, -1.2]) {
      const view = viewAt(angle);
      const rotation = uprightRotationForView(view);
      const centre = overlayModelToCss(view, { x: 0, y: 0 });
      const tip = overlayModelToCss(view, { x: Math.cos(rotation), y: Math.sin(rotation) });
      expect(Math.atan2(tip.y - centre.y, tip.x - centre.x)).toBeCloseTo(0);
    }
  });

  it('is exact under a non-uniform basis rather than assuming a pure rotation', () => {
    const stretched = { origin: [0, 0] as const, ex: [0, 3] as const, ey: [-1, 0] as const };
    const rotation = uprightRotationForView(stretched);
    const centre = overlayModelToCss(stretched, { x: 0, y: 0 });
    const tip = overlayModelToCss(stretched, { x: Math.cos(rotation), y: Math.sin(rotation) });
    expect(Math.atan2(tip.y - centre.y, tip.x - centre.x)).toBeCloseTo(0);
  });

  it('falls back to square for a missing or degenerate view', () => {
    expect(uprightRotationForView(null)).toBe(0);
    expect(uprightRotationForView({ origin: [0, 0], ex: [0, 0], ey: [0, 0] })).toBe(0);
  });
});
