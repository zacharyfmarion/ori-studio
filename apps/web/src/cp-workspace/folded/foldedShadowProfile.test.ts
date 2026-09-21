import { describe, expect, it } from 'vitest';
import {
  SHADOW_BANDS,
  SHADOW_MAX_BOOST,
  SHADOW_MIN_CORE_PX,
  SHADOW_PROFILE_GLSL,
  SHADOW_REACH_RATIO,
  SHADOW_STEP_CAP,
  blurredBand,
  erf,
  shadowLedgeBoost,
  shadowLedgeHeight,
  shadowProfile,
  shadowSvgBands,
} from './foldedShadowProfile';

/**
 * The physics the profile claims to draw: the fraction of a uniform sky's
 * light that a long wall `h` high blocks at a point `distance` from its
 * foot on a Lambertian floor, integrated by quadrature over the azimuth.
 */
function wallOcclusion(distance: number, h: number): number {
  const x = distance / h;
  const steps = 4000;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const phi = -Math.PI / 2 + ((i + 0.5) / steps) * Math.PI;
    const c2 = Math.cos(phi) ** 2;
    sum += c2 / (c2 + x * x);
  }
  return (sum * (Math.PI / steps)) / (2 * Math.PI);
}

/**
 * One blurred band computed the slow way: a box of half-width `h` convolved
 * with a Gaussian of `sigma`, sampled at `distance` from its centre line.
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
  it("matches tabulated values to the approximation's stated accuracy", () => {
    expect(erf(0)).toBeCloseTo(0, 8);
    expect(erf(0.5)).toBeCloseTo(0.5204998778, 6);
    expect(erf(1)).toBeCloseTo(0.8427007929, 6);
    expect(erf(2)).toBeCloseTo(0.995322265, 6);
    expect(erf(-1)).toBeCloseTo(-0.8427007929, 6);
  });
});

describe('blurredBand', () => {
  it('is the box-Gaussian convolution the SVG blur produces', () => {
    for (const d of [0, 1, 2.5, 4, 8]) {
      expect(blurredBand(d, 4, 3)).toBeCloseTo(blurredBandByQuadrature(d, 4, 3), 4);
    }
  });
});

describe('shadowProfile', () => {
  const height = 10;

  it('is the wall-occlusion curve, normalised to 1 at the contact line', () => {
    const atContact = wallOcclusion(0, height);
    expect(atContact).toBeCloseTo(0.5, 3);
    expect(shadowProfile(0, height)).toBeCloseTo(1, 9);
    // Fitted to within a few percent out to two ledge heights.
    for (const d of [2.5, 5, 7.5, 10, 15, 20]) {
      expect(
        Math.abs(shadowProfile(d, height) - wallOcclusion(d, height) / atContact)
      ).toBeLessThan(0.05);
    }
  });

  it('halves by about half a ledge height — a sharp edge, not a soft ramp', () => {
    expect(shadowProfile(0.55 * height, height)).toBeGreaterThan(0.45);
    expect(shadowProfile(0.55 * height, height)).toBeLessThan(0.6);
    expect(shadowProfile(2 * height, height)).toBeLessThan(0.15);
  });

  it('fades monotonically and is symmetric', () => {
    let previous = 1;
    for (let d = 0.25; d <= 60; d += 0.25) {
      const value = shadowProfile(d, height);
      expect(value).toBeLessThanOrEqual(previous + 1e-12);
      previous = value;
    }
    expect(shadowProfile(-3, height)).toBe(shadowProfile(3, height));
  });

  it('scales with the ledge height alone', () => {
    expect(shadowProfile(3, 10)).toBeCloseTo(shadowProfile(6, 20), 9);
  });

  it('is effectively gone at the pruning reach', () => {
    expect(shadowProfile(SHADOW_REACH_RATIO * height, height)).toBeLessThan(0.003);
  });

  it('draws nothing for a ledge with no height', () => {
    expect(shadowProfile(0, 0)).toBe(0);
  });
});

describe('shadowLedgeHeight', () => {
  it('is the sheet thickness times the sheets, from one up to the cap', () => {
    expect(shadowLedgeHeight(1, 2)).toBe(2);
    expect(shadowLedgeHeight(4, 2)).toBe(8);
    expect(shadowLedgeHeight(0, 2)).toBe(2);
    expect(shadowLedgeHeight(SHADOW_STEP_CAP + 20, 2)).toBe(2 * SHADOW_STEP_CAP);
  });
});

describe('shadowLedgeBoost', () => {
  it('leaves a ledge alone once its core is a pixel or two wide', () => {
    const wideEnough = SHADOW_MIN_CORE_PX / SHADOW_BANDS[0].halfWidth;
    expect(shadowLedgeBoost(wideEnough)).toBe(1);
    expect(shadowLedgeBoost(wideEnough * 10)).toBe(1);
  });

  it('widens a thinner ledge to exactly that core width', () => {
    const heightPx = 2;
    const boost = shadowLedgeBoost(heightPx);
    expect(boost).toBeGreaterThan(1);
    expect(SHADOW_BANDS[0].halfWidth * heightPx * boost).toBeCloseTo(SHADOW_MIN_CORE_PX, 9);
  });

  it('gives up widening past the cap, where the shadow is faint anyway', () => {
    expect(shadowLedgeBoost(0.01)).toBe(SHADOW_MAX_BOOST);
    expect(shadowLedgeBoost(0)).toBe(SHADOW_MAX_BOOST);
  });
});

describe('shadowSvgBands', () => {
  it('describes the same curve the canvas evaluates, summed at the contact darkness', () => {
    const height = 10;
    const { strokeWidth, opacity, bands } = shadowSvgBands(height, 0.35);

    expect(strokeWidth).toBeCloseTo(2 * SHADOW_BANDS[0].halfWidth * height, 9);
    expect(opacity).toBeCloseTo(0.35, 9);
    expect(bands[0].dilateRadius).toBe(0);
    for (const d of [0, 3, 6, 12]) {
      let sum = 0;
      for (const band of bands) {
        const halfWidth = strokeWidth / 2 + band.dilateRadius;
        sum += band.weight * blurredBand(d, halfWidth, band.stdDeviation);
      }
      expect(sum).toBeCloseTo(shadowProfile(d, height), 6);
    }
  });

  it('widens and lightens a thin ledge like the canvas does', () => {
    const thin = shadowSvgBands(1, 0.35);
    const boost = shadowLedgeBoost(1);

    expect(thin.strokeWidth).toBeCloseTo(2 * SHADOW_BANDS[0].halfWidth * boost, 9);
    expect(thin.opacity).toBeCloseTo(0.35 / boost, 9);
  });
});

describe('SHADOW_PROFILE_GLSL', () => {
  it('bakes the same bands and rules the JS curve uses', () => {
    for (const band of SHADOW_BANDS) {
      expect(SHADOW_PROFILE_GLSL).toContain(`${band.halfWidth} * height`);
      expect(SHADOW_PROFILE_GLSL).toContain(`${band.sigma} * height`);
    }
    expect(SHADOW_PROFILE_GLSL).toContain('float shadowProfile(float distance, float height)');
    expect(SHADOW_PROFILE_GLSL).toContain(`clamp(ledge, 1.0, ${SHADOW_STEP_CAP}.0)`);
    expect(SHADOW_PROFILE_GLSL).toContain('float shadowLedgeBoost(float heightPx)');
  });

  it('writes every number as a float literal', () => {
    const code = SHADOW_PROFILE_GLSL.replace(/\/\/[^\n]*/g, '');
    // An integer literal in float arithmetic is a GLSL ES 1.00 type error.
    for (const literal of code.match(/(?<![\w.])\d+(?![\w.])/g) ?? []) {
      expect(literal, `bare integer ${literal}`).toBe('');
    }
  });

  it('avoids GLSL ES 1.00 reserved words as identifiers', () => {
    const code = SHADOW_PROFILE_GLSL.replace(/\/\/[^\n]*/g, '');
    // `step` is a built-in function; naming a variable after it fails on some drivers.
    for (const reserved of ['half', 'packed', 'fixed', 'input', 'output', 'step']) {
      expect(code).not.toMatch(new RegExp(`\\b${reserved}\\b`));
    }
  });
});
