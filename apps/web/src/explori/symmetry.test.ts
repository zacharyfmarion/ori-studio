import { describe, expect, it } from 'vitest';
import { snapPointToSymmetryAxis } from '../lib/symmetryGeometry';
import { createExploriDocument, type ExploriDocument } from './document';
import type { TreeSymmetryPair } from '../tree-editor/host';
import {
  EXPLORI_SYMMETRY_AXIS,
  EXPLORI_SYMMETRY_TOLERANCE,
  addExploriPair,
  exploriLeafPlacement,
  exploriMirrorHeldIds,
  inferExploriPairs,
  inferExploriPartner,
  mirrorExploriNodeId,
  removeExploriPair,
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

/**
 * Same rule as box-pleat's: Unpair moves nothing, so the two nodes are still
 * reflections of each other when the pair is gone, and that must not pair them
 * again.
 */
describe('mirrorExploriNodeId after Unpair', () => {
  //   0 (root, on the axis)
  //   ├─ 1 (left)   ── reflection of 2
  //   └─ 2 (right)  ── reflection of 1
  function unpaired(): ExploriDocument {
    return {
      ...createExploriDocument(),
      nodes: [
        { id: 0, loc: { x: 0, y: 0 }, name: '' },
        { id: 1, loc: { x: -2, y: 1 }, name: '' },
        { id: 2, loc: { x: 2, y: 1 }, name: '' },
      ],
      edges: [
        { id: 10, vertices: [0, 1], length: 1 },
        { id: 11, vertices: [0, 2], length: 1 },
      ],
      symmetry: { enabled: true, pairs: removeExploriPair(addExploriPair([], 1, 2), 1) },
    };
  }

  it('resolves no partner from position alone', () => {
    expect(unpaired().symmetry.pairs).toEqual([]);
    expect(mirrorExploriNodeId(unpaired(), 1)).toBeNull();
    expect(mirrorExploriNodeId(unpaired(), 2)).toBeNull();
  });

  it('still reads a node on the axis as its own mirror', () => {
    expect(mirrorExploriNodeId(unpaired(), 0)).toBe(0);
  });

  it('holds nothing in its half', () => {
    expect(exploriMirrorHeldIds(unpaired(), [1]).size).toBe(0);
  });
});

/**
 * The Pair verbs: position proposes a pair here, on request, and nowhere else.
 */
describe('the Pair verbs', () => {
  //   0 (root, on the axis)
  //   ├─ 1 (left)   ── reflection of 2
  //   ├─ 2 (right)  ── reflection of 1
  //   └─ 3 (left, nothing opposite)
  function drawing(pairs: TreeSymmetryPair[] = []): ExploriDocument {
    return {
      ...createExploriDocument(),
      nodes: [
        { id: 0, loc: { x: 0, y: 0 }, name: '' },
        { id: 1, loc: { x: -2, y: 1 }, name: '' },
        { id: 2, loc: { x: 2, y: 1 }, name: '' },
        { id: 3, loc: { x: -1, y: 3 }, name: '' },
      ],
      edges: [
        { id: 10, vertices: [0, 1], length: 1 },
        { id: 11, vertices: [0, 2], length: 1 },
        { id: 12, vertices: [0, 3], length: 1 },
      ],
      symmetry: { enabled: true, pairs },
    };
  }

  it('offers the node at the reflected spot, and nothing to the rest', () => {
    expect(inferExploriPartner(drawing(), 1)).toBe(2);
    expect(inferExploriPartner(drawing(), 2)).toBe(1);
    expect(inferExploriPartner(drawing(), 3)).toBeNull();
    expect(inferExploriPartner(drawing(), 0)).toBeNull();
  });

  it('offers nothing to or from a node that is already paired', () => {
    const paired = drawing(addExploriPair([], 2, 3));
    expect(inferExploriPartner(paired, 1)).toBeNull();
    expect(inferExploriPartner(paired, 2)).toBeNull();
  });

  it('pairs everything mirrored at once, and returns the same list when nothing pairs', () => {
    expect(inferExploriPairs(drawing())).toEqual([{ v1: 1, v2: 2 }]);
    const done = drawing(addExploriPair([], 1, 2));
    expect(inferExploriPairs(done)).toBe(done.symmetry.pairs);
  });
});
