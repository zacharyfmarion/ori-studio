import { describe, expect, it } from 'vitest';
import { DEFAULT_CONNECTED_SPREAD } from '../cp-workspace/folded/layerSpreadSettings';
import { DEFAULT_SPATIAL_SPREAD_AMOUNT, MAX_SPATIAL_SPREAD_AMOUNT } from '../cp-workspace/folded/spatialSpreadSettings';
import { objSpreadSlider } from './objSpreadSlider';

describe('objSpreadSlider', () => {
  it('reads a flat figure’s Default spread over its height range, as its own sheet does', () => {
    const slider = objSpreadSlider('connected', 0.14);
    expect(slider).toMatchObject({ min: 0, max: 100, step: 1, value: 7, reset: DEFAULT_CONNECTED_SPREAD.amount });
    expect(slider.amountOf(64)).toBeCloseTo(1.28, 9);
    // Never past Default's range.
    expect(slider.amountOf(140)).toBeCloseTo(2, 9);
  });

  it('reads a 3D figure’s spatial spread over its whole displacement field', () => {
    const slider = objSpreadSlider('spatial', DEFAULT_SPATIAL_SPREAD_AMOUNT);
    expect(slider).toMatchObject({ min: 0, max: 100, step: 1, value: 25, reset: DEFAULT_SPATIAL_SPREAD_AMOUNT });
    expect(slider.amountOf(50)).toBe(MAX_SPATIAL_SPREAD_AMOUNT / 2);
    expect(slider.amountOf(100)).toBe(MAX_SPATIAL_SPREAD_AMOUNT);
    expect(slider.amountOf(-5)).toBe(0);
  });
});
