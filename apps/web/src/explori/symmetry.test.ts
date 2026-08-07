import { describe, expect, it } from 'vitest';
import { snapPointToSymmetryAxis } from '../lib/symmetryGeometry';
import {
  EXPLORI_SYMMETRY_AXIS,
  EXPLORI_SYMMETRY_TOLERANCE,
  exploriLeafPlacement,
} from './symmetry';

/**
 * Clicking near the mirror line.
 *
 * Reported as "spanning to the center line doesn't work". Measured: a click 6px
 * inside an 18px snap lane produced a node at `x = 0.107` with no pairing — it
 * counted as on the axis, so it got no twin, while being left sitting beside the
 * axis. The two halves of one decision had come apart.
 */
describe('exploriLeafPlacement', () => {
  const tol = EXPLORI_SYMMETRY_TOLERANCE;
  const inside = { x: tol / 2, y: 2 };
  const outside = { x: tol * 4, y: 2 };

  it('puts a leaf inside the lane on the axis, and gives it no twin', () => {
    const { placed, onAxis } = exploriLeafPlacement(true, inside, tol);
    expect(onAxis).toBe(true);
    expect(placed.x).toBeCloseTo(EXPLORI_SYMMETRY_AXIS.loc.x, 12);
    // Its height is the one the click asked for: the axis decides x, nothing else.
    expect(placed.y).toBeCloseTo(inside.y, 12);
  });

  it('leaves a leaf outside the lane where it was, to be twinned', () => {
    const { placed, onAxis } = exploriLeafPlacement(true, outside, tol);
    expect(onAxis).toBe(false);
    expect(placed).toEqual(outside);
  });

  it('never snaps with mirror draw off, however close the click', () => {
    const { placed, onAxis } = exploriLeafPlacement(false, inside, tol);
    expect(onAxis).toBe(false);
    expect(placed).toEqual(inside);
  });

  it('lands exactly where the hover ghost previewed', () => {
    // The ghost calls `snapPointToSymmetryAxis` with the axis and the same
    // tolerance. If the commit ever computes its own snapped point instead, the
    // preview and the click disagree — which is the failure this whole path is
    // for, so it is asserted rather than assumed.
    for (const point of [inside, outside, { x: tol, y: -3 }, { x: 0, y: 0.4 }]) {
      const ghost = snapPointToSymmetryAxis(point, EXPLORI_SYMMETRY_AXIS, tol);
      const { placed } = exploriLeafPlacement(true, point, tol);
      expect(placed).toEqual(ghost.snapped ? ghost.point : point);
    }
  });
});
