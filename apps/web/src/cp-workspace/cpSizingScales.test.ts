import { describe, expect, it } from 'vitest';
import {
  CP_MAX_WIDTH_BOOST,
  VERTEX_SPACING_SAMPLE_CAP,
  WIDTH_ZOOM_EXPONENT,
  cpSizingScales,
  cpVertexCrowding,
  cpVertexSpacingModel,
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

describe('cpVertexCrowding', () => {
  // Both CP surfaces render through this, and the numbers below are the same
  // ones the editor has always used — the point of the shared module is that a
  // second surface cannot quietly pick different ones.
  it('keeps dots at full opacity while they are far apart', () => {
    const { crowding, pointOpacity, pointRingScale } = cpVertexCrowding({
      vertexSpacingModel: 100,
      pointSize: 1,
      modelPxPerUnit: 1,
      ratio: 1,
    });
    expect(crowding).toBeCloseTo(0.032, 6);
    expect(pointOpacity).toBe(1);
    expect(pointRingScale).toBe(1);
  });

  it('fades them out entirely once they touch', () => {
    // The Tokyo Skytree case: a 3.92-unit median crease at the fit camera is a
    // 4.8 CSS px pitch under a 3.2 px dot.
    const { crowding, pointOpacity, pointRingScale } = cpVertexCrowding({
      vertexSpacingModel: 3.922,
      pointSize: 1,
      modelPxPerUnit: 1.2238,
      ratio: 1,
    });
    expect(crowding).toBeGreaterThan(0.45);
    expect(pointOpacity).toBe(0);
    expect(pointRingScale).toBe(0);
  });

  it('drops the ring before the dot', () => {
    const mid = cpVertexCrowding({
      vertexSpacingModel: 20,
      pointSize: 1,
      modelPxPerUnit: 1,
      ratio: 1,
    });
    expect(mid.crowding).toBeCloseTo(0.16, 6);
    expect(mid.pointRingScale).toBeLessThan(mid.pointOpacity);
  });

  it('is a pure CSS-px ratio, so display density cannot change it', () => {
    const at1 = cpVertexCrowding({ vertexSpacingModel: 10, pointSize: 1, modelPxPerUnit: 1, ratio: 1 });
    const at2 = cpVertexCrowding({ vertexSpacingModel: 10, pointSize: 1, modelPxPerUnit: 2, ratio: 2 });
    expect(at2.crowding).toBeCloseTo(at1.crowding, 12);
  });

  it('shows every dot rather than none when there is nothing to measure', () => {
    for (const spacing of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { pointOpacity } = cpVertexCrowding({
        vertexSpacingModel: spacing,
        pointSize: 1,
        modelPxPerUnit: 1,
        ratio: 1,
      });
      expect(pointOpacity).toBe(1);
    }
  });
});

describe('cpVertexSpacingModel', () => {
  it('takes the median length and skips degenerate creases', () => {
    const lengths = [0, 1, 2, 3, 1e-12];
    expect(cpVertexSpacingModel((i) => lengths[i], lengths.length)).toBe(2);
  });

  it('falls back when nothing is measurable', () => {
    expect(cpVertexSpacingModel(() => 0, 0, 25)).toBe(25);
    expect(cpVertexSpacingModel(() => 0, 4, 25)).toBe(25);
  });

  it('strides rather than reading every crease past the sample cap', () => {
    let reads = 0;
    const count = VERTEX_SPACING_SAMPLE_CAP * 8;
    cpVertexSpacingModel(() => {
      reads += 1;
      return 1;
    }, count);
    expect(reads).toBeLessThanOrEqual(VERTEX_SPACING_SAMPLE_CAP);
  });
});
