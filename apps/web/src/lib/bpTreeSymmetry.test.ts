import { describe, expect, it } from 'vitest';
import type { OristudioBpTreeVertex, OristudioBpTreeView } from '../engine/oristudioBpTypes';
import type { Point } from './geometry';
import type { SymmetryAxis } from './symmetryGeometry';
import {
  addBpTreeSymmetryPair,
  buildMirroredBpTreeUpdates,
  bpTreeDeleteIdsWithSymmetry,
  bpTreeMirrorHeldIds,
  filterBpTreeSymmetryPairs,
  inferBpTreeSymmetryPairs,
  inferBpTreeSymmetryPartner,
  mirrorBpTreeVertexId,
  removeBpTreeSymmetryPair,
} from './bpTreeSymmetry';

// A vertical axis through x = 4 (centre of an 8×8 sheet), mirroring left/right.
const axis: SymmetryAxis = { loc: { x: 4, y: 4 }, angle: 90 };

function vertex(id: number, x: number, y: number): OristudioBpTreeVertex {
  return {
    id,
    name: `v${id}`,
    loc: { x, y },
    isRoot: id === 0,
    isLeaf: id !== 0,
    degree: 1,
    dist: 0,
    height: 0,
    maxHeight: null,
    maxNewLeafLength: null,
    dualFlapId: null,
  };
}

function tree(vertices: OristudioBpTreeVertex[]): OristudioBpTreeView {
  return {
    rootVertexId: 0,
    sheet: {
      kind: 'rectangular',
      width: 8,
      height: 8,
      grid: { kind: 'rectangular', interval: 1, snap: true },
    },
    vertices,
    edges: [],
    maxTreeHeight: null,
  };
}

describe('mirrorBpTreeVertexId', () => {
  const t = tree([
    vertex(0, 4, 4), // root, on the axis
    vertex(1, 2, 6), // left
    vertex(2, 6, 6), // right — reflection of 1, not paired with it
    vertex(3, 1, 3), // left, no counterpart
  ]);

  it('prefers an explicit pair', () => {
    const pairs = addBpTreeSymmetryPair([], 1, 3);
    expect(mirrorBpTreeVertexId(t, pairs, axis, 1)).toBe(3);
  });

  it('pairs nothing by position: an unpaired vertex has no mirror, even at the reflected spot', () => {
    expect(mirrorBpTreeVertexId(t, [], axis, 1)).toBeNull();
    expect(mirrorBpTreeVertexId(t, [], axis, 2)).toBeNull();
  });

  it('treats an on-axis vertex as its own mirror', () => {
    expect(mirrorBpTreeVertexId(t, [], axis, 0)).toBe(0);
  });

  it('returns null when nothing sits at the reflected position', () => {
    expect(mirrorBpTreeVertexId(t, [], axis, 3)).toBeNull();
  });
});

describe('buildMirroredBpTreeUpdates', () => {
  const t = tree([vertex(0, 4, 4), vertex(1, 2, 6), vertex(2, 6, 6)]);
  const pairs = addBpTreeSymmetryPair([], 1, 2);

  it('reflects a moved vertex onto its pair', () => {
    const moved: { id: number; loc: Point }[] = [{ id: 1, loc: { x: 1, y: 5 } }];
    const mirrored = buildMirroredBpTreeUpdates(t, pairs, axis, moved);
    // reflect (1,5) across x=4 → (7,5), applied to vertex 2.
    expect(mirrored).toEqual([{ id: 2, loc: { x: 7, y: 5 } }]);
  });

  it('skips vertices already in the primary set (rigid whole-tree move stays a no-op)', () => {
    const moved = [
      { id: 1, loc: { x: 1, y: 5 } },
      { id: 2, loc: { x: 7, y: 5 } },
    ];
    expect(buildMirroredBpTreeUpdates(t, pairs, axis, moved)).toEqual([]);
  });

  it('partial-mirrors: unpaired vertices are simply left out', () => {
    const t2 = tree([vertex(0, 4, 4), vertex(1, 2, 6), vertex(2, 6, 6), vertex(9, 1, 1)]);
    const moved = [
      { id: 1, loc: { x: 1, y: 5 } },
      { id: 9, loc: { x: 0.5, y: 0.5 } }, // no counterpart
    ];
    expect(buildMirroredBpTreeUpdates(t2, pairs, axis, moved)).toEqual([{ id: 2, loc: { x: 7, y: 5 } }]);
  });
});

