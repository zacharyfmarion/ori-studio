import { vi } from 'vitest';
import { CpSheetIndex } from '../../engine/oristudioCpSheetIndex';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldedRenderPrimitive,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import type { CpCaptureRuntime } from './captureFolded';

/**
 * A pattern for the capture tests, without a kernel: two bordered squares side
 * by side, 50 apart, each split by one diagonal, with an aux line in the left
 * one from its edge to its diagonal. Line ids are 1-based in this order. (Two
 * squares sharing a side would be one sheet: a border line inside a sheet is
 * part of it, not a wall.)
 *
 *   (0,100)──5──(100,100)   (150,100)──6──(250,100)
 *      │  ╲   L      │         │      R   ╱  │
 *      3    8   10   7        11        9    4     10: aux, (0,50)–(50,50)
 *      │      ╲      │         │    ╱        │
 *   (0,0)────1───(100,0)     (150,0)────2───(250,0)
 */
export type FixtureLine = [number, number, number, number, string];

export const TWO_SQUARES: FixtureLine[] = [
  [0, 0, 100, 0, 'Black0'], // 1
  [150, 0, 250, 0, 'Black0'], // 2
  [0, 0, 0, 100, 'Black0'], // 3
  [250, 0, 250, 100, 'Black0'], // 4
  [0, 100, 100, 100, 'Black0'], // 5
  [150, 100, 250, 100, 'Black0'], // 6
  [100, 0, 100, 100, 'Black0'], // 7: the left square's right side
  [0, 0, 100, 100, 'Red1'], // 8
  [150, 0, 250, 100, 'Blue2'], // 9
  [0, 50, 50, 50, 'Cyan3'], // 10
  [150, 0, 150, 100, 'Black0'], // 11: the right square's left side
];

/** {@link TWO_SQUARES}, or any fixture, moved on the canvas by (dx, dy): nothing else changed. */
export function movedLines(lines: FixtureLine[], dx: number, dy: number): FixtureLine[] {
  return lines.map(([ax, ay, bx, by, color]) => [ax + dx, ay + dy, bx + dx, by + dy, color]);
}

/** The left square's lines: its borders, its diagonal and its aux line. */
export const LEFT_LINE_IDS = [1, 3, 5, 7, 8, 10];
export const LEFT_FOLD_LINE_IDS = [1, 3, 5, 7, 8];
/** The right square's lines. */
export const RIGHT_LINE_IDS = [2, 4, 6, 9, 11];

export function cpLine(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  color: string,
  foldMagnitude?: number
): OristudioCpLineSegment {
  return {
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    active: '',
    color,
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
    ...(foldMagnitude === undefined ? {} : { fold_magnitude: foldMagnitude }),
  };
}

export function cpDocument(
  lines: FixtureLine[] = TWO_SQUARES,
  patch: (line: OristudioCpLineSegment, id: number) => OristudioCpLineSegment = (line) => line
): OristudioCpDocumentSnapshot {
  return {
    crease_pattern: {
      line_segments: lines.map((line, index) => patch(cpLine(...line), index + 1)),
      circles: [],
      points: [],
      aux_line_segments: [],
      texts: [],
      grid: {} as OristudioCpDocumentSnapshot['crease_pattern']['grid'],
    },
    metadata: {},
  };
}

/**
 * The sheet index the kernel builds for {@link TWO_SQUARES}: the left square,
 * then the right, each holding its lines. `dx`, `dy` is the pattern moved as
 * {@link movedLines} moves its lines; `left: false` is the index once the left
 * square stopped being closed by its border, its lines in no sheet.
 */
export function twoSquaresIndex({
  left = true,
  dx = 0,
  dy = 0,
}: { left?: boolean; dx?: number; dy?: number } = {}): CpSheetIndex {
  const square = (x: number) => [x + dx, dy, x + 100 + dx, dy, x + 100 + dx, 100 + dy, x + dx, 100 + dy];
  const box = (x: number) => [x + dx, dy, x + 100 + dx, 100 + dy];
  const sheets = left ? [0, 150] : [150];
  const lineSheet = TWO_SQUARES.map((_, index) =>
    LEFT_LINE_IDS.includes(index + 1) ? (left ? 0 : -1) : left ? 1 : 0
  );
  return new CpSheetIndex({
    bounds: new Float64Array(sheets.flatMap(box)),
    outlineOffsets: new Uint32Array(sheets.map((_, index) => index * 4).concat(sheets.length * 4)),
    outlineCoords: new Float64Array(sheets.flatMap(square)),
    lineCounts: new Uint32Array(left ? [LEFT_LINE_IDS.length, RIGHT_LINE_IDS.length] : [RIGHT_LINE_IDS.length]),
    lineSheet: new Int32Array(lineSheet),
  });
}

