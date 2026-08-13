import { describe, expect, it } from 'vitest';
import type {
  OristudioBpFlap,
  OristudioBpSheet,
  OristudioBpTreeVertex,
  OristudioBpTreeView,
} from '../engine/oristudioBpTypes';
import type { OptimizerSymmetryAxis } from './bpOptimizerSymmetry';
import type { BpMirrorOrientation } from './bpTreeSymmetry';
import type { Point } from './geometry';
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
  mirrorAfterSheetTransform,
  mirrorBpFlapAnchor,
  mirrorBpFlapFootprint,
  projectBpFlapAnchorOntoAxis,
  type BpSheetTransform,
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

describe('mirrorBpFlapFootprint', () => {
  // A reshape changes the box, and the anchor's reflection carries the size term
  // — so the partner has to be mirrored against the *new* box. Every case here
  // uses a non-square flap, where mirroring against the old one would be off by
  // exactly the amount it grew.
  const grown = { anchor: { x: 2, y: 5 }, width: 3, height: 1 };

  it('mirrors a book fold across the vertical, keeping the dimensions', () => {
    expect(mirrorBpFlapFootprint(grown, sheet(), BOOK)).toEqual({
      anchor: { x: 16 - 2 - 3, y: 5 },
      width: 3,
      height: 1,
    });
  });

  it('exchanges the dimensions when the fold lands on a diagonal', () => {
    expect(mirrorBpFlapFootprint(grown, sheet(), DIAGONAL)).toEqual({
      anchor: { x: 5, y: 2 },
      width: 1,
      height: 3,
    });
  });

  it('is an involution: mirroring the partner gives the primary back', () => {
    for (const fold of [BOOK, DIAGONAL]) {
      const once = mirrorBpFlapFootprint(grown, sheet(), fold);
      expect(mirrorBpFlapFootprint(once!, sheet(), fold)).toEqual(grown);
    }
  });

  it('declines a diagonal fold the sheet cannot carry', () => {
    // Reachable only from a file: a design saved square and reopened after a
    // resize. Better to leave the partner alone than to send it off the paper.
    expect(mirrorBpFlapFootprint(grown, sheet('rectangular', 16, 10), DIAGONAL)).toBeNull();
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

/** The two folds, unturned — the orientation these cases were written for. */
const BOOK = { fold: 'book', quarterTurn: false, sidesSwapped: false } as const;
const DIAGONAL = { fold: 'diagonal', quarterTurn: false, sidesSwapped: false } as const;

describe('bpPackingSymmetryAxis / bpPackingSheetSupportsAxis', () => {
  it('maps a book fold to the vertical axis on a rectangular sheet', () => {
    expect(bpPackingSymmetryAxis(sheet('rectangular'), BOOK)).toBe('verticalHalf');
    expect(bpPackingSymmetryAxis(sheet('rectangular'), DIAGONAL)).toBe('mainDiagonal');
  });

  it('swaps the roles on a diagonal sheet, whose paper is turned 45 degrees', () => {
    expect(bpPackingSymmetryAxis(sheet('diagonal'), BOOK)).toBe('mainDiagonal');
    expect(bpPackingSymmetryAxis(sheet('diagonal'), DIAGONAL)).toBe('verticalHalf');
  });

  it('refuses a diagonal mirror on a sheet that is not square', () => {
    expect(bpPackingSheetSupportsAxis(sheet('rectangular', 16, 10), 'mainDiagonal')).toBe(false);
    expect(bpPackingSheetSupportsAxis(sheet('rectangular', 16, 10), 'verticalHalf')).toBe(true);
    expect(bpPackingSheetSupportsAxis(sheet('rectangular', 16, 16), 'mainDiagonal')).toBe(true);
  });

  it('reaches all four axes, which is the point of the quarter turn', () => {
    const turned = (mirror: BpMirrorOrientation) => ({ ...mirror, quarterTurn: true });
    expect(bpPackingSymmetryAxis(sheet('rectangular'), turned(BOOK))).toBe('horizontalHalf');
    expect(bpPackingSymmetryAxis(sheet('rectangular'), turned(DIAGONAL))).toBe('antiDiagonal');
    expect(bpPackingSymmetryAxis(sheet('diagonal'), turned(BOOK))).toBe('antiDiagonal');
    expect(bpPackingSymmetryAxis(sheet('diagonal'), turned(DIAGONAL))).toBe('horizontalHalf');
  });
});
describe('mirrorAfterSheetTransform', () => {
  const CW: BpSheetTransform = { kind: 'rotate', clockwise: true };
  const CCW: BpSheetTransform = { kind: 'rotate', clockwise: false };
  const FLIP_H: BpSheetTransform = { kind: 'flip', horizontal: true };
  const FLIP_V: BpSheetTransform = { kind: 'flip', horizontal: false };

  const axisAfter = (
    kind: 'rectangular' | 'diagonal',
    mirror: BpMirrorOrientation,
    transform: BpSheetTransform
  ) => bpPackingSymmetryAxis(sheet(kind), mirrorAfterSheetTransform(kind, mirror, transform));

  const apply = (mirror: BpMirrorOrientation, ...transforms: BpSheetTransform[]) =>
    transforms.reduce(
      (current, transform) => mirrorAfterSheetTransform('rectangular', current, transform),
      mirror as BpMirrorOrientation
    );

  it('leaves the mirror alone when the sheet only changes scale', () => {
    // Doubling and halving are scales about a point *on* the mirror, so it comes
    // back to itself, pointing the same way. The flaps scale with it.
    for (const transform of [{ kind: 'subdivide' }, { kind: 'unsubdivide' }] as const) {
      for (const fold of [BOOK, DIAGONAL]) {
        for (const quarterTurn of [false, true]) {
          for (const sidesSwapped of [false, true]) {
            const mirror = { ...fold, quarterTurn, sidesSwapped };
            expect(mirrorAfterSheetTransform('rectangular', mirror, transform)).toEqual(mirror);
          }
        }
      }
    }
  });

  it('turns every mirror a quarter turn when the sheet rotates', () => {
    expect(axisAfter('rectangular', BOOK, CW)).toBe('horizontalHalf');
    expect(axisAfter('rectangular', { ...BOOK, quarterTurn: true }, CW)).toBe('verticalHalf');
    expect(axisAfter('rectangular', DIAGONAL, CW)).toBe('antiDiagonal');
    expect(axisAfter('rectangular', { ...DIAGONAL, quarterTurn: true }, CW)).toBe('mainDiagonal');
  });

  it('reaches the same line whichever way it turns', () => {
    for (const mirror of [BOOK, DIAGONAL]) {
      expect(axisAfter('rectangular', mirror, CW)).toBe(axisAfter('rectangular', mirror, CCW));
    }
  });

  it('but arrives at it by opposite sides, which is why direction is named', () => {
    // The bug this exists for: a right turn and a left turn agree about the line
    // and disagree about which half of the paper the drawing's left is now on. A
    // rule that took only "rotate" had thrown that away.
    expect(apply(BOOK, CW).sidesSwapped).toBe(true);
    expect(apply(BOOK, CCW).sidesSwapped).toBe(false);
    expect(apply(DIAGONAL, CW).sidesSwapped).toBe(true);
    expect(apply(DIAGONAL, CCW).sidesSwapped).toBe(false);
  });

  it('swaps the sides on the period the rotation actually has', () => {
    // Four states, not two: the axis alternates every turn while the sides go
    // keep, swap, swap, keep. No function of `quarterTurn` alone can say this,
    // which is the whole reason for a second bit.
    const swapped: boolean[] = [];
    let mirror: BpMirrorOrientation = BOOK;
    for (let turn = 0; turn < 4; turn++) {
      swapped.push(mirror.sidesSwapped);
      mirror = apply(mirror, CW);
    }
    expect(swapped).toEqual([false, true, true, false]);
    expect(mirror).toEqual(BOOK);
  });

  it('keeps the class: a rotated book fold is still a book fold', () => {
    // What moves is which of the two axes in the class, never the class itself,
    // which is why the fold a design was drawn for never needs rewriting.
    for (const mirror of [BOOK, DIAGONAL]) {
      for (const transform of [CW, CCW, FLIP_H, FLIP_V]) {
        expect(mirrorAfterSheetTransform('rectangular', mirror, transform).fold).toBe(mirror.fold);
      }
    }
  });

  it('moves only the diagonals when the sheet is flipped', () => {
    // A reflection carries a mirror perpendicular to it onto itself, and swaps
    // the two diagonals.
    expect(axisAfter('rectangular', BOOK, FLIP_H)).toBe('verticalHalf');
    expect(axisAfter('rectangular', { ...BOOK, quarterTurn: true }, FLIP_H)).toBe('horizontalHalf');
    expect(axisAfter('rectangular', DIAGONAL, FLIP_H)).toBe('antiDiagonal');
    expect(axisAfter('rectangular', { ...DIAGONAL, quarterTurn: true }, FLIP_H)).toBe('mainDiagonal');
  });

  it('exchanges the halves only when the flip is across the mirror', () => {
    // A book-folded design flipped left-to-right lands on the same line with its
    // halves traded; flipped top-to-bottom each half slides along the mirror and
    // stays where it was.
    expect(apply(BOOK, FLIP_H).sidesSwapped).toBe(true);
    expect(apply(BOOK, FLIP_V).sidesSwapped).toBe(false);
    expect(apply({ ...BOOK, quarterTurn: true }, FLIP_H).sidesSwapped).toBe(false);
    expect(apply({ ...BOOK, quarterTurn: true }, FLIP_V).sidesSwapped).toBe(true);
  });

  it('reads the diagonal from the sheet, where a book fold is one', () => {
    // On a diamond the paper is turned 45 degrees against the grid, so it is the
    // *book* fold that runs diagonally and therefore the book fold a flip moves.
    expect(axisAfter('diagonal', BOOK, FLIP_H)).toBe('antiDiagonal');
    expect(axisAfter('diagonal', DIAGONAL, FLIP_H)).toBe('verticalHalf');
  });

  it('is undone by the opposite transform, in both fields', () => {
    for (const mirror of [BOOK, DIAGONAL]) {
      expect(apply(mirror, CW, CCW)).toEqual(mirror);
      expect(apply(mirror, CCW, CW)).toEqual(mirror);
      expect(apply(mirror, CW, CW, CW, CW)).toEqual(mirror);
      expect(apply(mirror, FLIP_H, FLIP_H)).toEqual(mirror);
      expect(apply(mirror, FLIP_V, FLIP_V)).toEqual(mirror);
    }
  });

  it('reaches all eight states, and no transform leaves the set', () => {
    // The symmetries of the square acting on an oriented line through the centre.
    // A rule that could not reach one of these would be a design nothing can
    // express — and one that left the set would be a mirror off the paper.
    const seen = new Set<string>();
    const key = (m: BpMirrorOrientation) => `${m.fold}/${m.quarterTurn}/${m.sidesSwapped}`;
    const queue: BpMirrorOrientation[] = [BOOK, DIAGONAL];
    while (queue.length > 0) {
      const mirror = queue.pop()!;
      if (seen.has(key(mirror))) continue;
      seen.add(key(mirror));
      for (const transform of [CW, CCW, FLIP_H, FLIP_V]) queue.push(apply(mirror, transform));
    }
    expect(seen.size).toBe(8);
  });
});

describe('a transformed layout keeps its partners', () => {
  // The assertion the quarter turn exists for. A pair sits at mirrored anchors;
  // after the sheet moves, asking where the partner *should* go has to name
  // where the partner actually *is* — otherwise the first drag after a rotate
  // sends every partner somewhere its partner is not.
  const SIZE = 16;
  const BOX = { width: 2, height: 2 };

  /** Where a rigid motion of the sheet takes a flap's lower-left corner. */
  function moveFlap(anchor: Point, transform: BpSheetTransform): Point {
    switch (transform.kind) {
      case 'rotate':
        // Matching `rotate_sheet`'s matrix: clockwise takes (u, v) to (v, -u).
        return transform.clockwise
          ? { x: anchor.y, y: SIZE - anchor.x - BOX.width }
          : { x: SIZE - anchor.y - BOX.height, y: anchor.x };
      case 'flip':
        return transform.horizontal
          ? { x: SIZE - anchor.x - BOX.width, y: anchor.y }
          : { x: anchor.x, y: SIZE - anchor.y - BOX.height };
      default:
        return anchor;
    }
  }

  const TRANSFORMS: BpSheetTransform[] = [
    { kind: 'rotate', clockwise: true },
    { kind: 'rotate', clockwise: false },
    { kind: 'flip', horizontal: true },
    { kind: 'flip', horizontal: false },
  ];

  for (const transform of TRANSFORMS) {
    for (const mirror of [BOOK, DIAGONAL]) {
      const name =
        transform.kind === 'rotate'
          ? `rotate ${transform.clockwise ? 'right' : 'left'}`
          : transform.kind === 'flip'
            ? `${transform.horizontal ? 'horizontal' : 'vertical'} flip`
            : transform.kind;
      it(`survives a ${name} of a ${mirror.fold}-folded design`, () => {
        const layout = sheet('rectangular', SIZE, SIZE);
        const center = bpPackingSheetCenter(layout);
        // A pair, placed by reflecting one member so it starts exactly mirrored.
        const first = { x: 3, y: 5 };
        const second = mirrorBpFlapAnchor(first, BOX, center, bpPackingSymmetryAxis(layout, mirror));

        const movedMirror = mirrorAfterSheetTransform('rectangular', mirror, transform);
        const movedFirst = moveFlap(first, transform);
        const movedSecond = moveFlap(second, transform);

        expect(
          mirrorBpFlapAnchor(movedFirst, BOX, center, bpPackingSymmetryAxis(layout, movedMirror))
        ).toEqual(movedSecond);
      });
    }
  }

  it('tracks which half the first member is in, across every transform', () => {
    // Same fixture, but asking the question `negativeSide` asks: is the member
    // that started on the mirror's negative side still there? That is what a
    // rotation moves and what the optimizer reads back.
    const layout = sheet('rectangular', SIZE, SIZE);
    const center = bpPackingSheetCenter(layout);
    const sideOf = (anchor: Point, mirror: BpMirrorOrientation) => {
      const axis = bpPackingSymmetryAxis(layout, mirror);
      const [nx, ny] = axis === 'verticalHalf'
        ? [1, 0]
        : axis === 'horizontalHalf'
          ? [0, 1]
          : axis === 'mainDiagonal'
            ? [1, -1]
            : [1, 1];
      return Math.sign(nx * (anchor.x - center.x) + ny * (anchor.y - center.y));
    };

    for (const transform of TRANSFORMS) {
      for (const mirror of [BOOK, DIAGONAL]) {
        const first = { x: 3, y: 5 };
        const before = sideOf(first, mirror);
        const moved = mirrorAfterSheetTransform('rectangular', mirror, transform);
        const after = sideOf(moveFlap(first, transform), moved);
        // `sidesSwapped` says exactly whether that side flipped, which is what
        // the optimizer payload has to compensate for.
        expect(after === before).toBe(moved.sidesSwapped === mirror.sidesSwapped);
      }
    }
  });
});

describe('buildMirroredBpFlapMoves', () => {
  const flaps = [flap(1, 2, 6, 2, 1), flap(2, 12, 6, 2, 1), flap(3, 1, 3, 1, 1)];

  function build(
    moves: { id: number; loc: { x: number; y: number } }[],
    options: { mirror?: BpMirrorOrientation; sheetSize?: [number, number] } = {}
  ) {
    const [width, height] = options.sheetSize ?? [16, 16];
    return buildMirroredBpFlapMoves({
      tree: tree(),
      pairs: [],
      treeAxis: TREE_AXIS,
      sheet: sheet('rectangular', width, height),
      mirror: options.mirror ?? BOOK,
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
      mirror: BOOK,
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
    expect(build([{ id: 1, loc: { x: 3, y: 9 } }], { mirror: DIAGONAL, sheetSize: [16, 10] })).toEqual(
      []
    );
  });
});

describe('constrainBpFlapMoveToAxis', () => {
  it('slides an on-axis flap along the mirror instead of off it', () => {
    const centred = flap(1, 7, 4, 2, 1);
    expect(constrainBpFlapMoveToAxis(centred, { x: 2, y: 11 }, sheet(), BOOK)).toEqual({
      x: 7,
      y: 11,
    });
  });

  it('does not decide for itself which flaps are its own mirror', () => {
    // It projects whatever it is handed. Asking the geometry instead — is this
    // box centred on the line? — pinned any flap that merely drifted onto the
    // mirror, including ones with a distinct partner, and a pinned flap could
    // not be dragged off again. Who is self-mirrored is the pairing's answer.
    expect(constrainBpFlapMoveToAxis(flap(1, 2, 4, 2, 1), { x: 3, y: 9 }, sheet(), BOOK)).toEqual({
      x: 7,
      y: 9,
    });
  });

  it('leaves everything unconstrained when the fold has no mirror here', () => {
    const centred = flap(1, 7, 4, 2, 2);
    expect(
      constrainBpFlapMoveToAxis(centred, { x: 2, y: 11 }, sheet('rectangular', 16, 10), DIAGONAL)
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
        mirror: BOOK,
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
        mirror: BOOK,
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
        mirror: BOOK,
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
        mirror: BOOK,
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
        mirror: BOOK,
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
        mirror: BOOK,
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
      mirror: DIAGONAL,
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
        mirror: BOOK,
        pairedIds: paired([1]),
      })
    ).toEqual({ x: 4, y: 4 });
  });
});

/**
 * The clamp has to stop a flap somewhere the grid actually has.
 *
 * A zero-extent flap — every unit leaf's — may not rest *on* the mirror, so the
 * clamp has to leave a gap. It used to leave half a grid interval unconditionally,
 * which is a real position only when the sheet centre falls between two grid
 * lines. On an even sheet, whose centre falls *on* one, it parked the flap at
 * x = 8.5; the BP kernel then rejected the fractional junction overlap and the
 * pane lost every crease, river, gadget and conflict region at once.
 */
describe('constrainBpFlapGroupToAxisSides keeps flaps on the grid', () => {
  const paired = (ids: number[]) => new Set(ids);

  it('stops a paired point flap on the grid, not half a cell off it', () => {
    // The regression: dragging f3 at x = 9 onto the mirror at x = 8. Every one of
    // these used to land on 8.5.
    for (const targetX of [8, 7, 5, 0]) {
      const landed = constrainBpFlapGroupToAxisSides({
        moving: [flap(3, 9, 11)],
        target: { x: targetX, y: 11 },
        sheet: sheet(),
        mirror: BOOK,
        pairedIds: paired([3]),
      });
      expect(landed).toEqual({ x: 9, y: 11 });
    }
  });

  it('gives up whole cells until the flap is clear', () => {
    expect(
      constrainBpFlapGroupToAxisSides({
        moving: [flap(3, 12, 11)],
        target: { x: 4, y: 11 },
        sheet: sheet(),
        mirror: BOOK,
        pairedIds: paired([3]),
      })
      // 9 is the closest grid position still strictly off the mirror at x = 8.
    ).toEqual({ x: 9, y: 11 });
  });

  it('holds a left-half point flap symmetrically', () => {
    expect(
      constrainBpFlapGroupToAxisSides({
        moving: [flap(4, 4, 11)],
        target: { x: 12, y: 11 },
        sheet: sheet(),
        mirror: BOOK,
        pairedIds: paired([4]),
      })
    ).toEqual({ x: 7, y: 11 });
  });

  it('still stops half a cell out when the sheet centre falls between grid lines', () => {
    // A 15-wide sheet has its mirror at x = 7.5, so x = 8 *is* on the grid and
    // is half a cell from the axis. Rounding up to a full cell here would
    // over-constrain the odd sheets the old constant happened to get right.
    expect(
      constrainBpFlapGroupToAxisSides({
        moving: [flap(3, 9, 11)],
        target: { x: 3, y: 11 },
        sheet: sheet('rectangular', 15, 15),
        mirror: BOOK,
        pairedIds: paired([3]),
      })
    ).toEqual({ x: 8, y: 11 });
  });

  it('lands a point flap on the lattice against a diagonal mirror too', () => {
    const landed = constrainBpFlapGroupToAxisSides({
      moving: [flap(1, 12, 2)],
      target: { x: 2, y: 12 },
      sheet: sheet(),
      mirror: DIAGONAL,
      pairedIds: paired([1]),
    });
    expect(Number.isInteger(landed.x)).toBe(true);
    expect(Number.isInteger(landed.y)).toBe(true);
    // A normal-only correction cannot reach the 1/√2 lattice points — those need
    // a step along the axis too — so the closest it can stop is the (1, -1) hop
    // at √2. Under-shooting the mirror is the safe direction to be wrong in.
    const span = bpFlapAxisSpan(landed, { width: 0, height: 0 }, CENTER, 'mainDiagonal');
    expect(span.min).toBeCloseTo(Math.SQRT2, 9);
  });

  it('moves a group of point flaps by whole cells', () => {
    const landed = constrainBpFlapGroupToAxisSides({
      moving: [flap(1, 12, 4), flap(2, 10, 8)],
      target: { x: 6, y: 4 },
      sheet: sheet(),
      mirror: BOOK,
      pairedIds: paired([1, 2]),
    });
    // Flap 2 is nearer the mirror and may give up 1 cell, so the reference does too.
    expect(landed).toEqual({ x: 11, y: 4 });
  });

  it('still lets a box with extent rest its near edge on the mirror', () => {
    // Unchanged behaviour, kept explicit: the strict/non-strict split is the only
    // difference between the two cases, and this is the non-strict side of it.
    expect(
      constrainBpFlapGroupToAxisSides({
        moving: [flap(1, 10, 4, 3, 2)],
        target: { x: 6, y: 4 },
        sheet: sheet(),
        mirror: BOOK,
        pairedIds: paired([1]),
      })
    ).toEqual({ x: 8, y: 4 });
  });
});

/**
 * A paired flap may touch the mirror but never lie on it.
 *
 * A unit leaf's flap is 0×0, so for it "near edge on the line" and "the whole
 * flap on the line" are the same position — and a flap on the line *is* its own
 * reflection, which makes a pair two flaps at one point.
 */
describe('constrainBpFlapGroupToAxisSides — a paired flap may not sit on the mirror', () => {
  function stop(width: number, height: number, from: number) {
    return constrainBpFlapGroupToAxisSides({
      moving: [flap(1, from, 6, width, height)],
      target: { x: 0, y: 6 },
      sheet: sheet(),
      mirror: BOOK,
      pairedIds: new Set([1]),
    }).x;
  }

  it('lets a flap with width rest its edge on the line', () => {
    // [8, 11] against its partner's [5, 8]: they touch and do not overlap.
    expect(stop(3, 2, 12)).toBe(8);
  });

  it('holds a point flap a grid step off it', () => {
    // At 8 it would be its own reflection, so it stops at 9 — the nearest
    // position the grid has that is not on the line. Nothing downstream rounds
    // this, which is why it has to be a grid position when it leaves here: a
    // fractional anchor makes the junction overlap fractional, and the kernel
    // then refuses the whole layout rather than just this flap.
    expect(stop(0, 0, 12)).toBe(9);
  });

  it('applies to a flap with no extent across the axis but plenty along it', () => {
    // A vertical mirror measures width, not height: a 0×4 flap is a segment
    // lying along the line, still exactly on top of its own reflection.
    expect(stop(0, 4, 12)).toBe(9);
  });

  it('pushes a point flap that is already on the line off it', () => {
    // Reachable from a file, or from before this rule existed. The first drag
    // asserts the constraint rather than leaving it stranded there.
    expect(stop(0, 0, 8)).toBe(9);
  });
});
