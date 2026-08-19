import { describe, expect, it } from 'vitest';
import { createCpImage, type CpImage } from './cpImage';
import {
  cropImage,
  fitImageModelSize,
  imageAtModelPoint,
  imageContainsModelPoint,
} from './cpImagePlacement';

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

    const hidden = image({
      id: 'hidden',
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      z: 2,
      hidden: true,
    });
    expect(imageAtModelPoint([back, front, hidden], { x: 0, y: 0 })?.id).toBe('front');

    const locked = image({
      id: 'locked',
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      z: 3,
      locked: true,
    });
    expect(imageAtModelPoint([back, front, locked], { x: 0, y: 0 })?.id).toBe('front');
  });

  it('returns null when nothing is hit', () => {
    expect(imageAtModelPoint([image({ center: { x: 100, y: 100 } })], { x: 0, y: 0 })).toBeNull();
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
