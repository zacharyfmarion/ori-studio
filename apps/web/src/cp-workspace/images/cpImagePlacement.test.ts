import { describe, expect, it } from 'vitest';
import { createCpImage, type CpImage } from './cpImage';
import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import {
  cropImage,
  fitImageModelSize,
  imageAtModelPoint,
  imageContainsModelPoint,
  overlayCssDeltaToModel,
  overlayCssToModel,
  overlayModelToCss,
  resizeImage,
  snapAngle,
} from './cpImagePlacement';

// A simple view: model (0,0) at CSS (100,100), 10 CSS px per model unit, y down.
const view: CpOverlayView = {
  origin: [100, 100],
  ex: [10, 0],
  ey: [0, 10],
};

function image(overrides: Partial<CpImage> = {}): CpImage {
  return createCpImage({
    src: 'data:image/png;base64,AAAA',
    naturalWidth: 100,
    naturalHeight: 100,
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    ...overrides,
  });
}

describe('overlay projection', () => {
  it('projects model -> css and back', () => {
    const css = overlayModelToCss(view, { x: 3, y: -2 });
    expect(css).toEqual({ x: 130, y: 80 });
    const model = overlayCssToModel(view, css);
    expect(model?.x).toBeCloseTo(3);
    expect(model?.y).toBeCloseTo(-2);
  });

  it('converts a css delta to a model delta (no origin)', () => {
    const d = overlayCssDeltaToModel(view, { x: 20, y: -50 });
    expect(d?.x).toBeCloseTo(2);
    expect(d?.y).toBeCloseTo(-5);
  });

  it('returns null for a degenerate basis', () => {
    const degenerate: CpOverlayView = { origin: [0, 0], ex: [0, 0], ey: [0, 0] };
    expect(overlayCssToModel(degenerate, { x: 1, y: 1 })).toBeNull();
    expect(overlayCssDeltaToModel(degenerate, { x: 1, y: 1 })).toBeNull();
  });
});

describe('fitImageModelSize', () => {
  it('spans the target on the longer (landscape) side', () => {
    expect(fitImageModelSize(200, 100, 4)).toEqual({ width: 4, height: 2 });
  });
  it('spans the target on the longer (portrait) side', () => {
    expect(fitImageModelSize(100, 200, 4)).toEqual({ width: 2, height: 4 });
  });
});

describe('hit-testing', () => {
  it('contains points inside an axis-aligned quad', () => {
    const img = image({ center: { x: 5, y: 5 }, width: 4, height: 2 });
    expect(imageContainsModelPoint(img, { x: 5, y: 5 })).toBe(true);
    expect(imageContainsModelPoint(img, { x: 6.9, y: 5.9 })).toBe(true);
    expect(imageContainsModelPoint(img, { x: 7.1, y: 5 })).toBe(false); // beyond half-width 2
  });

  it('respects rotation', () => {
    const img = image({ center: { x: 0, y: 0 }, width: 4, height: 1, rotation: Math.PI / 2 });
    // Rotated 90°: now tall (extent 2 along y, 0.5 along x).
    expect(imageContainsModelPoint(img, { x: 0, y: 1.9 })).toBe(true);
    expect(imageContainsModelPoint(img, { x: 0, y: 2.1 })).toBe(false);
    expect(imageContainsModelPoint(img, { x: 0.6, y: 0 })).toBe(false);
  });

  it('picks the topmost image, skipping hidden and locked', () => {
    const back = image({ id: 'back', center: { x: 0, y: 0 }, width: 4, height: 4, z: 0 });
    const front = image({ id: 'front', center: { x: 0, y: 0 }, width: 4, height: 4, z: 1 });
    expect(imageAtModelPoint([back, front], { x: 0, y: 0 })?.id).toBe('front');

    const hidden = image({ id: 'hidden', center: { x: 0, y: 0 }, width: 4, height: 4, z: 2, hidden: true });
    expect(imageAtModelPoint([back, front, hidden], { x: 0, y: 0 })?.id).toBe('front');

    const locked = image({ id: 'locked', center: { x: 0, y: 0 }, width: 4, height: 4, z: 3, locked: true });
    expect(imageAtModelPoint([back, front, locked], { x: 0, y: 0 })?.id).toBe('front');
  });

  it('returns null when nothing is hit', () => {
    expect(imageAtModelPoint([image({ center: { x: 100, y: 100 } })], { x: 0, y: 0 })).toBeNull();
  });
});

