/**
 * The opacity encoding, and the mode dispatcher that chooses between it and the
 * hue ramp.
 *
 * Two things get pinned here that the hue ramp's own suite cannot pin alone:
 *
 * - **Channel separation.** `applyFoldAngleRamp` never touches alpha (asserted
 *   in `foldAngleRamp.test.ts`); this asserts the mirror, that
 *   `applyFoldAngleOpacity` never touches RGB. Single-channel transforms are
 *   what make the two modes genuine alternatives rather than a blend, and they
 *   are why `opacity` keeps mountain red and valley blue readable at 20° where
 *   the hue ramp has converged them.
 * - **No mode is a no-op.** Whichever mode is active, a non-180 crease must not
 *   render as a full fold. `foldAngleRamp.test.ts` pins that by signature (the
 *   ramp takes no visibility argument); with a mode enum in play it needs
 *   saying directly, for every member.
 *
 * The floor and ceiling are measured against every bundled theme canvas rather
 * than eyeballed — see the `FOLD_ANGLE_MIN_OPACITY` doc comment for why the
 * yardstick is Lab ΔE and not WCAG contrast ratio.
 */
import { describe, expect, it } from 'vitest';
import {
  applyFoldAngleOpacity,
  applyFoldAngleRamp,
  foldAngleInk,
  FOLD_ANGLE_MAX_OPACITY,
  FOLD_ANGLE_MIN_OPACITY,
} from './foldAngleRamp';
import { FOLD_MAGNITUDE_FULL, FOLD_MAGNITUDE_UNITS_PER_DEGREE } from '../../lib/foldAngle';
import {
  DEFAULT_ORISTUDIO_CP_FOLD_ANGLE_DISPLAY,
  ORISTUDIO_CP_FOLD_ANGLE_DISPLAYS,
  type OristudioCpFoldAngleDisplay,
} from '../../lib/creasePatternViewport';
import { PRESET_THEMES } from '../../themes';
import type { Rgba } from '../renderer/types';

const MOUNTAIN: Rgba = [1, 0.302, 0.365, 1]; // --fold-mountain #ff4d5d
const VALLEY: Rgba = [0.376, 0.647, 0.98, 1]; // --fold-valley   #60a5fa
const ANCHOR: Rgba = [0.851, 0.275, 0.937, 1]; // --fold-angle-anchor #d946ef
const deg = (value: number) => value * FOLD_MAGNITUDE_UNITS_PER_DEGREE;
const ANGLES = [179, 135, 120, 90, 60, 45, 20, 0];

// --- Lab, matching the yardstick foldAngleRamp.test.ts already uses ---

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

const deltaE = (a: Rgba, b: Rgba) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

/** What the GPU's premultiplied blend produces for `ink` drawn over `bg`. */
function composite(ink: Rgba, bg: Rgba): Rgba {
  const a = ink[3];
  return [
    ink[0] * a + bg[0] * (1 - a),
    ink[1] * a + bg[1] * (1 - a),
    ink[2] * a + bg[2] * (1 - a),
    1,
  ];
}

function hexToRgba(hex: string): Rgba {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
    1,
  ];
}

/**
 * Every canvas a crease can be drawn on: each bundled theme, plus theme.css's
 * own fallback for when no preset has been applied.
 */
const CANVASES: { name: string; bg: Rgba }[] = [
  ...PRESET_THEMES.map((theme) => ({
    name: theme.name,
    bg: hexToRgba(theme.colors['bg.canvas']),
  })),
  { name: 'theme.css fallback', bg: hexToRgba('#0c0f12') },
];

describe('applyFoldAngleOpacity', () => {
  it('returns a classic crease by identity', () => {
    // Identity, not equality — a document with no fold angles must render
    // byte-identically and allocate nothing, in every mode.
    expect(applyFoldAngleOpacity(MOUNTAIN, undefined)).toBe(MOUNTAIN);
    expect(applyFoldAngleOpacity(MOUNTAIN, FOLD_MAGNITUDE_FULL)).toBe(MOUNTAIN);
    expect(applyFoldAngleOpacity(MOUNTAIN, FOLD_MAGNITUDE_FULL * 2)).toBe(MOUNTAIN);
  });

  it('never touches RGB', () => {
    // The mirror of the hue ramp's "never touches alpha". This is the whole
    // point of the mode: mountain red stays mountain red at 20 degrees, where
    // the hue ramp has pulled it two thirds of the way to magenta.
    for (const ink of [MOUNTAIN, VALLEY]) {
      for (const angle of ANGLES) {
        const faded = applyFoldAngleOpacity(ink, deg(angle));
        expect(faded.slice(0, 3)).toEqual(ink.slice(0, 3));
      }
    }
  });

  it('keeps mountain and valley fully distinct at every angle', () => {
    // Where the hue ramp deliberately converges (dE 0 at 0 degrees), opacity
    // does not converge at all: direction is never spent on magnitude.
    for (const angle of ANGLES) {
      const m = applyFoldAngleOpacity(MOUNTAIN, deg(angle));
      const v = applyFoldAngleOpacity(VALLEY, deg(angle));
      expect(deltaE(m, v)).toBeCloseTo(deltaE(MOUNTAIN, VALLEY), 6);
    }
  });

  it('steps down the moment a crease stops being a full fold', () => {
    // A linear ramp from 1.0 would put 135 degrees at alpha 0.87, invisible on a
    // hairline. The step makes "not a full fold" categorical; the ramp within
    // says how shallow.
    expect(applyFoldAngleOpacity(MOUNTAIN, deg(179.999))[3]).toBeLessThanOrEqual(
      FOLD_ANGLE_MAX_OPACITY,
    );
    expect(applyFoldAngleOpacity(MOUNTAIN, deg(0))[3]).toBeCloseTo(FOLD_ANGLE_MIN_OPACITY, 6);
  });

  it('fades monotonically as the fold flattens, and stays inside the band', () => {
    let previous = Infinity;
    for (const angle of ANGLES) {
      const alpha = applyFoldAngleOpacity(MOUNTAIN, deg(angle))[3];
      expect(alpha).toBeLessThan(previous);
      expect(alpha).toBeGreaterThanOrEqual(FOLD_ANGLE_MIN_OPACITY);
      expect(alpha).toBeLessThanOrEqual(FOLD_ANGLE_MAX_OPACITY);
      previous = alpha;
    }
  });

  it('composes with an ink that already carries alpha', () => {
    const translucent: Rgba = [1, 0.302, 0.365, 0.5];
    expect(applyFoldAngleOpacity(translucent, deg(0))[3]).toBeCloseTo(
      0.5 * FOLD_ANGLE_MIN_OPACITY,
      6,
    );
  });
});