/**
 * Deleting a flap under symmetry takes its twin with it, the same way a length
 * edit applies to both sides. The pair is resolved before the engine touches the
 * tree, and both ids go in one batch so the engine can't remove one and then
 * refuse the other at the minimum-tree floor.
 */
describe('bpTreeDeleteIdsWithSymmetry', () => {
  const t = tree([
    vertex(0, 4, 4), // root, on the axis
    vertex(1, 2, 6), // left
    vertex(2, 6, 6), // right — reflection of 1, not paired with it
    vertex(3, 1, 3), // left, no counterpart
  ]);

  it('takes the pair along, from either side', () => {
    const pairs = addBpTreeSymmetryPair([], 1, 2);
    expect(bpTreeDeleteIdsWithSymmetry(t, pairs, axis, 1)).toEqual([1, 2]);
    expect(bpTreeDeleteIdsWithSymmetry(t, pairs, axis, 2)).toEqual([2, 1]);
  });

  it('follows the explicit pair, not the vertex at the reflected spot', () => {
    const pairs = addBpTreeSymmetryPair([], 1, 3);
    expect(bpTreeDeleteIdsWithSymmetry(t, pairs, axis, 1)).toEqual([1, 3]);
  });

  it('deletes an on-axis vertex once, not twice', () => {
    // It mirrors to itself; listing it twice would ask the engine to delete a
    // vertex that no longer exists on the second pass.
    expect(bpTreeDeleteIdsWithSymmetry(t, [], axis, 0)).toEqual([0]);
  });

  it('deletes an unpaired vertex alone', () => {
    expect(bpTreeDeleteIdsWithSymmetry(t, [], axis, 3)).toEqual([3]);
  });
});

describe('pair bookkeeping', () => {
  it('stores pairs min-first and dedupes', () => {
    let pairs = addBpTreeSymmetryPair([], 3, 1);
    pairs = addBpTreeSymmetryPair(pairs, 1, 3);
    expect(pairs).toEqual([{ v1: 1, v2: 3 }]);
  });

  it('unpairs from either side of the pair', () => {
    const pairs = addBpTreeSymmetryPair(addBpTreeSymmetryPair([], 1, 2), 3, 4);
    expect(removeBpTreeSymmetryPair(pairs, 2)).toEqual([{ v1: 3, v2: 4 }]);
    expect(removeBpTreeSymmetryPair(pairs, 3)).toEqual([{ v1: 1, v2: 2 }]);
    expect(removeBpTreeSymmetryPair(pairs, 9)).toEqual(pairs);
  });

  it('drops pairs that reference a removed vertex', () => {
    const t = tree([vertex(0, 4, 4), vertex(1, 2, 6)]);
    const pairs = addBpTreeSymmetryPair([], 1, 2); // vertex 2 no longer exists
    expect(filterBpTreeSymmetryPairs(t, pairs)).toEqual([]);
  });
});

describe('mirror pairing', () => {
  it('gives a vertex exactly one mirror', () => {
    let pairs = addBpTreeSymmetryPair([], 1, 2);
    pairs = addBpTreeSymmetryPair(pairs, 2, 3);
    expect(pairs).toEqual([{ v1: 2, v2: 3 }]);
  });

  it('ignores a vertex paired with itself', () => {
    // On-axis is read from the drawing, not declared: a flap drawn on the mirror
    // line snaps onto it and is inferred as its own mirror.
    expect(addBpTreeSymmetryPair([], 5, 5)).toEqual([]);
  });
});

/**
 * Unpair moves nothing, so the two vertices are still reflections of each other
 * the moment the pair is gone. Position must not pair them again: a pair exists
 * because the user made one, and Unpair is how they say these two are not
 * partners.
 */
