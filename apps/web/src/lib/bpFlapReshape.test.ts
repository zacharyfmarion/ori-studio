import { describe, expect, it } from 'vitest';
import {
  BP_FLAP_HANDLE_SIGNS,
  BP_FLAP_RESIZE_HANDLES,
  bpFlapHandlePoint,
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
      // An edge drag leaves the radius alone and puts the change in the box, so
      // a circle made wider and not taller is a capsule.
      expect(sizes(drag(flap(0, 0, 5), 'e', 2, 0))).toEqual([2, 0, 5]);
    });

    it('stops an edge dragged inward at the flap\'s own circle', () => {
      // There is no width left to give back, and an edge never takes the radius
      // — so the handle stops rather than making the flap shorter.
      expect(drag(flap(0, 0, 5), 'e', -2, 0)).toBeNull();
      // With a box to eat, it eats the box and then stops.
      expect(sizes(drag(flap(4, 0, 5), 'e', -2, 0))).toEqual([2, 0, 5]);
      expect(sizes(drag(flap(4, 0, 5), 'e', -9, 0))).toEqual([0, 0, 5]);
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

  describe('a flap that is its own mirror stays centred on the line', () => {
    // Such a flap IS its own partner, so an edge that moved on one side alone
    // would leave the design asymmetric. The box therefore grows from the line
    // both ways, which also happens to be what keeps the recentred anchor on the
    // integer lattice: the extent moves by an even number, so its parity - and
    // with it `centre - w/2` - never changes.
    const CENTRE = { axis: 'x', at: 20 } as const;

    function centred(source: OristudioBpFlap, handle: BpFlapResizeHandle, to: number) {
      return solveBpFlapReshape({
        flap: source,
        handle,
        pointer: { x: to, y: bpFlapHandlePoint(source, handle).y },
        radiusRange: RADIUS,
        sheet: SHEET,
        centre: CENTRE,
      });
    }

    it('grows both ways from the line when an edge is dragged', () => {
      // A circle r3 centred on x = 20 spans 17..23. Dragging the east edge to 25
      // makes it 15..25 - eight wide, not seven.
      const result = centred(flap(0, 0, 3, { x: 20, y: 20 }), 'e', 25);
      expect(result).not.toBeNull();
      const box = bpFlapOuterBox(result!);
      expect(box.width).toBe(10);
      expect(box.x + box.width / 2).toBe(20);
    });

    it('keeps the anchor integral on an odd-width flap', () => {
      // The trap that made this case get declined once. `x = centre - w/2` is
      // only whole for one parity of w, and growing by twos is what preserves it.
      const source = flap(1, 0, 3, { x: 19.5, y: 20 });
      for (const to of [24, 25, 26, 27, 28]) {
        const result = centred(source, 'e', to);
        if (!result) continue;
        expect(Number.isInteger(result.anchor.x * 2), `east to ${to}`).toBe(true);
        expect(bpFlapOuterBox(result).x + bpFlapOuterBox(result).width / 2).toBe(20);
      }
    });

    it('leaves the unconstrained axis alone', () => {
      // A vertical mirror says nothing about y, so a north drag behaves exactly
      // as it does on any other flap.
      const source = flap(0, 0, 3, { x: 20, y: 20 });
      const result = solveBpFlapReshape({
        flap: source,
        handle: 'n',
        pointer: { x: bpFlapHandlePoint(source, 'n').x, y: 25 },
        radiusRange: RADIUS,
        sheet: SHEET,
        centre: CENTRE,
      });
      expect(sizes(result)).toEqual([0, 2, 3]);
    });

    it('still refuses a drag that would take it below the minimum radius', () => {
      expect(centred(flap(0, 0, 1, { x: 20, y: 20 }), 'e', 20)).toBeNull();
    });
  });

  describe('a paired flap cannot be resized across the mirror', () => {
    // The agent-found case: a flap one cell right of the axis at x = 8, its west
    // handle dragged three cells west, came back with its box on the same cells
    // as its partner's. The move path already refuses this; the resize path now
    // clamps to it, so the handle stops at the line.
    const guard = (candidate: { anchor: { x: number }; width: number }) =>
      candidate.anchor.x >= 8 - 1e-9;

    it('clamps the drag at the line instead of crossing it', () => {
      const source = flap(0, 0, 1, { x: 9, y: 8 });
      for (const to of [7, 6, 5, 4, 3, 2]) {
        const result = solveBpFlapReshape({
          flap: source,
          handle: 'w',
          pointer: { x: to, y: 8 },
          radiusRange: RADIUS,
          sheet: SHEET,
          accepts: guard,
        });
        if (!result) continue;
        expect(result.anchor.x, `west to ${to}`).toBeGreaterThanOrEqual(8);
      }
    });

    it('still allows a drag that stays on its own side', () => {
      const source = flap(0, 0, 1, { x: 12, y: 8 });
      const result = solveBpFlapReshape({
        flap: source,
        handle: 'w',
        pointer: { x: 9, y: 8 },
        radiusRange: RADIUS,
        sheet: SHEET,
        accepts: guard,
      });
      expect(result).not.toBeNull();
      expect(result!.anchor.x).toBeGreaterThanOrEqual(8);
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

    it('moves the anchor when a corner drag grows the radius', () => {
      // The anchor is the box's lower-left corner, not a centre, so a bigger
      // radius walks it outward to hold the pinned edges still. A resize moves
      // the flap, which is why the result carries an anchor at all.
      const result = drag(flap(0, 0, 2), 'ne', 2, 2);
      expect(sizes(result)).toEqual([0, 0, 3]);
      expect(result?.anchor).toEqual({ x: 21, y: 21 });
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

    it('puts every cell of an edge drag into the box, one for one', () => {
      // No parity to worry about on an edge: the radius does not move, so the
      // box tracks the pointer exactly and continuously.
      expect(sizes(drag(flap(4, 4, 2), 'e', 1, 0))).toEqual([5, 4, 2]);
      expect(sizes(drag(flap(4, 4, 2), 'e', 2, 0))).toEqual([6, 4, 2]);
      expect(sizes(drag(flap(4, 4, 2), 'e', 3, 0))).toEqual([7, 4, 2]);
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

    it('keeps the radius above its floor even if the range contradicts itself', () => {
      // A max below the min should never yield a radius the engine will reject:
      // a rejected mid-drag step is a stuck gesture, not a visible error.
      const result = drag(flap(0, 0, 5), 'ne', 2, 2, { min: 3, max: 1 });
      expect(result?.radius ?? Infinity).toBeGreaterThanOrEqual(3);
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
