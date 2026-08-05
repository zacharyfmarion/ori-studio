import { describe, expect, it } from 'vitest';
import type {
  OristudioBpFlap,
  OristudioBpSheet,
  OristudioBpTreeVertex,
  OristudioBpTreeView,
} from '../engine/oristudioBpTypes';
import type { OptimizerSymmetryAxis } from './bpOptimizerSymmetry';
import type { SymmetryAxis } from './symmetryGeometry';
import {
  bpFlapAxisSpan,
  constrainBpFlapGroupToAxisSides,
  bpPackingSheetCenter,
  bpPackingSheetSupportsAxis,
  bpPackingSymmetryAxis,
  buildMirroredBpFlapMoves,
  constrainBpFlapMoveToAxis,
  isBpFlapOnAxis,
  mirrorBpFlapAnchor,
  projectBpFlapAnchorOntoAxis,
} from './bpPackingSymmetry';

/**
 * The layout sheet is deliberately a different size from the tree sheet in every
 * fixture here (16 vs 8). Reflecting a flap about the *tree's* axis is the
 * mistake this module exists to prevent, and two equal sheets would hide it.
 */
function sheet(
  kind: OristudioBpSheet['kind'] = 'rectangular',
  width = 16,
  height = 16
): OristudioBpSheet {
  return { kind, width, height, grid: { kind: 'rectangular', interval: 1, snap: true } };
}

function flap(id: number, x: number, y: number, width = 0, height = 0): OristudioBpFlap {
  return {
    id,
    vertexId: id,
    name: `f${id}`,
    anchor: { x, y },
    width,
    height,
    radius: 1,
    constrained: true,
  };
}

// Tree sheet is 8×8, so its mirror line is x = 4 — nowhere near the layout
// sheet's centre at 8.
const TREE_AXIS: SymmetryAxis = { loc: { x: 4, y: 4 }, angle: 90 };

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

//   0 (root, on the tree axis)
//   ├─ 1 (left)  ── mirrors 2
//   ├─ 2 (right) ── mirrors 1
//   └─ 3 (left, no counterpart)
function tree(): OristudioBpTreeView {
  return {
    rootVertexId: 0,
    sheet: sheet('rectangular', 8, 8),
    vertices: [vertex(0, 4, 4), vertex(1, 2, 6), vertex(2, 6, 6), vertex(3, 1, 3)],
    edges: [],
    maxTreeHeight: null,
  };
}

const CENTER = { x: 8, y: 8 };

describe('bpPackingSheetCenter', () => {
  it('is the middle of a rectangular sheet', () => {
    expect(bpPackingSheetCenter(sheet('rectangular', 16, 10))).toEqual({ x: 8, y: 5 });
  });

  it('is the middle of a diagonal sheet, even and odd', () => {
    expect(bpPackingSheetCenter(sheet('diagonal', 12, 12))).toEqual({ x: 6, y: 6 });
    // An odd diagonal sheet renders into a square one cell larger, shifted half a
    // cell, so the two offsets cancel and the centre is still size/2.
    expect(bpPackingSheetCenter(sheet('diagonal', 11, 11))).toEqual({ x: 5.5, y: 5.5 });
  });
});

