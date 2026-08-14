import { describe, expect, it } from 'vitest';
import {
  BP_FLAP_HANDLE_SIGNS,
  BP_FLAP_RESIZE_HANDLES,
  bpFlapOuterBox,
  solveBpFlapReshape,
  type BpFlapFootprint,
  type BpFlapResizeHandle,
} from './bpFlapReshape';
import type { OristudioBpFlap, OristudioBpSheet } from '../engine/oristudioBpTypes';

const SHEET: OristudioBpSheet = {
  kind: 'rectangular',
  width: 40,
  height: 40,
  grid: { kind: 'rectangular', interval: 1, snap: true },
};

const RADIUS = { min: 1, max: 100 };

function flap(width: number, height: number, radius: number, at = { x: 20, y: 20 }): OristudioBpFlap {
  return {
    id: 1,
    vertexId: 1,
    name: '',
    anchor: at,
    width,
    height,
    radius,
    constrained: true,
  };
}

/**
 * Drag `handle` so the outer box changes by `(dx, dy)`, and report the footprint.
 *
 * Expressed as an outer-box delta rather than a pointer position because that is
 * what the rule is written in; the pointer is derived here so the conversion is
 * exercised too.
 */
function drag(
  source: OristudioBpFlap,
  handle: BpFlapResizeHandle,
  dx: number,
  dy: number,
  radiusRange: typeof RADIUS | null = RADIUS,
  sheet = SHEET
): BpFlapFootprint | null {
  const outer = bpFlapOuterBox(source);
  const signs = BP_FLAP_HANDLE_SIGNS[handle];
  const pointer = {
    x: signs.sx === 1 ? outer.x + outer.width + dx : signs.sx === -1 ? outer.x - dx : outer.x,
    y: signs.sy === 1 ? outer.y + outer.height + dy : signs.sy === -1 ? outer.y - dy : outer.y,
  };
  return solveBpFlapReshape({ flap: source, handle, pointer, radiusRange, sheet });
}

/** A solved footprint, as the flap a later gesture starts from. */
function asFlap(footprint: BpFlapFootprint): OristudioBpFlap {
  return flap(footprint.width, footprint.height, footprint.radius, footprint.anchor);
}

function sizes(footprint: BpFlapFootprint | null): [number, number, number] | null {
  return footprint ? [footprint.width, footprint.height, footprint.radius] : null;
}

