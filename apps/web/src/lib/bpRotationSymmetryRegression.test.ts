import { describe, expect, it } from 'vitest';
import type {
  OristudioBpSheet,
  OristudioBpTreeEdge,
  OristudioBpTreeVertex,
  OristudioBpTreeView,
} from '../engine/oristudioBpTypes';
import { resolveOptimizerSymmetry } from './bpOptimizerSymmetry';
import { mirrorAfterSheetTransform, type BpSheetTransform } from './bpPackingSymmetry';
import type { BpMirrorOrientation } from './bpTreeSymmetry';

/**
 * Rotate, then optimize, and the pairs must not change sides.
 *
 * Reported from the app: a book-symmetric design optimized, rotated a quarter
 * turn right, and optimized again came back with every mirror pair exchanged.
 *
 * The tree and the packing here are transcribed from the `.osf` files that came
 * with the report rather than invented, because the fault only shows on a design
 * that has *been* through a symmetric solve — `negativeSide` is empty until a
 * pairing resolves, and an empty one is the case the kernel skips.
 *
 * The mechanism: `negativeSide` names the member of each pair drawn on the left
 * of the tree's mirror, and the kernel enforces it against the layout axis's
 * canonical normal. A rotation moves the paper under the mirror, so the drawn
 * left half lands on the axis's *positive* side — and a payload that still names
 * the left-drawn ids asks the solver to put every pair back the way it was
 * before the rotation.
 */

const TREE_SHEET: OristudioBpSheet = {
  kind: 'rectangular',
  width: 20,
  height: 20,
  grid: { kind: 'rectangular', interval: 1, snap: true },
};

/** The design's mirror line: the tree sheet's centre, vertical. */
const AXIS_LOC = { x: 10, y: 10 };

function vertex(id: number, x: number, y: number, isLeaf: boolean): OristudioBpTreeVertex {
  return {
    id,
    name: `v${id}`,
    loc: { x, y },
    isRoot: id === 0,
    isLeaf,
    degree: isLeaf ? 1 : 3,
    dist: 0,
    height: 0,
    maxHeight: null,
    maxNewLeafLength: null,
    dualFlapId: null,
  };
}

function edge(id: number, a: number, b: number, length: number): OristudioBpTreeEdge {
  return { id, vertices: [a, b], length, maxLength: null, isLeafEdge: true, dualRiverId: null };
}

/**
 * The reported design's tree, node for node.
 *
 * Seven leaves: three mirror pairs — (3, 4), (5, 6), (9, 10) — and one leaf, 7,
 * drawn on the mirror line itself. The even ids of each pair sit at x < 10, so
 * they are the ones `negativeSide` names.
 */
function reportedTree(): OristudioBpTreeView {
  return {
    rootVertexId: 0,
    sheet: TREE_SHEET,
    vertices: [
      vertex(0, 10, 10, false),
      vertex(1, 10, 9, false),
      vertex(2, 10, 11, false),
      vertex(3, 12.427274071630972, 12.763048661038033, true),
      vertex(4, 7.572725928369028, 12.763048661038033, true),
      vertex(5, 12.58784476962723, 7.482416576160312, true),
      vertex(6, 7.41215523037277, 7.482416576160312, true),
      vertex(7, 10, 6.001458096801677, true),
      vertex(8, 10, 15.999738795758358, false),
      vertex(9, 10.800996218155682, 16.598408202443128, true),
      vertex(10, 9.199003781844318, 16.598408202443128, true),
    ],
    edges: [
      edge(0, 0, 1, 1),
      edge(1, 0, 2, 1),
      edge(2, 1, 5, 3),
      edge(3, 1, 6, 3),
      edge(4, 1, 7, 3),
      edge(5, 2, 3, 3),
      edge(6, 2, 4, 3),
      edge(7, 2, 8, 5),
      edge(8, 8, 9, 1),
      edge(9, 8, 10, 1),
    ],
    maxTreeHeight: null,
  };
}

