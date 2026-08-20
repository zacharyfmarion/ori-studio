import { describe, expect, it } from 'vitest';

import type { Rgba } from '../renderer/types';
import {
  directionHintInk,
  hintColorName,
  HINT_MOUNTAIN,
  HINT_NONE,
  HINT_VALLEY,
} from './directionHintInk';

const MOUNTAIN: Rgba = [0.9, 0.2, 0.2, 1];
const VALLEY: Rgba = [0.2, 0.3, 0.9, 1];
const NEUTRAL: Rgba = [0.6, 0.64, 0.68, 1];

describe('directionHintInk', () => {
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

  /**
   * The two mistakes are not symmetric. A hint that reads as a decided fold is
   * the dangerous one — it claims the pattern says something it does not — so
   * the wash has to move the ink visibly off the direction's own colour.
   */
  it('lands between the direction and neutral, nearer neither end', () => {
    const hinted = directionHintInk(MOUNTAIN, NEUTRAL);
    for (let channel = 0; channel < 3; channel += 1) {
      const low = Math.min(MOUNTAIN[channel], NEUTRAL[channel]);
      const high = Math.max(MOUNTAIN[channel], NEUTRAL[channel]);
      expect(hinted[channel]).toBeGreaterThan(low);
      expect(hinted[channel]).toBeLessThan(high);
    }
  });

  /** Direction still has to read at a glance: a hinted mountain is not a valley. */
  it('keeps mountain and valley apart', () => {
    const mountain = directionHintInk(MOUNTAIN, NEUTRAL);
    const valley = directionHintInk(VALLEY, NEUTRAL);
    const separation = Math.abs(mountain[0] - valley[0]) + Math.abs(mountain[2] - valley[2]);
    expect(separation).toBeGreaterThan(0.2);
  });

  /** Alpha is the fold-angle ramp's channel; the hint must not fight it for it. */
  it('leaves alpha alone', () => {
    expect(directionHintInk([0.9, 0.2, 0.2, 0.5], NEUTRAL)[3]).toBe(0.5);
  });

  /**
   * In the monochrome line styles the direction's ink *is* the neutral, so a
   * hint cannot read as "mountain" there. It must still be a no-op rather than
   * an error — the style change is the user's, and losing the distinction is the
   * documented cost of it.
   */
  it('is stable when the direction ink is already neutral', () => {
    expect(directionHintInk(NEUTRAL, NEUTRAL)).toEqual(NEUTRAL);
  });
});
