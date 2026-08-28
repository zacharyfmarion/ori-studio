import { describe, expect, it } from 'vitest';
import {
  CP_MAX_WIDTH_BOOST,
  WIDTH_ZOOM_EXPONENT,
  cpSizingScales,
} from './cpSizingScales';

const RATIO = 2;

describe('cpSizingScales', () => {
  it('sits at exactly the device pixel ratio when the camera is at fit', () => {
    const scales = cpSizingScales({ camZoom: 0.8, fitZoom: 0.8, ratio: RATIO });
    expect(scales.widthBoost).toBe(1);
    expect(scales.markerScalePx).toBe(RATIO);
    expect(scales.pointScalePx).toBe(RATIO);
  });

  it('grows gently when zoomed in past fit', () => {
    const scales = cpSizingScales({ camZoom: 8, fitZoom: 0.8, ratio: RATIO });
    // 10x past fit -> 10^0.15
    expect(scales.widthBoost).toBeCloseTo(Math.pow(10, WIDTH_ZOOM_EXPONENT), 10);
    expect(scales.widthBoost).toBeGreaterThan(1);
    expect(scales.widthBoost).toBeLessThan(1.5);
  });

  it('shrinks markers and vertices when zoomed out past fit', () => {
    const scales = cpSizingScales({ camZoom: 0.08, fitZoom: 0.8, ratio: RATIO });
    expect(scales.widthBoost).toBe(1);
    expect(scales.markerScalePx).toBeLessThan(RATIO);
    expect(scales.pointScalePx).toBeLessThan(RATIO);
    // Vertices shrink in lockstep with the content, markers only partially, so
    // vertices are always the smaller of the two when zoomed out.
    expect(scales.pointScalePx).toBeLessThan(scales.markerScalePx);
  });

  it('leaves deep legitimate zoom untouched by the ceiling', () => {
    // 1000x past fit is deeper than ordinary editing and still under the cap.
    const scales = cpSizingScales({ camZoom: 800, fitZoom: 0.8, ratio: RATIO });
    expect(scales.widthBoost).toBeLessThan(CP_MAX_WIDTH_BOOST);
    expect(scales.widthBoost).toBeCloseTo(Math.pow(1000, WIDTH_ZOOM_EXPONENT), 10);
  });

  it('bounds the boost when one stray coordinate poisons the fit zoom', () => {
    // The real numbers from bisector_bug_broken_state.osf: a vertex at ~3.4e14
    // drives the document bbox, so fitUserCamera returns ~1.6e-12 while the user
    // is still at 86% zoom. Unbounded, this term reached ~57x.
    const scales = cpSizingScales({ camZoom: 0.86, fitZoom: 1.6e-12, ratio: RATIO });
    expect(scales.widthBoost).toBe(CP_MAX_WIDTH_BOOST);
    expect(scales.markerScalePx).toBe(RATIO * CP_MAX_WIDTH_BOOST);
    expect(scales.pointScalePx).toBe(RATIO * CP_MAX_WIDTH_BOOST);
  });

  it('never returns a non-finite scale, whatever the document says', () => {
    for (const fitZoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MIN_VALUE]) {
      const scales = cpSizingScales({ camZoom: 0.86, fitZoom, ratio: RATIO });
      expect(Number.isFinite(scales.widthBoost)).toBe(true);
      expect(Number.isFinite(scales.markerScalePx)).toBe(true);
      expect(Number.isFinite(scales.pointScalePx)).toBe(true);
      expect(scales.widthBoost).toBeGreaterThanOrEqual(1);
      expect(scales.widthBoost).toBeLessThanOrEqual(CP_MAX_WIDTH_BOOST);
    }
  });

  it('falls back to fit when the camera zoom itself is unusable', () => {
    const scales = cpSizingScales({ camZoom: Number.NaN, fitZoom: Number.NaN, ratio: RATIO });
    expect(scales.widthBoost).toBe(1);
    expect(scales.markerScalePx).toBe(RATIO);
  });
});