describe('solveBpFlapReshape', () => {
  describe('the radius is as large as the box allows', () => {
    it('makes a square box of even side a pure circle', () => {
      // The rule in one case: 6 x 6 is r3, not r2 around a 2 x 2 base.
      expect(sizes(drag(flap(0, 0, 1), 'ne', 4, 4))).toEqual([0, 0, 3]);
    });

    it('reaches the same circle from a flap that was carrying a box', () => {
      // The answer depends on the outer box and nothing else, so a 6 x 6 box is
      // r3 however the flap that filled it was shaped.
      expect(sizes(drag(flap(2, 2, 1), 'ne', 2, 2))).toEqual([0, 0, 3]);
    });

    it('leaves the parity cell in the box when the side is odd', () => {
      // W = w + 2r, so an odd side cannot be a circle. That is the only reason a
      // square box keeps a box at all.
      expect(sizes(drag(flap(0, 0, 1), 'ne', 5, 5))).toEqual([1, 1, 3]);
    });

    it('fills a non-square box with the roundest flap that fits', () => {
      // 7 x 5: the short side caps the radius at 2, the rest is box.
      expect(sizes(drag(flap(0, 0, 2), 'ne', 3, 1))).toEqual([3, 1, 2]);
    });

    it('grows a circle on a corner drag', () => {
      expect(sizes(drag(flap(0, 0, 5), 'ne', 2, 2))).toEqual([0, 0, 6]);
    });

    it('makes a capsule when only one axis is dragged', () => {
      // The un-dragged extent is held, so the radius is capped by it and the
      // width takes the rest: a circle made wider and not taller is a capsule.
      expect(sizes(drag(flap(0, 0, 5), 'e', 2, 0))).toEqual([2, 0, 5]);
      expect(sizes(drag(flap(0, 0, 5), 'e', -2, 0))).toEqual([0, 2, 4]);
    });

    it('refuses to shrink the outer box below the minimum radius', () => {
      expect(drag(flap(0, 0, 1), 'e', -1, 0)).toBeNull();
    });

    it('changes nothing when the pointer asks for the box it started from', () => {
      // Pressing a handle without moving must not rewrite the flap, which a rule
      // that answers from the box alone would otherwise do.
      expect(drag(flap(4, 4, 2), 'ne', 0, 0)).toBeNull();
      expect(drag(flap(4, 4, 2), 'e', 0, 0)).toBeNull();
    });
  });

  describe('an off-square corner drag is exact on both axes', () => {
    // This is what the delta-spending rule could not do: there, the axis that
    // moved less capped the radius, so one odd cell stopped it moving at all.
    it('grows the radius and still lands both edges on the pointer', () => {
      const source = flap(0, 0, 2);
      const before = bpFlapOuterBox(source);
      const result = drag(source, 'ne', 2, 1)!;
      const after = bpFlapOuterBox(result);
      expect(after.width).toBe(before.width + 2);
      expect(after.height).toBe(before.height + 1);
      // And the corner opposite the one dragged has not moved.
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
    });

    it('holds across a sweep of mismatched corner drags', () => {
      for (let dx = -2; dx <= 6; dx++) {
        for (let dy = -2; dy <= 6; dy++) {
          const source = flap(1, 1, 3);
          const result = drag(source, 'ne', dx, dy);
          if (!result) continue;
          const before = bpFlapOuterBox(source);
          const after = bpFlapOuterBox(result);
          expect(after.width).toBe(before.width + dx);
          expect(after.height).toBe(before.height + dy);
        }
      }
    });
  });

  describe('the same box always gives the same flap', () => {
    it('returns to the start when a later gesture drags back', () => {
      // Reversible across gestures, not just within one, because the answer is a
      // function of the outer box. The delta-spending rule was not.
      const source = flap(0, 0, 4);
      const out = asFlap(drag(source, 'ne', 3, 3)!);
      expect(sizes(drag(out, 'ne', -3, -3))).toEqual([0, 0, 4]);
    });

    it('is idempotent: a flap it produced is already its own answer', () => {
      const once = asFlap(drag(flap(3, 5, 4), 'ne', 2, 2)!);
      expect(drag(once, 'ne', 0, 0)).toBeNull();
    });
  });

  describe('the outer box lands exactly where the pointer asked', () => {
    // While both dimensions have room to trade, which the fixture below does.
    // The one exception is the corner squeeze above.
    it.each(BP_FLAP_RESIZE_HANDLES)('holds for the %s handle', (handle) => {
      const source = flap(3, 5, 4);
      const before = bpFlapOuterBox(source);
      const signs = BP_FLAP_HANDLE_SIGNS[handle];
      const [dx, dy] = [signs.sx === 0 ? 0 : 3, signs.sy === 0 ? 0 : 3];
      const result = drag(source, handle, dx, dy);
      expect(result).not.toBeNull();
      const after = bpFlapOuterBox(result!);
      expect(after.width).toBe(before.width + dx);
      expect(after.height).toBe(before.height + dy);
      // And the edges the handle did not drag have not moved.
      if (signs.sx !== 1) expect(after.x + after.width).toBe(before.x + before.width);
      if (signs.sx !== -1) expect(after.x).toBe(before.x);
      if (signs.sy !== 1) expect(after.y + after.height).toBe(before.y + before.height);
      if (signs.sy !== -1) expect(after.y).toBe(before.y);
    });

    it('moves the anchor when the radius grows on an axis the handle does not drive', () => {
      // The north handle drives only y, so the outer width is unchanged — but the
      // radius still grows into it, and the anchor has to walk east to hold the x
      // edges still. A resize moves the flap.
      const result = drag(flap(4, 4, 2), 'n', 0, 2);
      expect(sizes(result)).toEqual([0, 2, 4]);
      expect(result?.anchor).toEqual({ x: 22, y: 22 });
    });
  });

  describe('integrality', () => {
    it('never produces a fractional field, whatever the drag', () => {
      for (const handle of BP_FLAP_RESIZE_HANDLES) {
        for (let delta = -7; delta <= 7; delta++) {
          const result = drag(flap(3, 5, 4), handle, delta, delta);
          if (!result) continue;
          for (const value of [
            result.anchor.x,
            result.anchor.y,
            result.width,
            result.height,
            result.radius,
          ]) {
            expect(Number.isInteger(value)).toBe(true);
          }
        }
      }
    });

    it('refuses a flap that is already off the integer lattice', () => {
      // A flap with no leaf edge falls back to `max(w, h) / 2`, which can be a
      // half. Nudging it along would make the whole design's device generation
      // fail, so the gesture declines instead.
      expect(drag(flap(3, 0, 1.5), 'ne', 2, 2)).toBeNull();
    });

    it('leaves the odd cell in the box, since the radius can only take even ones', () => {
      // The un-dragged height caps the radius at 4 here, so every extra cell of
      // width lands in the box and the outer edge tracks the pointer one for one.
      expect(sizes(drag(flap(4, 4, 2), 'e', 1, 0))).toEqual([1, 0, 4]);
      expect(sizes(drag(flap(4, 4, 2), 'e', 2, 0))).toEqual([2, 0, 4]);
      expect(sizes(drag(flap(4, 4, 2), 'e', 3, 0))).toEqual([3, 0, 4]);
    });
  });

  describe('within one gesture the drag reverses exactly', () => {
    it.each(BP_FLAP_RESIZE_HANDLES)('holds for the %s handle', (handle) => {
      const source = flap(4, 6, 3);
      // Every step is solved from the gesture's start state, so returning the
      // pointer returns the flap — which is the reversibility a user feels.
      const out = drag(source, handle, 4, 4);
      expect(out).not.toBeNull();
      expect(drag(source, handle, 0, 0)).toBeNull();
    });
  });

  describe('limits', () => {
    it('holds the radius fixed when the flap has no leaf edge to set', () => {
      expect(sizes(drag(flap(4, 4, 2), 'ne', 2, 2, null))).toEqual([6, 6, 2]);
    });

    it('respects the radius ceiling and spills the rest into the box', () => {
      expect(sizes(drag(flap(0, 0, 5), 'ne', 4, 4, { min: 1, max: 6 }))).toEqual([2, 2, 6]);
    });

    it('clamps a drag that would push a second corner off the sheet', () => {
      const small: OristudioBpSheet = { ...SHEET, width: 10, height: 10 };
      // Anchored in the corner: at most one tip may leave the paper, so the
      // gesture stops at the widest box the sheet still accepts rather than
      // failing.
      const result = drag(flap(0, 0, 1, { x: 9, y: 5 }), 'e', 8, 0, RADIUS, small);
      expect(result).not.toBeNull();
      expect(result!.anchor.x + result!.width).toBeLessThanOrEqual(10);
    });

    it('returns null when the drag asks for the footprint the flap already has', () => {
      expect(drag(flap(4, 4, 2), 'e', 0, 0)).toBeNull();
    });
  });
});