describe('mirrorBpFlapAnchor', () => {
  // Transcribed from SymmetryAxis::mirror_grid in
  // crates/oristudio-bp/src/optimizer.rs, rewritten about the sheet centre. The
  // flap is deliberately non-square: an anchor-only reflection (one that drops
  // the size term) passes for a point flap and fails here.
  const box = { width: 3, height: 1 };

  it('reflects a vertical mirror, picking up the width', () => {
    expect(mirrorBpFlapAnchor({ x: 2, y: 5 }, box, CENTER, 'verticalHalf')).toEqual({
      x: 16 - 2 - 3,
      y: 5,
    });
  });

  it('reflects a horizontal mirror, picking up the height', () => {
    expect(mirrorBpFlapAnchor({ x: 2, y: 5 }, box, CENTER, 'horizontalHalf')).toEqual({
      x: 2,
      y: 16 - 5 - 1,
    });
  });

  it('swaps the coordinates on the main diagonal, with no size term', () => {
    expect(mirrorBpFlapAnchor({ x: 2, y: 5 }, box, CENTER, 'mainDiagonal')).toEqual({
      x: 5,
      y: 2,
    });
  });

  it('reflects the anti-diagonal with the sizes exchanged', () => {
    expect(mirrorBpFlapAnchor({ x: 2, y: 5 }, box, CENTER, 'antiDiagonal')).toEqual({
      x: 16 - 5 - 1,
      y: 16 - 2 - 3,
    });
  });

  it('is an involution on every axis', () => {
    const axes: OptimizerSymmetryAxis[] = [
      'verticalHalf',
      'horizontalHalf',
      'mainDiagonal',
      'antiDiagonal',
    ];
    for (const axis of axes) {
      // The mirrored box has its dimensions exchanged on a diagonal, so mirroring
      // back has to be told about the box it is actually reflecting.
      const swapped = axis === 'mainDiagonal' || axis === 'antiDiagonal';
      const mirroredBox = swapped ? { width: box.height, height: box.width } : box;
      const once = mirrorBpFlapAnchor({ x: 2, y: 5 }, box, CENTER, axis);
      expect(mirrorBpFlapAnchor(once, mirroredBox, CENTER, axis)).toEqual({ x: 2, y: 5 });
    }
  });
});

describe('isBpFlapOnAxis', () => {
  it('accepts a box centred on a vertical mirror', () => {
    expect(isBpFlapOnAxis({ x: 6.5, y: 3 }, { width: 3, height: 1 }, CENTER, 'verticalHalf')).toBe(
      true
    );
  });

  it('rejects one that is merely near it', () => {
    expect(isBpFlapOnAxis({ x: 5, y: 3 }, { width: 3, height: 1 }, CENTER, 'verticalHalf')).toBe(
      false
    );
  });

  it('accepts a square flap on the main diagonal', () => {
    expect(isBpFlapOnAxis({ x: 3, y: 3 }, { width: 2, height: 2 }, CENTER, 'mainDiagonal')).toBe(
      true
    );
  });

  it('rejects a non-square flap on the main diagonal, which a mirror turns', () => {
    expect(isBpFlapOnAxis({ x: 3, y: 3 }, { width: 2, height: 1 }, CENTER, 'mainDiagonal')).toBe(
      false
    );
  });
});

describe('projectBpFlapAnchorOntoAxis', () => {
  it('pins x and leaves the flap free along a vertical mirror', () => {
    expect(
      projectBpFlapAnchorOntoAxis({ x: 1, y: 12 }, { width: 3, height: 1 }, CENTER, 'verticalHalf')
    ).toEqual({ x: 6.5, y: 12 });
  });

  it('lands on the axis on every axis', () => {
    const axes: OptimizerSymmetryAxis[] = [
      'verticalHalf',
      'horizontalHalf',
      'mainDiagonal',
      'antiDiagonal',
    ];
    const box = { width: 2, height: 2 };
    for (const axis of axes) {
      const projected = projectBpFlapAnchorOntoAxis({ x: 1, y: 12 }, box, CENTER, axis);
      expect(isBpFlapOnAxis(projected, box, CENTER, axis)).toBe(true);
    }
  });
});

describe('bpPackingSymmetryAxis / bpPackingSheetSupportsAxis', () => {
  it('maps a book fold to the vertical axis on a rectangular sheet', () => {
    expect(bpPackingSymmetryAxis(sheet('rectangular'), 'book')).toBe('verticalHalf');
    expect(bpPackingSymmetryAxis(sheet('rectangular'), 'diagonal')).toBe('mainDiagonal');
  });

  it('swaps the roles on a diagonal sheet, whose paper is turned 45 degrees', () => {
    expect(bpPackingSymmetryAxis(sheet('diagonal'), 'book')).toBe('mainDiagonal');
    expect(bpPackingSymmetryAxis(sheet('diagonal'), 'diagonal')).toBe('verticalHalf');
  });

  it('refuses a diagonal mirror on a sheet that is not square', () => {
    expect(bpPackingSheetSupportsAxis(sheet('rectangular', 16, 10), 'mainDiagonal')).toBe(false);
    expect(bpPackingSheetSupportsAxis(sheet('rectangular', 16, 10), 'verticalHalf')).toBe(true);
    expect(bpPackingSheetSupportsAxis(sheet('rectangular', 16, 16), 'mainDiagonal')).toBe(true);
  });
});