describe('the opacity band holds up on every theme canvas', () => {
  // These are the measurements the two constants are derived from. They are
  // deliberately run per theme rather than against one representative canvas:
  // a new preset with an unusual canvas is exactly the change that would
  // silently make shallow creases vanish, and it should fail here instead.

  it('keeps a crease perceptible at the floor', () => {
    // Perceptible, not prominent. The floor is deliberately faint so a near-flat
    // crease looks near-flat; what this guards is that it never crosses into
    // *invisible* on some canvas, because the crease is still editable and you
    // have to be able to find it.
    for (const { name, bg } of CANVASES) {
      for (const [label, ink] of [
        ['mountain', MOUNTAIN],
        ['valley', VALLEY],
      ] as const) {
        const floored = composite(applyFoldAngleOpacity(ink, 0), bg);
        const full = composite(ink, bg);
        const retention = deltaE(floored, bg) / deltaE(full, bg);
        // Worst measured: 15.9% retention (cobalt2 mountain), 11.1 absolute
        // (catppuccin-latte valley) — about 5x the ~2.3 JND threshold.
        expect(retention, `${name} ${label} retention`).toBeGreaterThan(0.15);
        expect(deltaE(floored, bg), `${name} ${label} absolute`).toBeGreaterThan(10);
      }
    }
  });

  it('makes the classic-to-ceiling step visible', () => {
    for (const { name, bg } of CANVASES) {
      for (const [label, ink] of [
        ['mountain', MOUNTAIN],
        ['valley', VALLEY],
      ] as const) {
        // The nearest non-classic angle a user can reach. Setting exactly 180
        // normalises to a classic crease in the kernel, so there is no cliff
        // between this and a full fold that anyone can land on.
        const nearlyFull = composite(applyFoldAngleOpacity(ink, deg(179.999)), bg);
        // Worst measured: 11.0 (gruvbox-light valley).
        expect(deltaE(composite(ink, bg), nearlyFull), `${name} ${label}`).toBeGreaterThan(8);
      }
    }
  });
});

describe('foldAngleInk', () => {
  it('dispatches to the mode', () => {
    const magnitude = deg(90);
    expect(foldAngleInk(MOUNTAIN, magnitude, { display: 'opacity', anchor: ANCHOR })).toEqual(
      applyFoldAngleOpacity(MOUNTAIN, magnitude),
    );
    expect(foldAngleInk(MOUNTAIN, magnitude, { display: 'color', anchor: ANCHOR })).toEqual(
      applyFoldAngleRamp(MOUNTAIN, magnitude, ANCHOR),
    );
  });

  it('returns a classic crease by identity in every mode', () => {
    for (const display of ORISTUDIO_CP_FOLD_ANGLE_DISPLAYS) {
      expect(foldAngleInk(MOUNTAIN, undefined, { display, anchor: ANCHOR })).toBe(MOUNTAIN);
      expect(foldAngleInk(MOUNTAIN, FOLD_MAGNITUDE_FULL, { display, anchor: ANCHOR })).toBe(
        MOUNTAIN,
      );
    }
  });

  it('has no mode that is a no-op', () => {
    // The direct statement of what the ramp's `toHaveLength(3)` signature pin
    // proxies for: there is no view in which a non-180 crease can render as a
    // full fold. Adding a mode that fails this is adding an "off" switch.
    for (const display of ORISTUDIO_CP_FOLD_ANGLE_DISPLAYS) {
      for (const ink of [MOUNTAIN, VALLEY]) {
        for (const angle of [135, 90, 45, 0]) {
          const shifted = foldAngleInk(ink, deg(angle), { display, anchor: ANCHOR });
          expect(shifted, `${display} at ${angle}`).not.toEqual(ink);
        }
      }
    }
  });

  it('falls back to the default mode on an unrecognised value', () => {
    // `.osf` casts viewState.viewport without validating it, so this is
    // reachable from a file. Pinned against the declared default so changing
    // that constant cannot leave the `default:` arm behind.
    const unknown = 'wireframe' as OristudioCpFoldAngleDisplay;
    expect(foldAngleInk(MOUNTAIN, deg(90), { display: unknown, anchor: ANCHOR })).toEqual(
      foldAngleInk(MOUNTAIN, deg(90), {
        display: DEFAULT_ORISTUDIO_CP_FOLD_ANGLE_DISPLAY,
        anchor: ANCHOR,
      }),
    );
  });
});
