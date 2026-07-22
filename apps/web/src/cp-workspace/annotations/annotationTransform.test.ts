import { describe, expect, it } from 'vitest';
import type { CpOverlayView } from '../CreasePatternWebglCanvas';
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
  type AnnotationBox,
} from './annotationTransform';

// A simple view: object (0,0) at CSS (100,100), 10 CSS px per unit, y down.
const view: CpOverlayView = {
  origin: [100, 100],
  ex: [10, 0],
  ey: [0, 10],
};

function box(overrides: Partial<AnnotationBox> = {}): AnnotationBox {
  return { center: { x: 0, y: 0 }, width: 4, height: 2, rotation: 0, ...overrides };
}

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

describe('boxCornersModel', () => {
  it('returns TL, TR, BR, BL of an axis-aligned box', () => {
    expect(boxCornersModel(box({ center: { x: 1, y: 1 } }))).toEqual([
      { x: -1, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
      { x: -1, y: 2 },
    ]);
  });

  it('rotates the corners about the centre', () => {
    const [tl] = boxCornersModel(box({ rotation: Math.PI / 2 }));
    // Local (-2,-1) turned a quarter turn CCW in a y-down frame -> (1,-2).
    expect(tl.x).toBeCloseTo(1);
    expect(tl.y).toBeCloseTo(-2);
  });
});

describe('boxContainsModelPoint', () => {
  it('contains points inside an axis-aligned box', () => {
    const b = box({ center: { x: 5, y: 5 } });
    expect(boxContainsModelPoint(b, { x: 5, y: 5 })).toBe(true);
    expect(boxContainsModelPoint(b, { x: 6.9, y: 5.9 })).toBe(true);
    expect(boxContainsModelPoint(b, { x: 7.1, y: 5 })).toBe(false); // beyond half-width 2
  });

  it('respects rotation', () => {
    const b = box({ width: 4, height: 1, rotation: Math.PI / 2 });
    // Turned 90°: now tall (extent 2 along y, 0.5 along x).
    expect(boxContainsModelPoint(b, { x: 0, y: 1.9 })).toBe(true);
    expect(boxContainsModelPoint(b, { x: 0, y: 2.1 })).toBe(false);
    expect(boxContainsModelPoint(b, { x: 0.6, y: 0 })).toBe(false);
  });
});

describe('resizeAnnotationBox', () => {
  it('resizes a corner keeping the opposite corner anchored', () => {
    // 4x2 box centred at origin; SE corner at (2,1), NW anchor at (-2,-1).
    // Drag SE to (4, 3): anchor stays → new width 6, height 4, centre (1,1).
    const r = resizeAnnotationBox(box(), 'se', { x: 4, y: 3 });
    expect(r.width).toBeCloseTo(6);
    expect(r.height).toBeCloseTo(4);
    expect(r.center.x).toBeCloseTo(1);
    expect(r.center.y).toBeCloseTo(1);
  });

  it('resizes only one axis for an edge handle when unlocked', () => {
    // East edge anchored at west edge midpoint (-2,0); drag to (5, 9).
    const r = resizeAnnotationBox(box(), 'e', { x: 5, y: 9 });
    expect(r.width).toBeCloseTo(7); // |5 - (-2)|
    expect(r.height).toBeCloseTo(2); // unchanged
    expect(r.center.y).toBeCloseTo(0); // perpendicular position preserved
    expect(r.center.x).toBeCloseTo(1.5); // anchor -2 + width/2
  });

  it('preserves aspect ratio with the lock flag on a corner', () => {
    const b = box(); // aspect 2:1
    const r = resizeAnnotationBox(b, 'se', { x: 6, y: 2 }, true);
    // du=8, dv=3 → scale=max(8/4, 3/2)=2 → 8x4, aspect preserved.
    expect(r.width / r.height).toBeCloseTo(2);
  });

  it('scales both axes from an EDGE handle when locked', () => {
    // Aspect lock used to be ignored on edge handles, which read as the lock
    // silently failing once proportional resize became the default for images.
    const b = box(); // 4x2, aspect 2:1
    const r = resizeAnnotationBox(b, 'e', { x: 6, y: 0 }, true);
    expect(r.width).toBeCloseTo(8); // |6 - (-2)|
    expect(r.height).toBeCloseTo(4); // driven by the same 2x factor
    expect(r.width / r.height).toBeCloseTo(2);
  });

  it('keeps the anchored edge fixed when a locked edge drag grows the passive axis', () => {
    const r = resizeAnnotationBox(box(), 'e', { x: 6, y: 0 }, true);
    // West edge was at x = -2 and must stay there: centre - width/2.
    expect(r.center.x - r.width / 2).toBeCloseTo(-2);
  });

  it('locks aspect on a vertical edge too', () => {
    const r = resizeAnnotationBox(box(), 's', { x: 0, y: 3 }, true);
    expect(r.height).toBeCloseTo(4); // |3 - (-1)|
    expect(r.width).toBeCloseTo(8); // 2x factor applied to the passive axis
  });

  it('clamps to a minimum extent', () => {
    const r = resizeAnnotationBox(box(), 'se', { x: -2, y: -1 }); // dragged onto the anchor
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });
});

describe('resizeAspectLock', () => {
  it('is always locked for objects with no non-uniform scale (folded figures)', () => {
    expect(resizeAspectLock('always', false)).toBe(true);
    expect(resizeAspectLock('always', true)).toBe(true);
  });

  it('locks images by default and lets Shift free them', () => {
    expect(resizeAspectLock('default-on', false)).toBe(true);
    expect(resizeAspectLock('default-on', true)).toBe(false);
  });

  it('leaves text boxes free by default and lets Shift lock them', () => {
    expect(resizeAspectLock('default-off', false)).toBe(false);
    expect(resizeAspectLock('default-off', true)).toBe(true);
  });
});

describe('snapAngle', () => {
  const step = Math.PI / 12; // 15°
  it('snaps to the nearest increment', () => {
    expect(snapAngle(0.02, step)).toBeCloseTo(0);
    expect(snapAngle((14 * Math.PI) / 180, step)).toBeCloseTo(step); // ~14° → 15°
    expect(snapAngle((22 * Math.PI) / 180, step)).toBeCloseTo(step); // ~22° → 15°
    expect(snapAngle((24 * Math.PI) / 180, step)).toBeCloseTo(2 * step); // ~24° → 30°
  });
});
