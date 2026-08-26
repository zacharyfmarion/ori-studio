import { describe, expect, it } from 'vitest';

import { HINT_DASH_SLOT } from '../../lib/oristudioCpLineStyle';
import type { Rgba } from '../renderer/types';
import {
  appendDirectionHintDash,
  hintColorName,
  isHinted,
  HINT_MOUNTAIN,
  HINT_NONE,
  HINT_VALLEY,
  type HintDashTarget,
} from './directionHint';

const MOUNTAIN: Rgba = [0.9, 0.2, 0.2, 1];
const UNASSIGNED: Rgba = [0.6, 0.64, 0.68, 1];

/** Two creases' worth of buffers with room for one overlay past them. */
function target(instances = 3): HintDashTarget {
  return {
    a: new Float32Array(instances * 2),
    b: new Float32Array(instances * 2),
    color: new Float32Array(instances * 4),
    dashSlot: new Float32Array(instances),
  };
}

describe('hint codes', () => {
  /**
   * The codes mirror `fold_direction_hint_code` in
   * `crates/oristudio-cp/src/geometry_transport.rs`. They travel in `seg_attr`'s
   * fifth slot, so a disagreement here paints every hinted crease wrong.
   */
  it('maps the transport codes to line-colour names', () => {
    expect(hintColorName(HINT_MOUNTAIN)).toBe('Red1');
    expect(hintColorName(HINT_VALLEY)).toBe('Blue2');
    expect(hintColorName(HINT_NONE)).toBeNull();
    expect(hintColorName(99)).toBeNull();
  });

  it('agrees with itself about which codes are hints', () => {
    // The two scene builders size their buffers with `isHinted` and then decide
    // per crease with `hintColorName`. If those ever disagreed, a hinted crease
    // would write its overlay past the end of the arrays.
    for (const code of [HINT_NONE, HINT_MOUNTAIN, HINT_VALLEY, 99, -1]) {
      expect(isHinted(code)).toBe(hintColorName(code) !== null);
    }
  });
});

describe('appendDirectionHintDash', () => {
  /**
   * The point of the whole treatment: the direction keeps **all** of its colour.
   * The wash this replaced spent 55% of it, which read as faded — and spent it
   * unevenly, because the unassigned grey is itself blue-ish.
   */
  it('paints the direction at full strength', () => {
    const out = target();
    expect(appendDirectionHintDash(out, 2, 1, 2, 3, 4, MOUNTAIN, UNASSIGNED)).toBe(true);
    // Through a Float32Array, since that is what it lands in: the claim is that
    // the ink is unmodified, not that f32 holds these decimals exactly.
    expect(out.color.slice(8, 12)).toEqual(Float32Array.from(MOUNTAIN));
  });

  it('writes one instance at the index it is given, over the same line', () => {
    const out = target();
    appendDirectionHintDash(out, 2, 1, 2, 3, 4, MOUNTAIN, UNASSIGNED);
    expect(Array.from(out.a.slice(4, 6))).toEqual([1, 2]);
    expect(Array.from(out.b.slice(4, 6))).toEqual([3, 4]);
    expect(out.dashSlot[2]).toBe(HINT_DASH_SLOT);
    // Nothing before it moved: the creases are already written by this point.
    expect(Array.from(out.a.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(out.dashSlot.slice(0, 2))).toEqual([0, 0]);
  });

  /**
   * In the two black-dot line styles the direction's ink *is* the crease's, so a
   * hint cannot read as "mountain" there. Declining is what keeps that a no-op
   * rather than an invisible instance per hinted crease — and it is the same
   * outcome those styles always had, since they paint every crease one colour.
   */
  it('declines when the style gives the direction the ink the crease already has', () => {
    const out = target();
    expect(appendDirectionHintDash(out, 2, 1, 2, 3, 4, UNASSIGNED, UNASSIGNED)).toBe(false);
    expect(Array.from(out.color)).toEqual(Array.from(new Float32Array(12)));
    expect(out.dashSlot[2]).toBe(0);
  });

  it('still fires when only the alpha differs', () => {
    // Alpha is the fold-angle ramp's channel. Two inks that differ only there
    // are different inks, and treating them as equal would drop a hint whenever
    // a display mode happened to fade one of them.
    const faded: Rgba = [UNASSIGNED[0], UNASSIGNED[1], UNASSIGNED[2], 0.5];
    expect(appendDirectionHintDash(target(), 2, 1, 2, 3, 4, faded, UNASSIGNED)).toBe(true);
  });
});
