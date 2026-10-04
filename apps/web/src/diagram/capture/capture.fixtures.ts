import { vi } from 'vitest';
import type { FoldArtifacts, FoldDocument } from '../../engine/types';
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
 * by side, sharing a middle border wall, each split by one diagonal, with an
 * aux line in the left one from its edge to its diagonal. Line ids are 1-based
 * in this order.
 *
 *   (0,100)──5──(100,100)──6──(200,100)
 *      │  ╲   L      │      R   ╱  │
 *      3    8   10   7        9     4        10: aux, (0,50)–(50,50)
 *      │      ╲      │    ╱        │
 *   (0,0)────1───(100,0)────2───(200,0)
 */
export type FixtureLine = [number, number, number, number, string];

export const TWO_SQUARES: FixtureLine[] = [
  [0, 0, 100, 0, 'Black0'], // 1
  [100, 0, 200, 0, 'Black0'], // 2
  [0, 0, 0, 100, 'Black0'], // 3
  [200, 0, 200, 100, 'Black0'], // 4
  [0, 100, 100, 100, 'Black0'], // 5
  [100, 100, 200, 100, 'Black0'], // 6
  [100, 0, 100, 100, 'Black0'], // 7: the middle wall, a border of both
  [0, 0, 100, 100, 'Red1'], // 8
  [100, 0, 200, 100, 'Blue2'], // 9
  [0, 50, 50, 50, 'Cyan3'], // 10
];

/** {@link TWO_SQUARES}, or any fixture, moved on the canvas by (dx, dy): nothing else changed. */
export function movedLines(lines: FixtureLine[], dx: number, dy: number): FixtureLine[] {
  return lines.map(([ax, ay, bx, by, color]) => [ax + dx, ay + dy, bx + dx, by + dy, color]);
}

/** The left square's lines: its borders, the wall, its diagonal and its aux line. */
export const LEFT_LINE_IDS = [1, 3, 5, 7, 8, 10];
export const LEFT_FOLD_LINE_IDS = [1, 3, 5, 7, 8];

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
 * The kernel-space segmentation of {@link TWO_SQUARES}: its faces, as the
 * fold export gives them. The aux line lies on no face. `wall: false` drops
 * the middle wall, merging the squares into one region; `dx`, `dy` is the
 * pattern moved as {@link movedLines} moves its lines.
 */
export function twoSquaresSegmentation({
  wall = true,
  dx = 0,
  dy = 0,
}: { wall?: boolean; dx?: number; dy?: number } = {}): FoldArtifacts {
  const at = (x: number, y: number): [number, number] => [x + dx, y + dy];
  const fold: FoldDocument = {
    vertices_coords: [at(0, 0), at(100, 0), at(200, 0), at(0, 100), at(100, 100), at(200, 100)],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [0, 3],
      [2, 5],
      [3, 4],
      [4, 5],
      [1, 4],
      [0, 4],
      [1, 5],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', wall ? 'B' : 'M', 'M', 'V'],
    faces_vertices: [
      [0, 1, 4],
      [0, 4, 3],
      [1, 2, 5],
      [1, 5, 4],
    ],
  };
  return { fold, simulation_model: null };
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
    paperScene: vi.fn(async () => halfFoldKernelScene()),
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
