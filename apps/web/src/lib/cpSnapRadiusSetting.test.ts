import { describe, expect, it } from 'vitest';
import {
  clampCpSnapRadius,
  CP_DEFAULT_SNAP_RADIUS,
  CP_MAX_SNAP_RADIUS,
  CP_MIN_SNAP_RADIUS,
} from './cpSnapRadiusSetting';

describe('clampCpSnapRadius', () => {
  it('keeps a value inside Oriedita’s slider bounds', () => {
    expect(clampCpSnapRadius(CP_MIN_SNAP_RADIUS)).toBe(2);
    expect(clampCpSnapRadius(CP_DEFAULT_SNAP_RADIUS)).toBe(10);
    expect(clampCpSnapRadius(CP_MAX_SNAP_RADIUS)).toBe(100);
  });

  it('clamps out-of-range values to the nearest bound', () => {
    expect(clampCpSnapRadius(0)).toBe(CP_MIN_SNAP_RADIUS);
    expect(clampCpSnapRadius(-40)).toBe(CP_MIN_SNAP_RADIUS);
    expect(clampCpSnapRadius(1000)).toBe(CP_MAX_SNAP_RADIUS);
  });

  it('rounds to the integer step upstream’s slider uses', () => {
    expect(clampCpSnapRadius(10.4)).toBe(10);
    expect(clampCpSnapRadius(10.5)).toBe(11);
  });

  it('degrades unreadable input to the default, not to the minimum', () => {
    // The minimum would be the tightest radius there is, which is the setting
    // most likely to look broken to whoever hit the bad value.
    expect(clampCpSnapRadius(Number.NaN)).toBe(CP_DEFAULT_SNAP_RADIUS);
    expect(clampCpSnapRadius(Number.POSITIVE_INFINITY)).toBe(CP_DEFAULT_SNAP_RADIUS);
  });
});
