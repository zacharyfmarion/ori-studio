import { describe, expect, it } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import {
  collinearSegments,
  componentForSegment,
  componentForVertex,
  findSegmentByEndpoints,
  paperFallbackRect,
  precreaseInputFromTransport,
  segmentEndpoints,
  segmentsAtVertex,
  type PrecreaseComponent,
  type SheetAnalysis,
} from './sheetFrames';

/** A transport carrying only the fields these helpers read. */
function transport(segments: number[][], colors: number[]): CpGeometryTransport {
  const segAttr = new Int32Array(colors.length * 5);
  colors.forEach((color, i) => {
    segAttr[i * 5] = color;
  });
  return {
    segEndpoints: Float64Array.from(segments.flat()),
    segAttr,
  } as unknown as CpGeometryTransport;
}

function component(overrides: Partial<PrecreaseComponent>): PrecreaseComponent {
  return {
    id: 0,
    frame: { origin: [0, 0], x_axis: [1, 0], y_axis: [0, -1], width: 1, height: 1 },
    rf_rect: { width: 1, height: 1 },
    affines: null,
    outline: [],
    outline_residual: 0,
    is_fallback: false,
    border_segment_indices: [],
    segment_indices: [],
    unit_segments: [],
    merged_lines: [],
    exactness: null,
    refused: null,
    ...overrides,
  };
}

function analysis(components: PrecreaseComponent[]): SheetAnalysis {
  return {
    components,
    unassigned_segments: [],
    warnings: [],
    segment_count: 0,
    tol: 1e-6,
    snap_radius: 2e-3,
  };
}

// Four border segments (0–3) round a square, one interior crease (4), and a
// second interior crease (5) collinear with it.
const GEOMETRY = transport(
  [
    [0, 0, 100, 0],
    [100, 0, 100, 100],
    [100, 100, 0, 100],
    [0, 100, 0, 0],
    [0, 50, 50, 50],
    [50, 50, 100, 50],
  ],
  [0, 0, 0, 0, 1, 2]
);

describe('precreaseInputFromTransport', () => {
  it('passes the endpoint buffer through and gathers one colour per segment', () => {
    const input = precreaseInputFromTransport(GEOMETRY);
    expect(input.segments).toBe(GEOMETRY.segEndpoints);
    expect(Array.from(input.colors)).toEqual([0, 0, 0, 0, 1, 2]);
    expect(input.colors).toBeInstanceOf(Int32Array);
  });
});

describe('paperFallbackRect', () => {
  it("is Oriedita's ±200 paper as [x0, y0, x1, y1]", () => {
    expect(Array.from(paperFallbackRect())).toEqual([-200, -200, 200, 200]);
  });
});

describe('componentForSegment', () => {
  const sheet = component({ id: 0, border_segment_indices: [0, 1, 2, 3], segment_indices: [4, 5] });
  const other = component({ id: 1, segment_indices: [7] });
  const result = analysis([sheet, other]);

  it("finds a segment among a component's interior creases", () => {
    expect(componentForSegment(result, 4)?.id).toBe(0);
    expect(componentForSegment(result, 7)?.id).toBe(1);
  });

  it('finds a border segment through the border loop', () => {
    expect(componentForSegment(result, 2)?.id).toBe(0);
  });

  it('is null for a segment inside no sheet', () => {
    expect(componentForSegment(result, 6)).toBeNull();
  });
});

describe('segmentsAtVertex', () => {
  it('lists every segment with an endpoint at the point, in either slot', () => {
    expect(segmentsAtVertex(GEOMETRY, { x: 50, y: 50 })).toEqual([4, 5]);
    expect(segmentsAtVertex(GEOMETRY, { x: 100, y: 0 })).toEqual([0, 1]);
  });

  it("keys on the editor's coordinate quantisation, not exact equality", () => {
    expect(segmentsAtVertex(GEOMETRY, { x: 50 + 1e-12, y: 50 - 1e-12 })).toEqual([4, 5]);
  });

  it('is empty away from every vertex', () => {
    expect(segmentsAtVertex(GEOMETRY, { x: 25, y: 25 })).toEqual([]);
  });
});

describe('componentForVertex', () => {
  it('attributes a vertex to the sheet owning a crease that meets there', () => {
    const sheet = component({ id: 0, border_segment_indices: [0, 1, 2, 3], segment_indices: [4, 5] });
    expect(componentForVertex(analysis([sheet]), GEOMETRY, { x: 50, y: 50 })?.id).toBe(0);
  });

  it('prefers a framed component over a refused loop sharing the vertex', () => {
    const refused = component({
      id: 0,
      frame: null,
      border_segment_indices: [0],
      refused: { kind: 'non_rectangular', vertices: [] },
    });
    const framed = component({ id: 1, border_segment_indices: [1] });
    expect(componentForVertex(analysis([refused, framed]), GEOMETRY, { x: 100, y: 0 })?.id).toBe(1);
  });

  it('falls back to the refused loop when it is the only owner', () => {
    const refused = component({
      id: 3,
      frame: null,
      segment_indices: [4],
      refused: { kind: 'non_rectangular', vertices: [] },
    });
    expect(componentForVertex(analysis([refused]), GEOMETRY, { x: 0, y: 50 })?.id).toBe(3);
  });

  it('is null when no crease meets at the point', () => {
    expect(componentForVertex(analysis([component({})]), GEOMETRY, { x: 25, y: 25 })).toBeNull();
  });
});

describe('collinearSegments', () => {
  it("returns every segment on the picked segment's merged line", () => {
    const sheet = component({
      segment_indices: [4, 5],
      merged_lines: [
        {
          line: { n: [0, 1], d: 0.5 },
          segment_indices: [4, 5],
          is_border: false,
          kinds: ['mountain', 'valley'],
          merge_residual: 0,
          on_outline: false,
        },
      ],
    });
    expect(collinearSegments(sheet, 5)).toEqual([4, 5]);
  });

  it('falls back to the segment alone when the merge did not list it', () => {
    expect(collinearSegments(component({}), 9)).toEqual([9]);
  });
});

describe('segmentEndpoints / findSegmentByEndpoints', () => {
  it('reads both endpoints of a 0-based segment', () => {
    expect(segmentEndpoints(GEOMETRY, 4)).toEqual({ a: { x: 0, y: 50 }, b: { x: 50, y: 50 } });
    expect(segmentEndpoints(GEOMETRY, 6)).toBeNull();
    expect(segmentEndpoints(GEOMETRY, -1)).toBeNull();
  });

  it('finds a segment by its endpoints in either order', () => {
    expect(findSegmentByEndpoints(GEOMETRY, { x: 50, y: 50 }, { x: 0, y: 50 })).toBe(4);
    expect(findSegmentByEndpoints(GEOMETRY, { x: 0, y: 50 }, { x: 50, y: 50 })).toBe(4);
    expect(findSegmentByEndpoints(GEOMETRY, { x: 0, y: 0 }, { x: 100, y: 100 })).toBe(-1);
  });
});
