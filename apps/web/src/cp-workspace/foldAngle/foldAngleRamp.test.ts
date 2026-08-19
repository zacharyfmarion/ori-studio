import { describe, expect, it } from 'vitest';
import type { Rgba } from '../renderer/types';
import { applyFoldAngleRamp } from './foldAngleRamp';
import { FOLD_MAGNITUDE_FULL, FOLD_MAGNITUDE_UNITS_PER_DEGREE } from '../../lib/foldAngle';

const MOUNTAIN: Rgba = [1, 0.302, 0.365, 1]; // #ff4d5d
const VALLEY: Rgba = [0.376, 0.647, 0.98, 1]; // #60a5fa
const ANCHOR: Rgba = [0.851, 0.275, 0.937, 1]; // #d946ef
const deg = (value: number) => value * FOLD_MAGNITUDE_UNITS_PER_DEGREE;

// --- CIE Lab, so the assertions below are about perception rather than bytes ---

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function lab([r, g, b]: Rgba): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.9505;
  const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.089;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const lightness = (c: Rgba) => lab(c)[0];
const chroma = (c: Rgba) => Math.hypot(lab(c)[1], lab(c)[2]);
const deltaE = (a: Rgba, b: Rgba) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

const ANGLES = [180, 135, 120, 90, 60, 45, 20, 0];

describe('classic creases are untouched', () => {
  it('returns the ink by identity', () => {
    // Identity, not equality: the classic path is the hot path, and a document
    // with no fold angles must render byte-identically to before this feature.
    expect(applyFoldAngleRamp(MOUNTAIN, undefined, ANCHOR)).toBe(MOUNTAIN);
    expect(applyFoldAngleRamp(MOUNTAIN, FOLD_MAGNITUDE_FULL, ANCHOR)).toBe(MOUNTAIN);
    expect(applyFoldAngleRamp(MOUNTAIN, FOLD_MAGNITUDE_FULL * 2, ANCHOR)).toBe(MOUNTAIN);
  });
});

describe('the ramp holds luminance', () => {
  // This is the property that makes the ramp safe to leave always on. Its
  // predecessor washed toward the canvas and dropped a 90-degree mountain to
  // ~82% of full luminance, which read as the line getting *thinner* — a
  // hairline loses apparent weight before it loses apparent lightness.
  for (const ink of [MOUNTAIN, VALLEY]) {
    it(`stays near full lightness across 0-180 (${ink === MOUNTAIN ? 'mountain' : 'valley'})`, () => {
      const full = lightness(ink);
      for (const angle of ANGLES) {
        const ramped = applyFoldAngleRamp(ink, deg(angle), ANCHOR);
        // Measured floor is 85% (valley, near 0). The wash ramp it replaces hit
        // 82% at 90 degrees and kept falling.
        expect(lightness(ramped) / full).toBeGreaterThan(0.84);
      }
    });
  }
});

describe('the ramp stays saturated', () => {
  // A red->yellow->blue ramp collapses the valley half to chroma ~17 (grey,
  // and within dE 11 of the `unassigned` line colour) because blue and yellow
  // are near-complementary. Magenta avoids that; this pins it.
  for (const ink of [MOUNTAIN, VALLEY]) {
    it(`never drops into the grey range (${ink === MOUNTAIN ? 'mountain' : 'valley'})`, () => {
      for (const angle of ANGLES) {
        const ramped = applyFoldAngleRamp(ink, deg(angle), ANCHOR);
        expect(chroma(ramped)).toBeGreaterThan(40);
      }
    });
  }
});

describe('mountain and valley converge as the fold flattens', () => {
  it('is identical at 0, because an unfolded crease has no direction', () => {
    // Not a limitation. A mountain at 0 degrees and a valley at 0 degrees are
    // the same physical thing, so they render the same. Storage keeps them
    // distinct to remember which way to go when the angle is raised again;
    // that is a different question from what the canvas shows.
    const m = applyFoldAngleRamp(MOUNTAIN, 0, ANCHOR);
    const v = applyFoldAngleRamp(VALLEY, 0, ANCHOR);
    expect(deltaE(m, v)).toBeCloseTo(0, 6);
  });

  it('stays clearly distinguishable across the range that carries real folds', () => {
    // Below ~20 degrees they are meant to look alike; above it they must not.
    for (const [angle, floor] of [
      [180, 90],
      [135, 70],
      [90, 45],
      [45, 20],
    ] as const) {
      const m = applyFoldAngleRamp(MOUNTAIN, deg(angle), ANCHOR);
      const v = applyFoldAngleRamp(VALLEY, deg(angle), ANCHOR);
      expect(deltaE(m, v)).toBeGreaterThan(floor);
    }
  });

  it('separation shrinks monotonically as the fold flattens', () => {
    const separations = ANGLES.map((angle) =>
      deltaE(
        applyFoldAngleRamp(MOUNTAIN, deg(angle), ANCHOR),
        applyFoldAngleRamp(VALLEY, deg(angle), ANCHOR),
      ),
    );
    for (let i = 1; i < separations.length; i += 1) {
      expect(separations[i]).toBeLessThan(separations[i - 1]);
    }
  });
});

describe('the ramp is monotone and ordered', () => {
  it('moves further from the unfolded ink as the angle shrinks', () => {
    for (const ink of [MOUNTAIN, VALLEY]) {
      const distances = ANGLES.map((angle) =>
        deltaE(ink, applyFoldAngleRamp(ink, deg(angle), ANCHOR)),
      );
      for (let i = 1; i < distances.length; i += 1) {
        expect(distances[i]).toBeGreaterThan(distances[i - 1]);
      }
    }
  });

  it('never touches alpha', () => {
    for (const angle of ANGLES) {
      expect(applyFoldAngleRamp(MOUNTAIN, deg(angle), ANCHOR)[3]).toBe(1);
    }
  });
});

describe('colour is not gated by the label toggle', () => {
  // The View panel's "Fold angle labels" switch hides the badges only. Crease
  // colour is unconditional: a non-180 crease must never be able to look like a
  // full fold. The ramp takes no visibility flag at all, which is what makes
  // that impossible to wire up by accident — this pins the signature.
  it('takes no visibility argument', () => {
    expect(applyFoldAngleRamp).toHaveLength(3);
  });

  it('still shifts a non-180 crease regardless of any UI state', () => {
    const ninety = applyFoldAngleRamp(MOUNTAIN, deg(90), ANCHOR);
    expect(deltaE(ninety, MOUNTAIN)).toBeGreaterThan(20);
  });
});