function symmetryState(mirror: BpMirrorOrientation) {
  return {
    angle: 90,
    loc: AXIS_LOC,
    pairs: [
      { v1: 3, v2: 4 },
      { v1: 5, v2: 6 },
      { v1: 9, v2: 10 },
    ],
    ...mirror,
  };
}

const BOOK: BpMirrorOrientation = { fold: 'book', quarterTurn: false, sidesSwapped: false };
const ROTATE_RIGHT: BpSheetTransform = { kind: 'rotate', clockwise: true };

/** The ids `negativeSide` carries, sorted so the comparison is order-free. */
function negativeSide(mirror: BpMirrorOrientation): number[] {
  const resolved = resolveOptimizerSymmetry(reportedTree(), symmetryState(mirror));
  expect(resolved.ok).toBe(true);
  if (!resolved.ok) return [];
  return [...resolved.payload.negativeSide].sort((a, b) => a - b);
}

describe('rotate then re-optimize keeps every pair on its own side', () => {
  it('names the left-drawn member before anything has moved', () => {
    // 4, 6 and 10 are the ones at x < 10. Leaf 7 is on the line and has no side.
    expect(negativeSide(BOOK)).toEqual([4, 6, 10]);
    const resolved = resolveOptimizerSymmetry(reportedTree(), symmetryState(BOOK));
    expect(resolved.ok && resolved.payload.axis).toBe('verticalHalf');
  });

  it('names the other member once a rotation has moved the paper under it', () => {
    // The bug, stated as the payload: after a right turn the drawn-left half is
    // the axis's *positive* side, so the ids that belong in `negativeSide` are
    // the partners. Reporting [4, 6, 10] here is what made the second solve
    // exchange all three pairs.
    const rotated = mirrorAfterSheetTransform('rectangular', BOOK, ROTATE_RIGHT);
    expect(rotated).toEqual({ fold: 'book', quarterTurn: true, sidesSwapped: true });
    expect(negativeSide(rotated)).toEqual([3, 5, 9]);
  });

  it('is stable under a second solve: rotating once more does not oscillate', () => {
    // Two right turns put the axis back where it started while leaving the halves
    // exchanged — the case a single `quarterTurn` bit gets wrong, because it is
    // back to `false` and would report the un-rotated answer.
    let mirror = mirrorAfterSheetTransform('rectangular', BOOK, ROTATE_RIGHT);
    mirror = mirrorAfterSheetTransform('rectangular', mirror, ROTATE_RIGHT);
    expect(mirror).toEqual({ fold: 'book', quarterTurn: false, sidesSwapped: true });
    const resolved = resolveOptimizerSymmetry(reportedTree(), symmetryState(mirror));
    expect(resolved.ok && resolved.payload.axis).toBe('verticalHalf');
    expect(negativeSide(mirror)).toEqual([3, 5, 9]);
  });

  it('comes back to exactly the original payload after four right turns', () => {
    let mirror: BpMirrorOrientation = BOOK;
    const seen: number[][] = [];
    for (let turn = 0; turn < 4; turn++) {
      seen.push(negativeSide(mirror));
      mirror = mirrorAfterSheetTransform('rectangular', mirror, ROTATE_RIGHT);
    }
    expect(mirror).toEqual(BOOK);
    expect(negativeSide(mirror)).toEqual([4, 6, 10]);
    // Keep, swap, swap, keep — the period-four pattern a single bit cannot hold.
    expect(seen).toEqual([
      [4, 6, 10],
      [3, 5, 9],
      [3, 5, 9],
      [4, 6, 10],
    ]);
  });

  it('turning back the way it came restores the original payload', () => {
    const there = mirrorAfterSheetTransform('rectangular', BOOK, ROTATE_RIGHT);
    const back = mirrorAfterSheetTransform('rectangular', there, {
      kind: 'rotate',
      clockwise: false,
    });
    expect(back).toEqual(BOOK);
    expect(negativeSide(back)).toEqual([4, 6, 10]);
  });
});