describe('buildMirroredBpFlapMoves', () => {
  const flaps = [flap(1, 2, 6, 2, 1), flap(2, 12, 6, 2, 1), flap(3, 1, 3, 1, 1)];

  function build(
    moves: { id: number; loc: { x: number; y: number } }[],
    options: { fold?: 'book' | 'diagonal'; sheetSize?: [number, number] } = {}
  ) {
    const [width, height] = options.sheetSize ?? [16, 16];
    return buildMirroredBpFlapMoves({
      tree: tree(),
      pairs: [],
      treeAxis: TREE_AXIS,
      sheet: sheet('rectangular', width, height),
      fold: options.fold ?? 'book',
      flaps,
      moves,
    });
  }

  it('mirrors about the layout sheet centre, not the tree axis', () => {
    // The tree's mirror line is x = 4; the layout sheet's is x = 8. Reflecting
    // about the tree's would put the partner at x = 4, not x = 12.
    expect(build([{ id: 1, loc: { x: 3, y: 9 } }])).toEqual([
      { id: 2, loc: { x: 16 - 3 - 2, y: 9 } },
    ]);
  });

  it('works from either member of the pair', () => {
    expect(build([{ id: 2, loc: { x: 11, y: 4 } }])).toEqual([
      { id: 1, loc: { x: 16 - 11 - 2, y: 4 } },
    ]);
  });

  it('honours an explicit pair over the geometric guess', () => {
    const mirrored = buildMirroredBpFlapMoves({
      tree: tree(),
      pairs: [{ v1: 1, v2: 3 }],
      treeAxis: TREE_AXIS,
      sheet: sheet(),
      fold: 'book',
      flaps,
      moves: [{ id: 1, loc: { x: 3, y: 9 } }],
    });
    expect(mirrored.map((move) => move.id)).toEqual([3]);
  });

  it('leaves an unpaired flap alone rather than blocking the move', () => {
    expect(build([{ id: 3, loc: { x: 5, y: 5 } }])).toEqual([]);
  });

  it('skips a partner that is already being moved', () => {
    expect(
      build([
        { id: 1, loc: { x: 3, y: 9 } },
        { id: 2, loc: { x: 11, y: 9 } },
      ])
    ).toEqual([]);
  });

  it('mirrors the target, so a drifted partner snaps back into symmetry', () => {
    // Flap 2 starts at x = 12, which is not the mirror of flap 1's new x = 5.
    // The partner goes where the mirror says, not where its own offset would.
    expect(build([{ id: 1, loc: { x: 5, y: 6 } }])).toEqual([
      { id: 2, loc: { x: 16 - 5 - 2, y: 6 } },
    ]);
  });

  it('returns nothing when the fold has no mirror on this sheet', () => {
    expect(build([{ id: 1, loc: { x: 3, y: 9 } }], { fold: 'diagonal', sheetSize: [16, 10] })).toEqual(
      []
    );
  });
});

describe('constrainBpFlapMoveToAxis', () => {
  it('slides an on-axis flap along the mirror instead of off it', () => {
    const centred = flap(1, 7, 4, 2, 1);
    expect(constrainBpFlapMoveToAxis(centred, { x: 2, y: 11 }, sheet(), 'book')).toEqual({
      x: 7,
      y: 11,
    });
  });

  it('leaves an off-axis flap unconstrained', () => {
    expect(constrainBpFlapMoveToAxis(flap(1, 2, 4, 2, 1), { x: 3, y: 9 }, sheet(), 'book')).toBeNull();
  });

  it('leaves everything unconstrained when the fold has no mirror here', () => {
    const centred = flap(1, 7, 4, 2, 2);
    expect(
      constrainBpFlapMoveToAxis(centred, { x: 2, y: 11 }, sheet('rectangular', 16, 10), 'diagonal')
    ).toBeNull();
  });
});

