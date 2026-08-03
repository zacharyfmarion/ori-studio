import { describe, expect, it } from 'vitest';
import type { OristudioBpTreeVertex, OristudioBpTreeView } from '../engine/oristudioBpTypes';
import type { Point } from './geometry';
import type { SymmetryAxis } from './symmetryGeometry';
import {
  addBpTreeSymmetryPair,
  buildMirroredBpTreeUpdates,
  bpTreeDeleteIdsWithSymmetry,
  filterBpTreeSymmetryPairs,
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
    vertex(2, 6, 6), // right — geometric mirror of 1
    vertex(3, 1, 3), // left, no counterpart
  ]);

  it('prefers an explicit pair', () => {
    const pairs = addBpTreeSymmetryPair([], 1, 3);
    expect(mirrorBpTreeVertexId(t, pairs, axis, 1)).toBe(3);
  });

  it('infers the reflected vertex geometrically when unpaired', () => {
    expect(mirrorBpTreeVertexId(t, [], axis, 1)).toBe(2);
    expect(mirrorBpTreeVertexId(t, [], axis, 2)).toBe(1);
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

  it('reflects a moved vertex onto its geometric pair', () => {
    const moved: { id: number; loc: Point }[] = [{ id: 1, loc: { x: 1, y: 5 } }];
    const mirrored = buildMirroredBpTreeUpdates(t, [], axis, moved);
    // reflect (1,5) across x=4 → (7,5), applied to vertex 2.
    expect(mirrored).toEqual([{ id: 2, loc: { x: 7, y: 5 } }]);
  });

  it('skips vertices already in the primary set (rigid whole-tree move stays a no-op)', () => {
    const moved = [
      { id: 1, loc: { x: 1, y: 5 } },
      { id: 2, loc: { x: 7, y: 5 } },
    ];
    expect(buildMirroredBpTreeUpdates(t, [], axis, moved)).toEqual([]);
  });

  it('partial-mirrors: unpaired vertices are simply left out', () => {
    const t2 = tree([vertex(0, 4, 4), vertex(1, 2, 6), vertex(2, 6, 6), vertex(9, 1, 1)]);
    const moved = [
      { id: 1, loc: { x: 1, y: 5 } },
      { id: 9, loc: { x: 0.5, y: 0.5 } }, // no counterpart
    ];
    expect(buildMirroredBpTreeUpdates(t2, [], axis, moved)).toEqual([{ id: 2, loc: { x: 7, y: 5 } }]);
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
    vertex(2, 6, 6), // right — geometric mirror of 1
    vertex(3, 1, 3), // left, no counterpart
  ]);

  it('takes the geometric mirror along, from either side', () => {
    expect(bpTreeDeleteIdsWithSymmetry(t, [], axis, 1)).toEqual([1, 2]);
    expect(bpTreeDeleteIdsWithSymmetry(t, [], axis, 2)).toEqual([2, 1]);
  });

  it('prefers an explicit pair over the geometric guess', () => {
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
