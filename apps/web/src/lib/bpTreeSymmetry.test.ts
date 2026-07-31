import { describe, expect, it } from 'vitest';
import type { OristudioBpTreeVertex, OristudioBpTreeView } from '../engine/oristudioBpTypes';
import type { Point } from './geometry';
import type { SymmetryAxis } from './symmetryGeometry';
import {
  addBpTreeSymmetryPair,
  bpTreeSymmetryRole,
  buildMirroredBpTreeUpdates,
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

describe('pair bookkeeping', () => {
  it('stores pairs min-first and dedupes', () => {
    let pairs = addBpTreeSymmetryPair([], 3, 1);
    pairs = addBpTreeSymmetryPair(pairs, 1, 3);
    expect(pairs).toEqual([{ v1: 1, v2: 3 }]);
  });

  it('drops pairs that reference a removed vertex', () => {
    const t = tree([vertex(0, 4, 4), vertex(1, 2, 6)]);
    const pairs = addBpTreeSymmetryPair([], 1, 2); // vertex 2 no longer exists
    expect(filterBpTreeSymmetryPairs(t, pairs)).toEqual([]);
  });
});

describe('mirror pairing', () => {
  it('records a flap on the axis as a pair with itself', () => {
    // A flap on the axis has no partner to pair with, so this is the only way to
    // say it is its own mirror image.
    const pairs = addBpTreeSymmetryPair([], 5, 5);
    expect(pairs).toEqual([{ v1: 5, v2: 5 }]);
    expect(bpTreeSymmetryRole(pairs, 5)).toBe('on-axis');
  });

  it('gives a vertex exactly one mirror', () => {
    let pairs = addBpTreeSymmetryPair([], 1, 2);
    pairs = addBpTreeSymmetryPair(pairs, 2, 3);
    expect(pairs).toEqual([{ v1: 2, v2: 3 }]);
    expect(bpTreeSymmetryRole(pairs, 1)).toBeNull();
    expect(bpTreeSymmetryRole(pairs, 2)).toBe('paired');
  });

  it('replaces an on-axis declaration when the flap is paired instead', () => {
    let pairs = addBpTreeSymmetryPair([], 4, 4);
    pairs = addBpTreeSymmetryPair(pairs, 4, 7);
    expect(pairs).toEqual([{ v1: 4, v2: 7 }]);
  });

  it('clears whatever pairing a vertex had', () => {
    const pairs = removeBpTreeSymmetryPair(addBpTreeSymmetryPair([], 1, 2), 1);
    expect(pairs).toEqual([]);
  });

  it('keeps on-axis declarations when pruning to existing vertices', () => {
    const t = tree([vertex(0, 4, 4), vertex(1, 2, 6)]);
    const pairs = [
      { v1: 1, v2: 1 },
      { v1: 1, v2: 9 },
    ];
    expect(filterBpTreeSymmetryPairs(t, pairs)).toEqual([{ v1: 1, v2: 1 }]);
  });
});