describe('constrainBpFlapGroupToAxisSides', () => {
  // The mirror of a 16-wide sheet is x = 8.
  const paired = (ids: number[]) => new Set(ids);

  it('stops a paired flap before any of it crosses the mirror', () => {
    // Flap 1 sits at x = 10 and is 3 wide, so its left edge may reach x = 8 and
    // no further. Dragging it to 6 would put [6, 9] across the axis, and its
    // partner at [7, 10] — the flap on top of its own reflection.
    const flap1 = flap(1, 10, 4, 3, 2);
    expect(
      constrainBpFlapGroupToAxisSides({
        moving: [flap1],
        target: { x: 6, y: 5 },
        sheet: sheet(),
        fold: 'book',
        pairedIds: paired([1]),
      })
    ).toEqual({ x: 8, y: 5 });
  });

  it('lets it slide along the mirror once it is up against it', () => {
    // Only the component across the axis is clamped, so the drag is not refused:
    // the y it asked for comes through untouched.
    const flap1 = flap(1, 8, 4, 3, 2);
    expect(
      constrainBpFlapGroupToAxisSides({
        moving: [flap1],
        target: { x: 2, y: 13 },
        sheet: sheet(),
        fold: 'book',
        pairedIds: paired([1]),
      })
    ).toEqual({ x: 8, y: 13 });
  });

  it('holds a left-half flap on its own side too', () => {
    const flap1 = flap(1, 3, 4, 3, 2);
    expect(
      constrainBpFlapGroupToAxisSides({
        moving: [flap1],
        target: { x: 9, y: 4 },
        sheet: sheet(),
        fold: 'book',
        pairedIds: paired([1]),
      })
    ).toEqual({ x: 5, y: 4 });
  });

  it('leaves an unpaired flap free to cross', () => {
    const flap1 = flap(1, 10, 4, 3, 2);
    expect(
      constrainBpFlapGroupToAxisSides({
        moving: [flap1],
        target: { x: 2, y: 4 },
        sheet: sheet(),
        fold: 'book',
        pairedIds: paired([]),
      })
    ).toEqual({ x: 2, y: 4 });
  });

  it('takes the tightest limit across a group', () => {
    // Both are paired and in the right half; flap 2 is nearer the mirror, so it
    // is the one that decides how far the shared translation may go.
    const near = flap(2, 9, 8, 1, 1);
    expect(
      constrainBpFlapGroupToAxisSides({
        moving: [flap(1, 12, 4, 2, 2), near],
        target: { x: 8, y: 4 },
        sheet: sheet(),
        fold: 'book',
        pairedIds: paired([1, 2]),
      })
      // Flap 2 may give up 1 cell, so the reference gives up 1 too: 12 -> 11.
    ).toEqual({ x: 11, y: 4 });
  });

  it('will not move a group that spans both halves across the mirror at all', () => {
    expect(
      constrainBpFlapGroupToAxisSides({
        moving: [flap(1, 8, 4, 2, 2), flap(2, 6, 4, 2, 2)],
        target: { x: 11, y: 9 },
        sheet: sheet(),
        fold: 'book',
        pairedIds: paired([1, 2]),
      })
      // The y comes through; the x cannot, because flap 2's right edge is already
      // on the mirror.
    ).toEqual({ x: 8, y: 9 });
  });

  it('clamps against a diagonal mirror on the diagonal, not on x', () => {
    // Main diagonal through the centre: the box has to stay below y = x.
    const constrained = constrainBpFlapGroupToAxisSides({
      moving: [flap(1, 12, 2, 2, 2)],
      target: { x: 4, y: 10 },
      sheet: sheet(),
      fold: 'diagonal',
      pairedIds: paired([1]),
    });
    const span = bpFlapAxisSpan(constrained, { width: 2, height: 2 }, CENTER, 'mainDiagonal');
    expect(span.min).toBeCloseTo(0, 9);
  });

  it('leaves a flap that already straddles the mirror alone', () => {
    // Nothing to preserve — snapping it to one side would be a second, unasked
    // edit on top of the drag.
    const straddling = flap(1, 7, 4, 3, 2);
    expect(
      constrainBpFlapGroupToAxisSides({
        moving: [straddling],
        target: { x: 4, y: 4 },
        sheet: sheet(),
        fold: 'book',
        pairedIds: paired([1]),
      })
    ).toEqual({ x: 4, y: 4 });
  });
});
