import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SEG_ATTR_STRIDE, type CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { CpSheetIndex } from '../../engine/oristudioCpSheetIndex';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import type { PrecreaseComponent, PrecreaseTolerances } from './sheetFrames';

// The two engines, stood in for: the kernel's index and the planner's frames.
// And what reached the monitoring layer.
const engines = vi.hoisted(() => ({
  index: null as unknown,
  indexCalls: 0,
  outlineCalls: 0,
  framed: [] as unknown[],
  reports: [] as unknown[][],
}));
vi.mock('../../monitoring', () => ({
  reportError: (...args: unknown[]) => {
    engines.reports.push(args);
  },
}));
vi.mock('../sheets/cpSheetIndex', () => ({
  ensureCpSheetIndex: async () => {
    engines.indexCalls += 1;
    return engines.index;
  },
}));
vi.mock('../../store/workspaceStore/precreaseRuntime', () => ({
  getPrecreaseClient: () => ({
    tolerances: async () => TOLERANCES,
    outlineComponents: async () => {
      engines.outlineCalls += 1;
      return engines.framed;
    },
  }),
}));

const {
  ensureReferencesFrames,
  referencesFallbackFrames,
  referencesFramesFromIndex,
  referencesSheetLines,
  resetReferencesFrames,
} = await import('./referencesFrames');

const TOLERANCES: PrecreaseTolerances = { tol: 1e-6, snap_radius: 2e-3 };

/** Lines as `[ax, ay, bx, by, colour]`: 0 border, 1 mountain, 2 valley, 3 aux, -1 unassigned. */
function geometryOf(lines: number[][]): CpGeometryTransport {
  const segEndpoints = new Float64Array(lines.length * 4);
  const segAttr = new Int32Array(lines.length * SEG_ATTR_STRIDE);
  lines.forEach(([ax, ay, bx, by, colour], i) => {
    segEndpoints.set([ax!, ay!, bx!, by!], i * 4);
    segAttr[i * SEG_ATTR_STRIDE] = colour!;
  });
  return { segEndpoints, segAttr } as unknown as CpGeometryTransport;
}

/** An index over `lineSheet`, with one square outline per sheet. */
function indexOf(lineSheet: number[], sheets: number): CpSheetIndex {
  const outlineCoords: number[] = [];
  const outlineOffsets = [0];
  for (let sheet = 0; sheet < sheets; sheet += 1) {
    const x = sheet * 100;
    outlineCoords.push(x, 0, x + 40, 0, x + 40, 40, x, 40);
    outlineOffsets.push(outlineOffsets.at(-1)! + 4);
  }
  return new CpSheetIndex({
    bounds: new Float64Array(sheets * 4),
    outlineOffsets: Uint32Array.from(outlineOffsets),
    outlineCoords: Float64Array.from(outlineCoords),
    lineCounts: new Uint32Array(sheets),
    lineSheet: Int32Array.from(lineSheet),
  });
}

/** The planner's framing of an outline: a frame unless `refused`. */
function framed(id: number, refused = false): PrecreaseComponent {
  return {
    id,
    frame: refused
      ? null
      : { origin: [0, 40], x_axis: [1, 0], y_axis: [0, -1], width: 40, height: 40 },
    rf_rect: refused ? null : { width: 1, height: 1 },
    affines: null,
    outline: [
      [id * 100, 0],
      [id * 100 + 40, 0],
      [id * 100 + 40, 40],
      [id * 100, 40],
    ],
    outline_residual: 0,
    is_fallback: false,
    border_segment_indices: [],
    segment_indices: [],
    unit_segments: [],
    aux_segment_indices: [],
    aux_unit_segments: [],
    merged_lines: [],
    exactness: null,
    refused: refused ? { kind: 'non_rectangular', vertices: [] } : null,
  };
}

// Sheet 0: a border line, a mountain, an aux line. Sheet 1 (refused): a border
// line, a valley, an aux line. Then a crease and a border line in no sheet.
const GEOMETRY = geometryOf([
  [0, 0, 40, 0, 0],
  [0, 0, 40, 40, 1],
  [0, 10, 40, 10, 3],
  [100, 0, 140, 0, 0],
  [100, 0, 140, 40, 2],
  [100, 10, 140, 10, 3],
  [60, 0, 60, 40, -1],
  [70, 0, 70, 40, 0],
]);
const LINE_SHEET = [0, 0, 0, 1, 1, 1, -1, -1];

