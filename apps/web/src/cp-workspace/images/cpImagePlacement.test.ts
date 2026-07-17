import { describe, expect, it } from 'vitest';
import { createCpImage, type CpImage } from './cpImage';
import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import {
  fitImageModelSize,
  imageAtModelPoint,
  imageContainsModelPoint,
  overlayCssDeltaToModel,
  overlayCssToModel,
  overlayModelToCss,
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
