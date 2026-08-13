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

function sizes(footprint: BpFlapFootprint | null): [number, number, number] | null {
  return footprint ? [footprint.width, footprint.height, footprint.radius] : null;
}

describe('solveBpFlapReshape', () => {
  describe('the radius takes the drag where it can', () => {
    it('grows a circular flap on a corner drag as pure radius', () => {
      expect(sizes(drag(flap(0, 0, 5), 'ne', 2, 2))).toEqual([0, 0, 6]);
    });

    it('leaves the radius alone on an edge drag with no slack to pay with', () => {
      // h = 0, so there is no height to trade for radius: a circle made wider and
      // not taller is a capsule, which is exactly what a width is for.
      expect(sizes(drag(flap(0, 0, 5), 'e', 2, 0))).toEqual([2, 0, 5]);
    });

    it('spends the height on the radius when the height has slack', () => {
      expect(sizes(drag(flap(4, 4, 2), 'e', 2, 0))).toEqual([4, 2, 3]);
    });

    it('shrinks the radius first, so a drag reverses exactly', () => {
      expect(sizes(drag(flap(4, 2, 3), 'e', -2, 0))).toEqual([4, 4, 2]);
    });

    it('turns a squeezed circle into a capsule on the pinned axis', () => {
      // The outer height was not dragged, so it is held: the circle narrows into
      // a vertical stadium rather than simply becoming a smaller circle.
      expect(sizes(drag(flap(0, 0, 5), 'e', -2, 0))).toEqual([0, 2, 4]);
    });

    it('refuses to shrink the outer box below the minimum radius', () => {
      expect(drag(flap(0, 0, 1), 'e', -1, 0)).toBeNull();
    });
  });

  describe('a corner drag grows the radius even when its two axes differ', () => {
    // The reported bug. `δ` is bounded per axis by `w + Δx ≥ 2δ`, so before this
    // the axis that moved *less* capped the radius and one odd cell capped it at
    // zero — which a hand-dragged corner produces nearly every time. Dragging a
    // circle's corner out has to give a bigger circle.
    it('spends the drag on the radius when one axis lands a cell short', () => {
      expect(sizes(drag(flap(0, 0, 2), 'ne', 2, 1))).toEqual([0, 0, 3]);
    });

    it('still grows it from a flap that has a box', () => {
      expect(sizes(drag(flap(2, 2, 1), 'ne', 3, 1))).toEqual([3, 1, 2]);
    });

    it('pays for it by overshooting the shorter axis, never the pinned edges', () => {
      const source = flap(0, 0, 2);
      const before = bpFlapOuterBox(source);
      const result = drag(source, 'ne', 2, 1)!;
      const after = bpFlapOuterBox(result);
      // The axis that drove the radius is exact.
      expect(after.x + after.width).toBe(before.x + before.width + 2);
      // The shorter one lands one cell past the pointer — the whole cost.
      expect(after.y + after.height).toBe(before.y + before.height + 2);
      // And the corner opposite the one being dragged has not moved at all.
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
    });

    it('overshoots by less than the cell the radius had to take', () => {
      // The squeeze can only ever swallow what one dimension had left, so the
      // miss is bounded by the radius step — never a runaway.
      for (let dy = 0; dy <= 6; dy++) {
        const source = flap(1, 1, 3);
        const result = drag(source, 'ne', 6, dy);
        if (!result) continue;
        const asked = bpFlapOuterBox(source).height + dy;
        const got = bpFlapOuterBox(result).height;
        expect(got - asked).toBeLessThanOrEqual(2 * (result.radius - source.radius));
        expect(got).toBeGreaterThanOrEqual(asked);
      }
    });
  });

  describe('the squeeze is scoped to axes the drag is growing', () => {
    it('leaves an edge drag unable to make the flap taller', () => {
      // The un-dragged extent is still a hard bound: an east drag on a circular
      // flap has no height to trade, so the width takes all of it.
      const source = flap(0, 0, 5);
      const before = bpFlapOuterBox(source);
      const result = drag(source, 'e', 4, 0)!;
      expect(sizes(result)).toEqual([4, 0, 5]);
      expect(bpFlapOuterBox(result).height).toBe(before.height);
    });

    it('keeps a corner that grows one way and shrinks the other exact on both', () => {
      const source = flap(0, 0, 4);
      const before = bpFlapOuterBox(source);
      const result = drag(source, 'ne', 2, -2)!;
      const after = bpFlapOuterBox(result);
      expect(after.width).toBe(before.width + 2);
      expect(after.height).toBe(before.height - 2);
    });

    it('keeps a corner dragged inward exact', () => {
      const source = flap(0, 0, 5);
      const before = bpFlapOuterBox(source);
      const result = drag(source, 'ne', -2, -2)!;
      expect(sizes(result)).toEqual([0, 0, 4]);
      expect(bpFlapOuterBox(result).width).toBe(before.width - 2);
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
      // The north handle drives only y, so Δx is zero — but the radius still
      // grows, and the anchor has to walk east to hold the x edges still.
      const result = drag(flap(4, 4, 2), 'n', 0, 2);
      expect(sizes(result)).toEqual([2, 4, 3]);
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

    it('puts the odd cell in the box rather than moving the radius against the drag', () => {
      // W = w + 2r, so the radius can only absorb an even change. One cell out
      // widens the box; two cells out moves the radius and the height pays.
      expect(sizes(drag(flap(4, 4, 2), 'e', 1, 0))).toEqual([5, 4, 2]);
      expect(sizes(drag(flap(4, 4, 2), 'e', 2, 0))).toEqual([4, 2, 3]);
      expect(sizes(drag(flap(4, 4, 2), 'e', 3, 0))).toEqual([5, 2, 3]);
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
