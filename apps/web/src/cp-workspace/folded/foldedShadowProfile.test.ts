import { describe, expect, it } from 'vitest';
import {
  SHADOW_BAND_HALF_WIDTH_RATIO,
  SHADOW_BLUR_SIGMA_RATIO,
  SHADOW_PROFILE_GLSL,
  SHADOW_REACH_RATIO,
  SHADOW_STEP_CAP,
  erf,
  shadowProfile,
  shadowStepReach,
  shadowStepStrength,
  shadowSvgStroke,
} from './foldedShadowProfile';

/**
 * What the SVG export draws, computed the slow way: a band of half-width `h`
 * convolved with a Gaussian of `sigma`, sampled at `distance` from its centre
 * line. The canvas has to agree with this, since it claims to be the same
 * picture.
 */
function blurredBandByQuadrature(distance: number, h: number, sigma: number): number {
  const steps = 4000;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const u = -h + ((i + 0.5) / steps) * 2 * h;
    const x = distance - u;
    sum += Math.exp(-(x * x) / (2 * sigma * sigma));
  }
  return (sum * (2 * h)) / steps / (sigma * Math.sqrt(2 * Math.PI));
}

describe('erf', () => {
  it('matches tabulated values to the approximation\'s stated accuracy', () => {
    expect(erf(0)).toBeCloseTo(0, 8);
    expect(erf(0.5)).toBeCloseTo(0.5204998778, 6);
    expect(erf(1)).toBeCloseTo(0.8427007929, 6);
    expect(erf(2)).toBeCloseTo(0.9953222650, 6);
    expect(erf(-1)).toBeCloseTo(-0.8427007929, 6);
  });
});

describe('shadowProfile', () => {
  const width = 10;

  it('is the blurred band the SVG draws, normalised to 1 at the casting edge', () => {
    const h = SHADOW_BAND_HALF_WIDTH_RATIO * width;
    const sigma = SHADOW_BLUR_SIGMA_RATIO * width;
    const atEdge = blurredBandByQuadrature(0, h, sigma);
    for (const d of [0, 1, 2.5, 4, 6, 8, 10, 12.5]) {
      expect(shadowProfile(d, width)).toBeCloseTo(blurredBandByQuadrature(d, h, sigma) / atEdge, 4);
    }
  });

  it('is darkest at the edge and fades monotonically', () => {
    expect(shadowProfile(0, width)).toBeCloseTo(1, 9);
    let previous = 1;
    for (let d = 0.25; d <= 15; d += 0.25) {
      const value = shadowProfile(d, width);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('is symmetric in the sign of the distance', () => {
    expect(shadowProfile(-3, width)).toBe(shadowProfile(3, width));
  });

  it('is effectively gone at the pruning reach', () => {
    // Under 0.3% of the edge darkness: nothing an 8-bit alpha at 20% shows.
    expect(shadowProfile(SHADOW_REACH_RATIO * width, width)).toBeLessThan(0.003);
  });

  it('draws nothing for a shadow with no reach', () => {
    expect(shadowProfile(0, 0)).toBe(0);
  });
});

describe('shadowSvgStroke', () => {
  it('scales the stroke with the reach and lifts the opacity to the edge darkness', () => {
    const stroke = shadowSvgStroke(10, 0.2);

    expect(stroke.strokeWidth).toBeCloseTo(2 * SHADOW_BAND_HALF_WIDTH_RATIO * 10, 9);
    expect(stroke.stdDeviation).toBeCloseTo(SHADOW_BLUR_SIGMA_RATIO * 10, 9);
    // At the casting edge the blurred stroke reads `opacity · band(0)`, and
    // that has to be the paint's strength.
    const h = SHADOW_BAND_HALF_WIDTH_RATIO * 10;
    const sigma = SHADOW_BLUR_SIGMA_RATIO * 10;
    expect(stroke.opacity * blurredBandByQuadrature(0, h, sigma)).toBeCloseTo(0.2, 4);
  });

  it('never asks for more than full opacity', () => {
    expect(shadowSvgStroke(10, 1).opacity).toBe(1);
  });
});

describe('shadowStepReach / shadowStepStrength', () => {
  it('leave a one-sheet ledge alone', () => {
    expect(shadowStepReach(1)).toBe(1);
    expect(shadowStepStrength(1)).toBe(1);
  });

  it('grow with the ledge, sub-linearly, up to the cap', () => {
    let previous = 1;
    for (let step = 2; step <= SHADOW_STEP_CAP; step++) {
      const reach = shadowStepReach(step);
      expect(reach).toBeGreaterThan(previous);
      expect(reach).toBeLessThan(step);
      expect(shadowStepStrength(step)).toBeGreaterThan(shadowStepStrength(step - 1));
      previous = reach;
    }
    expect(shadowStepReach(SHADOW_STEP_CAP + 5)).toBe(shadowStepReach(SHADOW_STEP_CAP));
    expect(shadowStepStrength(SHADOW_STEP_CAP + 5)).toBe(shadowStepStrength(SHADOW_STEP_CAP));
  });

  it('treat anything under one sheet as one', () => {
    expect(shadowStepReach(0)).toBe(1);
    expect(shadowStepStrength(-3)).toBe(1);
  });

  it('never push the SVG stroke past full opacity at any height', () => {
    expect(shadowSvgStroke(10, 0.2 * shadowStepStrength(SHADOW_STEP_CAP)).opacity).toBeLessThan(1);
  });
});

describe('SHADOW_PROFILE_GLSL', () => {
  it('bakes the same constants the JS curve uses', () => {
    expect(SHADOW_PROFILE_GLSL).toContain(`${SHADOW_BAND_HALF_WIDTH_RATIO} * width`);
    expect(SHADOW_PROFILE_GLSL).toContain(`${SHADOW_BLUR_SIGMA_RATIO} * width`);
    expect(SHADOW_PROFILE_GLSL).toContain('float shadowProfile(float distance, float width)');
    expect(SHADOW_PROFILE_GLSL).toContain(`${SHADOW_STEP_CAP}.0`);
    expect(SHADOW_PROFILE_GLSL).toContain('float shadowStepReach(float ledge)');
    expect(SHADOW_PROFILE_GLSL).toContain('float shadowStepStrength(float ledge)');
  });

  it('avoids GLSL ES 1.00 reserved words as identifiers', () => {
    const code = SHADOW_PROFILE_GLSL.replace(/\/\/[^\n]*/g, '');
    // `step` is a built-in function; naming a variable after it fails on some drivers.
    for (const reserved of ['half', 'packed', 'fixed', 'input', 'output', 'step']) {
      expect(code).not.toMatch(new RegExp(`\\b${reserved}\\b`));
    }
  });
});
