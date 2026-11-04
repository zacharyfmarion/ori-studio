import { vi } from 'vitest';
import { CpSheetIndex } from '../../engine/oristudioCpSheetIndex';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldedRenderPrimitive,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpFoldSource,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import type { LayerOrderFound, LayerOrderResolution } from '../../layer-order/host/hostEngineGateway';
import {
  encodeLayerOrderRecord,
  type LayerOrderAttention,
  type LayerOrderRecord,
} from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
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
 * What the fake kernel says a fold was made from (`runtime.source`): the left
 * square's foldable lines, kernel order, as the Layer order engines take
 * them. Its box is centred on (50, 50), the step's paper frame's origin.
 */
export function fakeFoldSource(): OristudioCpFoldSource {
  return {
    segments: [
      cpLine(0, 0, 100, 0, 'Black0'),
      cpLine(0, 0, 0, 100, 'Black0'),
      cpLine(0, 100, 100, 100, 'Black0'),
      cpLine(100, 0, 100, 100, 'Black0'),
      cpLine(0, 0, 100, 100, 'Red1'),
    ],
    starting_face_id: 1,
    aux_segments: [],
    digest: 'fixture-digest',
  };
}

/** The handle the fake kernel's fold with a given order lands in. */
export const ORDERED_HANDLE = 9;

/**
 * A step's layer order record, synthetic, in the step's paper frame (about
 * the centre of {@link fakeFoldSource}'s box): the left square's two
 * triangles, the first in front of the second, and the order at Apply.
 */
export const STEP_LAYER_ORDER: LayerOrderRecord = {
  faces: [
    { at: [-25, 25], area: 5000 },
    { at: [25, -25], area: 5000 },
  ],
  constraints: [[0, 1, 1]],
  order: [[0, 1, 1]],
};

/**
 * {@link STEP_LAYER_ORDER} as the host engine and the dialog take it: its
 * points in the crease pattern's coordinates, the step's frame centred on
 * (50, 50).
 */
export const STEP_LAYER_ORDER_IN_SOURCE: LayerOrderRecord = {
  ...STEP_LAYER_ORDER,
  faces: [
    { at: [25, 75], area: 5000 },
    { at: [75, 25], area: 5000 },
  ],
};

/** {@link STEP_LAYER_ORDER} as a step's source keeps it. */
export function stepLayerOrderJson(record: LayerOrderRecord = STEP_LAYER_ORDER): string {
  const encoded = encodeLayerOrderRecord(record);
  if (!encoded.ok) throw new Error('the fixture record encodes');
  return encoded.json;
}

/**
 * The host engine's answers for {@link STEP_LAYER_ORDER} on the fake fold:
 * its record as the engine takes it (its points about the crease pattern's
 * origin), applied with one relation, or kept with the summary H2 gives it.
 */
export const fakeLayerOrderResolutions = {
  applied(record: LayerOrderRecord, source: LayerOrderSource, attention: LayerOrderAttention | null = null): LayerOrderResolution {
    // The session's own save of the order now shown: its points as the engine saves them, a unit along.
    const saved = { ...record, faces: record.faces.map((face) => ({ ...face, at: [face.at[0] + 1, face.at[1]] as const })) };
    const kept = attention ? { ...saved, attention } : saved;
    return {
      outcome: 'applied',
      applied: { record: kept, relations: new Uint32Array([1, 0]), source },
      found: NOTHING_FOUND,
      record: kept,
      attention,
    };
  },
  kept(outcome: 'clash' | 'timed_out' | 'refused', record: LayerOrderRecord): LayerOrderResolution {
    const attention: LayerOrderAttention =
      outcome === 'clash'
        ? { reason: 'conflict', count: 1 }
        : outcome === 'refused'
          ? { reason: 'unresolved', count: record.constraints.length }
          : { reason: 'timeout', count: record.constraints.length };
    const kept = { ...record, attention };
    switch (outcome) {
      case 'clash':
        return { outcome, clashing: [0], found: NOTHING_FOUND, record: kept, attention };
      case 'timed_out':
        return { outcome, limit: 'deadline', nodes: 10, found: null, record: kept, attention };
      case 'refused':
        return { outcome, refusal: { code: 'source_no_faces' }, record: kept, attention };
    }
  },
  /**
   * No host engine to ask: the browser did not load it (`load`), it crashed,
   * or it did not start (`unavailable`). H2 flags the record; a capture keeps none of it.
   */
  lost(record: LayerOrderRecord, cause: 'load' | 'crashed' | 'unavailable' = 'crashed'): LayerOrderResolution {
    const attention: LayerOrderAttention = { reason: 'timeout', count: record.constraints.length };
    return { outcome: 'lost', cause, record: { ...record, attention }, attention };
  },
};

/** A restore's parts, empty: what these fakes found, which no capture reads. */
const NOTHING_FOUND: LayerOrderFound = { saved_constraints: [], carried: [], opened_on: { kind: 'held', ignored: 0 } };

/**
 * {@link halfFoldKernelScene} in the other order: the back half on top, as a
 * fold with a chosen layer order draws it, so its picture differs.
 */
export function halfFoldOtherOrderScene(): OristudioCpFoldedPaperScene {
  const scene = halfFoldKernelScene();
  return { ...scene, subfaces: scene.subfaces.map((subface) => ({ ...subface, faces_top_to_bottom: [1, 0] })) };
}

/**
 * A kernel stand-in: a flat fold that reaches `Paper5` with
 * {@link halfFoldKernelScene}, unless told otherwise; a fold with a given
 * order lands in {@link ORDERED_HANDLE}, drawn as
 * {@link halfFoldOtherOrderScene}. Every call is a spy.
 */
export function fakeCaptureRuntime(overrides: Partial<CpCaptureRuntime> = {}): CpCaptureRuntime {
  return {
    fold: vi.fn(async () => ({ handle: 7, discoveredCases: 1, displayStyle: 'Paper5' as const, outcome: 'Solved' as const })),
    source: vi.fn(async () => fakeFoldSource()),
    foldWithOrder: vi.fn(async () => ({
      status: 'folded' as const,
      handle: ORDERED_HANDLE,
      discoveredCases: 1,
      displayStyle: 'Paper5' as const,
      outcome: 'Solved' as const,
      currentCase: 1,
      hasNext: false,
    })),
    foldToCase: vi.fn(async (_handle: number, objective: number) => ({
      discoveredCases: Math.min(objective, 2),
      displayStyle: 'Paper5' as const,
      outcome: 'Solved' as const,
    })),
    setModel: vi.fn(async () => ({ discoveredCases: 1, displayStyle: 'Paper5' as const })),
    foldAnother: vi.fn(async () => ({ discoveredCases: 2, displayStyle: 'Paper5' as const })),
    renderSnapshot: vi.fn(async () => squareRenderSnapshot()),
    paperScene: vi.fn(async (handle: number) =>
      handle === ORDERED_HANDLE ? halfFoldOtherOrderScene() : halfFoldKernelScene()
    ),
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