describe('after Unpair', () => {
  const t = tree([vertex(0, 4, 4), vertex(1, 2, 6), vertex(2, 6, 6)]);
  const pairs = removeBpTreeSymmetryPair(addBpTreeSymmetryPair([], 1, 2), 1);

  it('resolves no mirror from position alone', () => {
    expect(pairs).toEqual([]);
    expect(mirrorBpTreeVertexId(t, pairs, axis, 1)).toBeNull();
    expect(mirrorBpTreeVertexId(t, pairs, axis, 2)).toBeNull();
  });

  it('still reads an on-axis vertex as its own mirror', () => {
    expect(mirrorBpTreeVertexId(t, pairs, axis, 0)).toBe(0);
  });

  it('moves, holds and deletes one vertex', () => {
    const moved = [{ id: 1, loc: { x: 1, y: 7 } }];
    expect(buildMirroredBpTreeUpdates(t, pairs, axis, moved)).toEqual([]);
    expect(bpTreeMirrorHeldIds(t, pairs, axis, [1]).size).toBe(0);
    expect(bpTreeDeleteIdsWithSymmetry(t, pairs, axis, 1)).toEqual([1]);
  });
});

/**
 * The Pair verbs. Position proposes a pair here and nowhere else, and only on
 * request — so the rules are strict where the old fallback was lenient: both
 * sides unpaired and off the axis, within tolerance, and mutual.
 */
describe('inferBpTreeSymmetryPartner', () => {
  const t = tree([
    vertex(0, 4, 4), // root, on the axis
    vertex(1, 2, 6), // left
    vertex(2, 6, 6), // right — reflection of 1
    vertex(3, 1, 3), // left, nothing opposite
  ]);

  it('offers the vertex at the reflected spot', () => {
    expect(inferBpTreeSymmetryPartner(t, [], axis, 1)).toBe(2);
    expect(inferBpTreeSymmetryPartner(t, [], axis, 2)).toBe(1);
  });

  it('offers nothing to a vertex with nothing opposite, or on the axis', () => {
    expect(inferBpTreeSymmetryPartner(t, [], axis, 3)).toBeNull();
    expect(inferBpTreeSymmetryPartner(t, [], axis, 0)).toBeNull();
  });

  it('offers nothing to or from a vertex that is already paired', () => {
    const pairs = addBpTreeSymmetryPair([], 2, 3);
    expect(inferBpTreeSymmetryPartner(t, pairs, axis, 1)).toBeNull();
    expect(inferBpTreeSymmetryPartner(t, pairs, axis, 2)).toBeNull();
  });

  it('is mutual: a crowded reflection pairs the nearest two and leaves the third', () => {
    // 2 and 4 both sit within tolerance of 1's reflection. 1's nearest is 2 and
    // 2's nearest is 1, so they pair; 4's nearest is 1, but 1 does not answer 4.
    const crowded = tree([vertex(0, 4, 4), vertex(1, 2, 6), vertex(2, 6.01, 6), vertex(4, 6.015, 6)]);
    expect(inferBpTreeSymmetryPartner(crowded, [], axis, 1)).toBe(2);
    expect(inferBpTreeSymmetryPartner(crowded, [], axis, 4)).toBeNull();
  });

  it('respects the tolerance', () => {
    const far = tree([vertex(0, 4, 4), vertex(1, 2, 6), vertex(2, 6.05, 6)]);
    expect(inferBpTreeSymmetryPartner(far, [], axis, 1)).toBeNull();
  });
});

describe('inferBpTreeSymmetryPairs', () => {
  it('pairs every mirrored vertex once and leaves the rest alone', () => {
    // 1–2 and 3–4 reflect; 5 has nothing opposite; 0 sits on the axis.
    const t = tree([
      vertex(0, 4, 4),
      vertex(1, 2, 6),
      vertex(2, 6, 6),
      vertex(3, 1, 3),
      vertex(4, 7, 3),
      vertex(5, 2, 2),
    ]);
    expect(inferBpTreeSymmetryPairs(t, [], axis)).toEqual([
      { v1: 1, v2: 2 },
      { v1: 3, v2: 4 },
    ]);
  });

  it('returns the same array when nothing new pairs', () => {
    const t = tree([vertex(0, 4, 4), vertex(1, 2, 6), vertex(2, 6, 6)]);
    const pairs = addBpTreeSymmetryPair([], 1, 2);
    expect(inferBpTreeSymmetryPairs(t, pairs, axis)).toBe(pairs);
  });

  it('does not pair across an existing pair', () => {
    // 2 is already paired with 3, so 1 stays alone though 2 sits at its reflection.
    const t = tree([vertex(0, 4, 4), vertex(1, 2, 6), vertex(2, 6, 6), vertex(3, 1, 3)]);
    const pairs = addBpTreeSymmetryPair([], 2, 3);
    expect(inferBpTreeSymmetryPairs(t, pairs, axis)).toBe(pairs);
  });
});
