/**
 * Folds with and without a precrease, in the kernel's paper-scene shape
 * (`OristudioCpFoldedPaperScene`, schema 3): each face names its sheet
 * vertices, its edges say what crease they came from, and the sheet is sent.
 * A precrease is a flat crease, so the precreased fold should draw, spread
 * and order exactly as the plain one — the tests compare the two.
 *
 * Coordinates are the kernel's, y up; the sheet lies as it is folded, so a
 * face that does not move keeps its sheet coordinates.
 */
import type {
  OristudioCpFoldedPaperEdgeKind,
  OristudioCpFoldedPaperFace,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldedPaperSubface,
} from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';

const point = ([x, y]: readonly [number, number]): Point => ({ x, y });

/** A face from its corners, the sheet vertices it names, and each edge's kind, the last edge closing the ring. */
export function kernelFace(
  corners: ReadonlyArray<readonly [number, number]>,
  points: number[],
  kinds: OristudioCpFoldedPaperEdgeKind[],
  frontUp = true
): OristudioCpFoldedPaperFace {
  const outline = corners.map(point);
  return {
    outline,
    points,
    front_up: frontUp,
    edges: outline.map((from, i) => ({ from, to: outline[(i + 1) % outline.length]!, kind: kinds[i]! })),
  };
}

function cell(corners: ReadonlyArray<readonly [number, number]>, stack: number[]): OristudioCpFoldedPaperSubface {
  return { polygon: corners.map(point), faces_top_to_bottom: stack };
}

function kernelScene(
  faces: OristudioCpFoldedPaperFace[],
  subfaces: OristudioCpFoldedPaperSubface[],
  sheet: ReadonlyArray<readonly [number, number]>
): OristudioCpFoldedPaperScene {
  return { schema_version: 3, flipped: false, sheet: 5, faces, subfaces, aux_lines: [], sheet_points: sheet.map(point) };
}

const rectangle = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/**
 * A 2 × 1 sheet folded in half, the right square over onto the left (x → 2 −
 * x), with sheet vertices 0 1 2 along the bottom, 3 4 5 along the top, and 6 7
 * 8 at half height — where `precreasedBook` has its precrease.
 */
const BOOK_SHEET: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [2, 0],
  [0, 1],
  [1, 1],
  [2, 1],
  [0, 0.5],
  [1, 0.5],
  [2, 0.5],
];

/** The plain book: face 0 the leaf beneath, face 1 the leaf folded over it. */
export const PLAIN_BOOK = { under: 0, over: 1 } as const;

export function plainBook(): OristudioCpFoldedPaperScene {
  return kernelScene(
    [
      kernelFace(rectangle(0, 0, 1, 1), [0, 1, 4, 3], ['border', 'fold', 'border', 'border']),
      kernelFace(
        [
          [1, 0],
          [0, 0],
          [0, 1],
          [1, 1],
        ],
        [1, 2, 5, 4],
        ['border', 'border', 'border', 'fold'],
        false
      ),
    ],
    [cell(rectangle(0, 0, 1, 1), [PLAIN_BOOK.over, PLAIN_BOOK.under])],
    BOOK_SHEET
  );
}

/**
 * The book with a valley folded and unfolded across both leaves at half
 * height: four faces, each leaf two. Numbered so that ordering the faces by
 * the stacks alone draws a lower piece of the leaf beneath after the upper
 * piece of the leaf over it — side by side, so no stack says otherwise.
 */
export const PRECREASED_BOOK = { underHigh: 0, overHigh: 1, underLow: 2, overLow: 3 } as const;

export function precreasedBook(): OristudioCpFoldedPaperScene {
  const { underHigh, overHigh, underLow, overLow } = PRECREASED_BOOK;
  const faces: OristudioCpFoldedPaperFace[] = [];
  faces[underHigh] = kernelFace(rectangle(0, 0.5, 1, 1), [6, 7, 4, 3], ['flat', 'fold', 'border', 'border']);
  faces[overHigh] = kernelFace(
    [
      [1, 0.5],
      [0, 0.5],
      [0, 1],
      [1, 1],
    ],
    [7, 8, 5, 4],
    ['flat', 'border', 'border', 'fold'],
    false
  );
  faces[underLow] = kernelFace(rectangle(0, 0, 1, 0.5), [0, 1, 7, 6], ['border', 'fold', 'flat', 'border']);
  faces[overLow] = kernelFace(
    [
      [1, 0],
      [0, 0],
      [0, 0.5],
      [1, 0.5],
    ],
    [1, 2, 8, 7],
    ['border', 'border', 'flat', 'fold'],
    false
  );
  return kernelScene(
    faces,
    [cell(rectangle(0, 0, 1, 0.5), [overLow, underLow]), cell(rectangle(0, 0.5, 1, 1), [overHigh, underHigh])],
    BOOK_SHEET
  );
}

/**
 * A 5 × 1 sheet with its right end folded over at x = 3.5 (x → 7 − x), a
 * flap 1.5 wide lying on the right of the strip beneath. Sheet vertices 0 1 2
 * 3 along the bottom at x = 0, 1, 3.5, 5, and 4 5 6 7 above them; 1 and 5 are
 * where `precreasedFlap` has its precrease.
 */
const FLAP_SHEET: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [3.5, 0],
  [5, 0],
  [0, 1],
  [1, 1],
  [3.5, 1],
  [5, 1],
];

/** The flap: sheet x 3.5 to 5, folded onto x 3.5 to 2. */
const flapOver = (): OristudioCpFoldedPaperFace =>
  kernelFace(
    [
      [3.5, 0],
      [2, 0],
      [2, 1],
      [3.5, 1],
    ],
    [2, 3, 7, 6],
    ['border', 'border', 'border', 'fold'],
    false
  );

/** The plain flap: face 0 the strip, face 1 the flap over it. */
export const PLAIN_FLAP = { strip: 0, flap: 1 } as const;

export function plainFlap(): OristudioCpFoldedPaperScene {
  return kernelScene(
    [kernelFace(rectangle(0, 0, 3.5, 1), [0, 2, 6, 4], ['border', 'fold', 'border', 'border']), flapOver()],
    [cell(rectangle(0, 0, 2, 1), [PLAIN_FLAP.strip]), cell(rectangle(2, 0, 3.5, 1), [PLAIN_FLAP.flap, PLAIN_FLAP.strip])],
    FLAP_SHEET
  );
}

/**
 * The flap fold with a precrease across the strip alone, at x = 1: the strip
 * is two faces, the left one with nothing over it and the right one under the
 * flap. Each piece of the strip shows less than the flap does, while the
 * whole strip shows more.
 */
export const PRECREASED_FLAP = { left: 0, right: 1, flap: 2 } as const;

export function precreasedFlap(): OristudioCpFoldedPaperScene {
  const { left, right, flap } = PRECREASED_FLAP;
  return kernelScene(
    [
      kernelFace(rectangle(0, 0, 1, 1), [0, 1, 5, 4], ['border', 'flat', 'border', 'border']),
      kernelFace(rectangle(1, 0, 3.5, 1), [1, 2, 6, 5], ['border', 'fold', 'border', 'flat']),
      flapOver(),
    ],
    [
      cell(rectangle(0, 0, 1, 1), [left]),
      cell(rectangle(1, 0, 2, 1), [right]),
      cell(rectangle(2, 0, 3.5, 1), [flap, right]),
    ],
    FLAP_SHEET
  );
}
