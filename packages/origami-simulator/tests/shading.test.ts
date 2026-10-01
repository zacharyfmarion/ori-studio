import { describe, expect, it } from 'vitest';
import {
  SHADE_AMBIENT,
  SHADE_DIFFUSE,
  SHADE_FACING,
  SHADE_GLSL,
  SHADE_MAX,
  SHADE_MIN,
  shadeColor,
  shadeFor,
} from '../src/shading.js';

/**
 * The one shade band. The GLSL is checked textually because the shader cannot
 * be compiled here; what matters is that the numbers it carries are the same
 * constants the CPU paths read, which is the whole reason the module exists.
 */
describe('shadeFor', () => {
  const light: [number, number, number] = [-0.45, 0.58, 0.68];

  it('is the historical band for a face square to the eye', () => {
    // n = (0,0,1): diffuse = lz/|l|, plus the facing lift.
    const lz = 0.68 / Math.hypot(-0.45, 0.58, 0.68);
    expect(shadeFor([0, 0, 1], light)).toBeCloseTo(0.74 + lz * 0.3 + 0.04, 12);
  });

  it('orients the normal toward the viewer, so both sides shade alike', () => {
    expect(shadeFor([0.2, -0.3, -1], light)).toBe(shadeFor([-0.2, 0.3, 1], light));
  });

  it('clamps to the band and leaves a sliver unlit', () => {
    // Facing straight away from the light and the eye: ambient only, floored.
    expect(shadeFor([0, 0, 1], [0, 0, -1])).toBe(Math.max(SHADE_MIN, SHADE_AMBIENT + SHADE_FACING));
    expect(shadeFor([0, 0, 1], [0, 0, 1])).toBe(
      Math.min(SHADE_MAX, SHADE_AMBIENT + SHADE_DIFFUSE + SHADE_FACING)
    );
    expect(shadeFor([0, 0, 0], light)).toBe(1);
  });

  it('does not depend on either vector’s length', () => {
    expect(shadeFor([0, 0, 5], light)).toBeCloseTo(shadeFor([0, 0, 1], light), 12);
    expect(shadeFor([0, 0, 1], [-4.5, 5.8, 6.8])).toBeCloseTo(shadeFor([0, 0, 1], light), 12);
  });
});

describe('shadeColor', () => {
  it('multiplies and clamps each channel, the way the framebuffer does', () => {
    expect(shadeColor([1, 0.5, 0], 1.08)).toEqual([1, 0.54, 0]);
    expect(shadeColor([1, 0.5, 0], 0.68)).toEqual([0.68, 0.34, 0]);
  });
});

describe('SHADE_GLSL', () => {
  it('carries the same constants as the CPU band', () => {
    for (const constant of [SHADE_AMBIENT, SHADE_DIFFUSE, SHADE_FACING, SHADE_MIN, SHADE_MAX]) {
      expect(SHADE_GLSL).toContain(String(constant));
    }
    expect(SHADE_GLSL).toContain('float shadeFor(vec3 normal, vec3 lightDir)');
  });

  it('prints every constant as a float literal', () => {
    // `clamp(1 + ...)` would be an int in GLSL and fail to compile.
    // Numbers only, not the 3 in `vec3` or the z in `n.z`.
    const literals = SHADE_GLSL.match(/(?<![\w.])\d+(?:\.\d+)?(?!\w)/g) ?? [];
    expect(literals.length).toBeGreaterThanOrEqual(5);
    for (const literal of literals) {
      expect(literal).toMatch(/\./);
    }
  });
});