describe('referencesFramesFromIndex', () => {
  it('lists every sheet with its lines split as the planner splits them', () => {
    const analysis = referencesFramesFromIndex(
      indexOf(LINE_SHEET, 2),
      GEOMETRY,
      [framed(0), framed(1, true)],
      TOLERANCES
    );
    const [first, second] = analysis.components;
    expect(first).toMatchObject({
      id: 0,
      border_segment_indices: [0],
      segment_indices: [1],
      aux_segment_indices: [2],
    });
    // An aux line is only ever drawn in a frame.
    expect(second).toMatchObject({
      id: 1,
      border_segment_indices: [3],
      segment_indices: [4],
      aux_segment_indices: [],
    });
    // Nothing the merge or the probe makes: that is one sheet's detail.
    expect(first?.merged_lines).toEqual([]);
    expect(first?.exactness).toBeNull();
    // A crease in no sheet is reported; a border in none is no sheet at all.
    expect(analysis.unassigned_segments).toEqual([6]);
    expect(analysis.warnings).toEqual([{ kind: 'unassigned_segments', count: 1 }]);
    expect(analysis).toMatchObject({ segment_count: 8, tol: 1e-6, snap_radius: 2e-3 });
  });

  it('leaves a line with no position out of every sheet, and says so', () => {
    // A NaN crease and a NaN border line, as Reflect selection over line wrote
    // them when its axis was one point; the index places neither.
    const geometry = geometryOf([
      [0, 0, 40, 0, 0],
      [0, 0, 40, 40, 1],
      [NaN, NaN, NaN, NaN, 1],
      [NaN, NaN, NaN, NaN, 0],
      [Infinity, 0, 40, 40, 2],
    ]);
    const analysis = referencesFramesFromIndex(
      indexOf([0, 0, -1, -1, -1], 1),
      geometry,
      [framed(0)],
      TOLERANCES
    );
    expect(analysis.components[0]).toMatchObject({
      border_segment_indices: [0],
      segment_indices: [1],
    });
    expect(analysis.unassigned_segments).toEqual([]);
    expect(analysis.warnings).toEqual([{ kind: 'non_finite_segments', count: 3 }]);
  });
});

describe('referencesFallbackFrames', () => {
  it('is one sheet of the default paper holding every line', () => {
    const geometry = geometryOf([
      [0, 0, 40, 40, 1],
      [0, 10, 40, 10, 3],
      [0, 40, 40, 0, 2],
    ]);
    const analysis = referencesFallbackFrames(geometry, framed(5), TOLERANCES);
    expect(analysis.components).toHaveLength(1);
    expect(analysis.components[0]).toMatchObject({
      id: 0,
      is_fallback: true,
      segment_indices: [0, 2],
      aux_segment_indices: [1],
    });
    expect(analysis.warnings).toEqual([
      { kind: 'no_border_fallback', paper: [-200, -200, 200, 200] },
    ]);
  });

  it('leaves a line with no position off the paper, and says so', () => {
    // Every line of the fallback sheet goes to the planner, which rejects the
    // whole sheet over one non-finite coordinate.
    const geometry = geometryOf([
      [0, 0, 40, 40, 1],
      [NaN, NaN, NaN, NaN, 1],
      [0, 40, 40, 0, 2],
    ]);
    const analysis = referencesFallbackFrames(geometry, framed(5), TOLERANCES);
    expect(analysis.components[0]?.segment_indices).toEqual([0, 2]);
    expect(analysis.warnings).toEqual([
      { kind: 'no_border_fallback', paper: [-200, -200, 200, 200] },
      { kind: 'non_finite_segments', count: 1 },
    ]);
  });
});