/** A sheet folded in half: the front face over the back one, so one face is buried. */
export function halfFoldKernelScene(): OristudioCpFoldedPaperScene {
  const outline = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 },
  ];
  const edges = outline.map((from, index) => ({
    from,
    to: outline[(index + 1) % outline.length]!,
    kind: index === 2 ? ('fold' as const) : ('border' as const),
  }));
  return {
    schema_version: 2,
    sheet_points: [],
    flipped: false,
    sheet: 100,
    // The fold's ends are one pair of sheet vertices; the free corners are not.
    faces: [
      { outline, points: [0, 1, 2, 3], front_up: true, edges },
      { outline, points: [4, 5, 2, 3], front_up: false, edges },
    ],
    subfaces: [{ polygon: outline, faces_top_to_bottom: [0, 1] }],
    aux_lines: [],
  };
}

/**
 * A 100-unit sheet folded in half along y = 50, its far half brought up over
 * the near one — the near half (face 0) on top here — with every point named
 * on the sheet: sheet vertices 0–3 the near half's corners, 4 and 5 the far
 * corners, which the fold lays on 0 and 1. Two layers, one buried, each on
 * its own paper: what anchoring an enlarged step reads (Revision 2).
 */
export function halfFoldOnSheetKernelScene({ flipped = false }: { flipped?: boolean } = {}): OristudioCpFoldedPaperScene {
  const outline = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 },
  ];
  const edges = outline.map((from, index) => ({
    from,
    to: outline[(index + 1) % outline.length]!,
    kind: index === 2 ? ('fold' as const) : ('border' as const),
  }));
  return {
    schema_version: 3,
    sheet_points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ],
    flipped,
    sheet: 100,
    faces: [
      { outline, points: [0, 1, 2, 3], front_up: !flipped, edges },
      { outline, points: [4, 5, 2, 3], front_up: flipped, edges },
    ],
    // A back pass reads its stacks from the other side: the far half on top.
    subfaces: [{ polygon: outline, faces_top_to_bottom: flipped ? [1, 0] : [0, 1] }],
    aux_lines: [],
  };
}

/** A render snapshot with one filled square, as the kernel draws a transparent development. */
export function squareRenderSnapshot(): OristudioCpFoldedRenderSnapshot {
  const primitive = {
    sequence: 0,
    kind: 'fill_polygon',
    style: {
      paint: { kind: 'color', color: { red: 255, green: 0, blue: 0, alpha: 128 } },
      stroke: { kind: 'none' },
      antialias: 'default',
    },
    geometry: {
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 20 },
        { x: 0, y: 20 },
      ],
    },
  } as unknown as OristudioCpFoldedRenderPrimitive;
  return { schema_version: 1, fixture: null, pass: null, primitives: [primitive] } as unknown as OristudioCpFoldedRenderSnapshot;
}

/**
 * A kernel stand-in: a flat fold that reaches `Paper5` with
 * {@link halfFoldKernelScene}, unless told otherwise. Every call is a spy.
 */
export function fakeCaptureRuntime(overrides: Partial<CpCaptureRuntime> = {}): CpCaptureRuntime {
  return {
    fold: vi.fn(async () => ({ handle: 7, discoveredCases: 1, displayStyle: 'Paper5' as const, outcome: 'Solved' as const })),
    foldToCase: vi.fn(async (_handle: number, objective: number) => ({
      discoveredCases: Math.min(objective, 2),
      displayStyle: 'Paper5' as const,
      outcome: 'Solved' as const,
    })),
    setModel: vi.fn(async () => ({ discoveredCases: 1, displayStyle: 'Paper5' as const })),
    foldAnother: vi.fn(async () => ({ discoveredCases: 2, displayStyle: 'Paper5' as const })),
    renderSnapshot: vi.fn(async () => squareRenderSnapshot()),
    paperScene: vi.fn(async () => halfFoldOnSheetKernelScene()),
    free: vi.fn(async () => {}),
    fold3d: vi.fn(async () => {
      throw new Error('no 3D fold in this fake');
    }),
    fold3dAnother: vi.fn(async () => {
      throw new Error('no 3D fold in this fake');
    }),
    aux3d: vi.fn(async () => null),
    ...overrides,
  };
}