describe('resizeImage', () => {
  it('resizes a corner keeping the opposite corner anchored', () => {
    // 4x2 image centered at origin; SE corner at (2,1), NW anchor at (-2,-1).
    const img = image({ center: { x: 0, y: 0 }, width: 4, height: 2 });
    // Drag SE to (4, 3): anchor stays (-2,-1) → new width 6, height 4, center (1,1).
    const r = resizeImage(img, 'se', { x: 4, y: 3 });
    expect(r.width).toBeCloseTo(6);
    expect(r.height).toBeCloseTo(4);
    expect(r.center.x).toBeCloseTo(1);
    expect(r.center.y).toBeCloseTo(1);
  });

  it('resizes only one axis for an edge handle', () => {
    const img = image({ center: { x: 0, y: 0 }, width: 4, height: 2 });
    // East edge anchored at west edge midpoint (-2,0); drag to (5, 9).
    const r = resizeImage(img, 'e', { x: 5, y: 9 });
    expect(r.width).toBeCloseTo(7); // |5 - (-2)|
    expect(r.height).toBeCloseTo(2); // unchanged
    expect(r.center.y).toBeCloseTo(0); // perpendicular position preserved
    expect(r.center.x).toBeCloseTo(1.5); // anchor -2 + width/2 * 3.5
  });

  it('preserves aspect ratio with the lock flag on a corner', () => {
    const img = image({ center: { x: 0, y: 0 }, width: 4, height: 2 }); // aspect 2:1
    const r = resizeImage(img, 'se', { x: 6, y: 2 }, true);
    // du=8, dv=3 → scale=max(8/4, 3/2)=2 → 8x4, aspect preserved.
    expect(r.width / r.height).toBeCloseTo(2);
  });

  it('clamps to a minimum extent', () => {
    const img = image({ center: { x: 0, y: 0 }, width: 4, height: 2 });
    const r = resizeImage(img, 'se', { x: -2, y: -1 }); // dragged onto the anchor
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });
});

describe('cropImage', () => {
  it('crops an edge inward, keeping pixel density and anchoring the far edge', () => {
    // 4-wide, full crop; density = 1/4 crop-fraction per model unit.
    const img = image({ center: { x: 0, y: 0 }, width: 4, height: 2 });
    // Drag east edge from x=2 in to x=1: width 3 (anchor at x=-2), crop.w 0.75.
    const r = cropImage(img, 'e', { x: 1, y: 0 });
    expect(r.width).toBeCloseTo(3);
    expect(r.height).toBeCloseTo(2);
    expect(r.crop.x).toBeCloseTo(0); // left anchored
    expect(r.crop.w).toBeCloseTo(0.75);
    expect(r.center.x).toBeCloseTo(-0.5); // anchor -2 + width/2
  });

  it('crops the left edge, anchoring the right crop coordinate', () => {
    const img = image({ center: { x: 0, y: 0 }, width: 4, height: 2 });
    // Drag west edge from x=-2 in to x=0: width 2 (anchor at x=2), crop 0.5..1.
    const r = cropImage(img, 'w', { x: 0, y: 0 });
    expect(r.width).toBeCloseTo(2);
    expect(r.crop.w).toBeCloseTo(0.5);
    expect(r.crop.x).toBeCloseTo(0.5); // right coord 1 preserved
  });

  it('clamps the crop to the source bounds', () => {
    const img = image({ center: { x: 0, y: 0 }, width: 4, height: 2 });
    // Try to drag the east edge way past the source (x=100): crop.w clamps to 1.
    const r = cropImage(img, 'e', { x: 100, y: 0 });
    expect(r.crop.x).toBeCloseTo(0);
    expect(r.crop.w).toBeCloseTo(1);
    expect(r.width).toBeCloseTo(4); // width follows clamped crop / density
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