describe('referencesSheetLines', () => {
  it('hands the planner every line of the sheet, numbered as the document numbers them', () => {
    const [sheet] = referencesFramesFromIndex(
      indexOf(LINE_SHEET, 2),
      GEOMETRY,
      [framed(0), framed(1)],
      TOLERANCES
    ).components;
    const lines = referencesSheetLines(GEOMETRY, sheet!);
    expect([...lines.indices]).toEqual([0, 1, 2]);
    expect([...lines.colors]).toEqual([0, 1, 3]);
    expect([...lines.segments]).toEqual([0, 0, 40, 0, 0, 0, 40, 40, 0, 10, 40, 10]);
    expect([...lines.outline]).toEqual([0, 0, 40, 0, 40, 40, 0, 40]);
  });
});

describe('ensureReferencesFrames', () => {
  const state = (fingerprintSeed: number): OristudioCpDocumentState =>
    ({
      loadSerial: 1,
      geometry: GEOMETRY,
      document: {
        crease_pattern: {
          line_segments: [
            {
              a: { x: fingerprintSeed, y: 0 },
              b: { x: 1, y: 1 },
              color: 'Red1',
              selected: 0,
            },
          ],
        },
      },
    }) as unknown as OristudioCpDocumentState;

  beforeEach(() => {
    resetReferencesFrames();
    engines.index = indexOf(LINE_SHEET, 2);
    engines.framed = [framed(0), framed(1)];
    engines.indexCalls = 0;
    engines.outlineCalls = 0;
    engines.reports = [];
  });

  it('reports creases left out for having no position, once per document', async () => {
    engines.index = indexOf([0, 0, -1], 1);
    const withUnplaced = (seed: number, loadSerial: number) =>
      ({
        ...state(seed),
        loadSerial,
        geometry: geometryOf([
          [0, 0, 40, 0, 0],
          [0, 0, 40, 40, 1],
          [NaN, NaN, NaN, NaN, 1],
        ]),
      }) as OristudioCpDocumentState;

    await ensureReferencesFrames(withUnplaced(0, 1));
    // An edit is another revision of the same document: said already.
    await ensureReferencesFrames(withUnplaced(7, 1));
    expect(engines.reports).toHaveLength(1);
    // Another document is said again.
    await ensureReferencesFrames(withUnplaced(0, 2));
    expect(engines.reports).toHaveLength(2);

    const [error, context] = engines.reports[0]!;
    expect(context).toEqual({
      surface: 'references:non-finite-creases',
      handled: true,
      tags: { count_bucket: '<=1' },
    });
    // A bucket is all that leaves: no count, no coordinate, in the message.
    expect((error as Error).message).not.toMatch(/\d|NaN/);
  });

  it('reports nothing when every crease has a position', async () => {
    await ensureReferencesFrames(state(0));
    expect(engines.reports).toEqual([]);
  });

  it('reads one revision of the creases once', async () => {
    const document = state(0);
    const first = await ensureReferencesFrames(document);
    const again = await ensureReferencesFrames(document);
    expect(first?.analysis.components).toHaveLength(2);
    expect(again).toBe(first);
    expect(engines.outlineCalls).toBe(1);
    // Other creases are another revision.
    await ensureReferencesFrames(state(7));
    expect(engines.outlineCalls).toBe(2);
  });

  it('takes a border line with no position for no border at all', async () => {
    engines.index = indexOf([-1, -1], 0);
    const frames = await ensureReferencesFrames({
      ...state(3),
      geometry: geometryOf([
        [NaN, NaN, NaN, NaN, 0],
        [0, 0, 40, 40, 1],
      ]),
    } as OristudioCpDocumentState);
    expect(frames?.analysis.components).toHaveLength(1);
    expect(frames?.analysis.components[0]).toMatchObject({ is_fallback: true, segment_indices: [1] });
    expect(frames?.analysis.warnings).toEqual([
      { kind: 'no_border_fallback', paper: [-200, -200, 200, 200] },
      { kind: 'non_finite_segments', count: 1 },
    ]);
  });

  it('is null with no pattern, and does not keep a failure', async () => {
    expect(await ensureReferencesFrames(null)).toBeNull();
    engines.index = null;
    expect(await ensureReferencesFrames(state(0))).toBeNull();
    engines.index = indexOf(LINE_SHEET, 2);
    expect(await ensureReferencesFrames(state(0))).not.toBeNull();
    expect(engines.indexCalls).toBe(2);
  });
});
