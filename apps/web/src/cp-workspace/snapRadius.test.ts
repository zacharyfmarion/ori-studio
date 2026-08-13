import { describe, expect, it } from 'vitest';
import {
  CP_LINE_HIT_RATIO,
  CP_MIN_SNAP_RADIUS_CSS,
  CP_MODEL_TO_CSS,
  CP_POINT_HIT_RATIO,
  CP_SNAP_RATIO,
  cpSnapRadiusModel,
} from './snapRadius';
import { CP_DEFAULT_SNAP_RADIUS } from '../lib/cpSnapRadiusSetting';

/** What the user would feel: the radius as a distance on screen. */
const screenPx = (model: number, zoom: number) => model * CP_MODEL_TO_CSS * zoom;

describe('cpSnapRadiusModel', () => {
  it('means what Oriedita means by the same number', () => {
    // The whole point of expressing the setting in model units: at 100% zoom a
    // radius of 10 is 10 model units, exactly as `mouseRadius = 10` is upstream.
    expect(cpSnapRadiusModel(CP_DEFAULT_SNAP_RADIUS, 1)).toBeCloseTo(10, 12);
  });

  it('holds the radius constant on screen while zoomed in, as upstream does', () => {
    // Upstream: mouseRadius / max(1, zoom). Model shrinks, screen distance does not.
    expect(cpSnapRadiusModel(10, 2)).toBeCloseTo(5, 12);
    expect(cpSnapRadiusModel(10, 4)).toBeCloseTo(2.5, 12);
    expect(screenPx(cpSnapRadiusModel(10, 2), 2)).toBeCloseTo(screenPx(cpSnapRadiusModel(10, 4), 4), 12);
  });

  it('holds it constant in model units just below 100%, until the floor takes over', () => {
    // Upstream stops dividing at zoom 1, so the model radius plateaus...
    expect(cpSnapRadiusModel(10, 0.9)).toBeCloseTo(10, 12);
    // ...until the on-screen distance would drop under the floor, which is at
    // z = CP_MIN_SNAP_RADIUS_CSS / (radius * CP_MODEL_TO_CSS) = 1/1.47.
    const crossover = CP_MIN_SNAP_RADIUS_CSS / (10 * CP_MODEL_TO_CSS);
    expect(cpSnapRadiusModel(10, crossover + 1e-6)).toBeCloseTo(10, 6);
    expect(cpSnapRadiusModel(10, crossover - 0.05)).toBeGreaterThan(10);
  });

  it('stops the zoomed-out decay at the floor', () => {
    // The floor exists because our canvas is ~10 paper widths and fit-zoom opens
    // large documents far out, where upstream's law alone decays to a pixel or two.
    for (const zoom of [0.5, 0.25, 0.1, 0.05, 0.01]) {
      expect(screenPx(cpSnapRadiusModel(10, zoom), zoom)).toBeGreaterThanOrEqual(
        CP_MIN_SNAP_RADIUS_CSS - 1e-9
      );
    }
  });

  it('lets a tight setting stay tight — the floor never overrides the user', () => {
    // A flat floor would resolve every radius below ~7 to the same 10 CSS px,
    // so the bottom of the slider would do nothing and "less grabby snapping",
    // the thing this setting exists for, would be unreachable.
    const tightAt100 = screenPx(cpSnapRadiusModel(2, 1), 1);
    expect(tightAt100).toBeCloseTo(2 * CP_MODEL_TO_CSS, 9);
    expect(tightAt100).toBeLessThan(CP_MIN_SNAP_RADIUS_CSS);
    expect(cpSnapRadiusModel(2, 1)).toBeLessThan(cpSnapRadiusModel(5, 1));
    expect(cpSnapRadiusModel(5, 1)).toBeLessThan(cpSnapRadiusModel(10, 1));

    // ...and it still stops decaying when zoomed out, at its own 100% feel.
    for (const zoom of [0.25, 0.05]) {
      expect(screenPx(cpSnapRadiusModel(2, zoom), zoom)).toBeCloseTo(tightAt100, 9);
    }
  });

  it('preserves the 1 / 0.8 / 0.6 spread at every zoom, on both sides of the floor', () => {
    for (const zoom of [4, 1, 0.68, 0.25, 0.01]) {
      const snap = cpSnapRadiusModel(10, zoom, CP_SNAP_RATIO);
      const line = cpSnapRadiusModel(10, zoom, CP_LINE_HIT_RATIO);
      const point = cpSnapRadiusModel(10, zoom, CP_POINT_HIT_RATIO);

      expect(line / snap).toBeCloseTo(CP_LINE_HIT_RATIO, 12);
      expect(point / snap).toBeCloseTo(CP_POINT_HIT_RATIO, 12);
      // Ordering is what keeps a crease from shadowing its own vertex.
      expect(snap).toBeGreaterThan(line);
      expect(line).toBeGreaterThan(point);
    }
  });

  it('scales with the user setting', () => {
    expect(cpSnapRadiusModel(2, 1)).toBeCloseTo(2, 12);
    expect(cpSnapRadiusModel(100, 1)).toBeCloseTo(100, 12);
    expect(cpSnapRadiusModel(100, 4)).toBeCloseTo(25, 12);
  });

  it('falls back rather than returning nonsense for degenerate input', () => {
    expect(cpSnapRadiusModel(10, 0)).toBeCloseTo(cpSnapRadiusModel(10, 1), 12);
    expect(cpSnapRadiusModel(10, Number.NaN)).toBeCloseTo(cpSnapRadiusModel(10, 1), 12);
    expect(cpSnapRadiusModel(10, -2)).toBeCloseTo(cpSnapRadiusModel(10, 1), 12);
    expect(cpSnapRadiusModel(Number.NaN, 1)).toBeCloseTo(cpSnapRadiusModel(CP_DEFAULT_SNAP_RADIUS, 1), 12);
    expect(cpSnapRadiusModel(0, 1)).toBeCloseTo(cpSnapRadiusModel(CP_DEFAULT_SNAP_RADIUS, 1), 12);
    expect(Number.isFinite(cpSnapRadiusModel(10, Number.POSITIVE_INFINITY))).toBe(true);
  });
});
