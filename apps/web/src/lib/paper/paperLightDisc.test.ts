import { describe, expect, it } from 'vitest';
import {
  LIGHT_DISC_RADIUS,
  LIGHT_DISC_SIZE,
  lightAtDiscOffset,
  lightDiscPoint,
  stepLight,
} from './paperLightDisc';
import { DEFAULT_PAPER_STYLE } from './paperStyle';

const light = (azimuth: number, elevation: number) => ({ enabled: true, azimuth, elevation });
const centre = LIGHT_DISC_SIZE / 2;

describe('lightDiscPoint', () => {
  it('puts a light on the view axis at the centre, and one on the horizon at the rim', () => {
    expect(lightDiscPoint(light(0, 90))).toEqual({ x: centre, y: centre });
    const north = lightDiscPoint(light(0, 0));
    expect(north.x).toBeCloseTo(centre, 6);
    expect(north.y).toBeCloseTo(centre - LIGHT_DISC_RADIUS, 6);
  });

  it('counts the bearing clockwise from straight up, the way a stored azimuth does', () => {
    const east = lightDiscPoint(light(90, 0));
    expect(east.x).toBeCloseTo(centre + LIGHT_DISC_RADIUS, 6);
    expect(east.y).toBeCloseTo(centre, 6);
    const south = lightDiscPoint(light(180, 0));
    expect(south.y).toBeCloseTo(centre + LIGHT_DISC_RADIUS, 6);
  });

  /** A stored style or a preset file may reach below the horizon; the disc cannot. */
  it('shows a light under the horizon on the rim, with the one that grazes it', () => {
    expect(lightDiscPoint(light(45, -30))).toEqual(lightDiscPoint(light(45, 0)));
  });
});

describe('lightAtDiscOffset', () => {
  it('reads a point back as the light that would be drawn there', () => {
    const start = light(322, 40);
    const point = lightDiscPoint(start);
    const read = lightAtDiscOffset(point.x - centre, point.y - centre);
    expect(read.azimuth).toBeCloseTo(start.azimuth, 6);
    expect(read.elevation).toBeCloseTo(start.elevation, 6);
  });

  it('is the view axis at the centre and the horizon past the rim', () => {
    expect(lightAtDiscOffset(0, 0).elevation).toBe(90);
    // Past the rim the bearing still steers; the elevation has nowhere to go.
    expect(lightAtDiscOffset(0, LIGHT_DISC_RADIUS * 3)).toEqual({ azimuth: 180, elevation: 0 });
  });

  it('wraps a bearing into the range a stored azimuth keeps', () => {
    // Up and a little left: -10° as atan2 counts it, 350° as the style does.
    const { azimuth } = lightAtDiscOffset(-5, -28.4);
    expect(azimuth).toBeGreaterThan(350);
    expect(azimuth).toBeLessThan(360);
  });
});

describe('stepLight', () => {
  it('wraps the bearing and stops the elevation at both ends', () => {
    expect(stepLight(light(2, 45), -1, 0).azimuth).toBe(357);
    expect(stepLight(light(357, 45), 1, 0).azimuth).toBe(2);
    expect(stepLight(light(0, 88), 0, 1).elevation).toBe(90);
    expect(stepLight(light(0, 2), 0, -1).elevation).toBe(0);
  });

  it('keeps everything else about the light, the switch included', () => {
    expect(stepLight({ ...DEFAULT_PAPER_STYLE.light, enabled: false }, 1, 1).enabled).toBe(false);
  });

  /** A file may carry one; the first press brings it into what the disc can show. */
  it('pulls an elevation from under the horizon into the disc’s own range', () => {
    expect(stepLight(light(0, -40), 0, -1).elevation).toBe(0);
    expect(stepLight(light(0, -40), 0, 1).elevation).toBe(5);
  });
});
