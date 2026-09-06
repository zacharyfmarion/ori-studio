import { describe, expect, it } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { vertexPointsFromTransport } from '../../engine/oristudioCpGeometry';
import { cpModelToSvg } from '../../lib/creasePatternViewport';
import { LineHitIndex } from '../picking/lineHitIndex';
import {
  ghostSegmentsToStrokes,
  isClick,
  markersToOverlayPoints,
  modelBoundsToUser,
  resolveReferencesPick,
  transportUserBounds,
  type ReferencesOverlayColors,
} from './referencesViewGeometry';

function transport(segments: number[][]): CpGeometryTransport {
  return {
    segEndpoints: Float64Array.from(segments.flat()),
    segAttr: new Int32Array(segments.length * 5),
  } as unknown as CpGeometryTransport;
}

// A horizontal crease (id 1) and a vertical one (id 2) meeting at (100, 100).
const GEOMETRY = transport([
  [0, 100, 200, 100],
  [100, 0, 100, 100],
]);

function indexes(geometry: CpGeometryTransport) {
  const vertices = vertexPointsFromTransport(geometry);
  const endpoints = geometry.segEndpoints;
  const lines: { id: number; a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  for (let i = 0; i * 4 < endpoints.length; i += 1) {
    lines.push({
      id: i + 1,
      a: { x: endpoints[i * 4], y: endpoints[i * 4 + 1] },
      b: { x: endpoints[i * 4 + 2], y: endpoints[i * 4 + 3] },
    });
  }
  return {
    vertices,
    hit: {
      vertices: new LineHitIndex(vertices.map((v, i) => ({ id: i + 1, a: v, b: v }))),
      lines: new LineHitIndex(lines),
    },
  };
}

describe('transportUserBounds', () => {
  it('frames every endpoint in SVG user space', () => {
    const bounds = transportUserBounds(GEOMETRY);
    const lo = cpModelToSvg({ x: 0, y: 0 });
    const hi = cpModelToSvg({ x: 200, y: 100 });
    expect(bounds).toEqual({ minX: lo.x, minY: lo.y, maxX: hi.x, maxY: hi.y });
  });

  it('is null for an empty transport', () => {
    expect(transportUserBounds(transport([]))).toBeNull();
  });
});

describe('modelBoundsToUser', () => {
  it('maps through the paper affine', () => {
    const user = modelBoundsToUser({ minX: -200, minY: -200, maxX: 200, maxY: 200 });
    const lo = cpModelToSvg({ x: -200, y: -200 });
    const hi = cpModelToSvg({ x: 200, y: 200 });
    expect(user).toEqual({ minX: lo.x, minY: lo.y, maxX: hi.x, maxY: hi.y });
  });
});

describe('resolveReferencesPick', () => {
  const { vertices, hit } = indexes(GEOMETRY);

  it('picks a vertex before the creases meeting at it, reporting its 0-based index', () => {
    const pick = resolveReferencesPick(hit, vertices, { x: 100.5, y: 99.5 }, 3, 5);
    expect(pick).toEqual({ kind: 'vertex', idx: vertices.findIndex((v) => v.x === 100 && v.y === 100), point: { x: 100, y: 100 } });
    expect(pick?.kind === 'vertex' && pick.idx).toBe(3);
  });

  it('picks a crease by its 1-based id away from any vertex', () => {
    expect(resolveReferencesPick(hit, vertices, { x: 50, y: 101 }, 3, 5)).toEqual({
      kind: 'line',
      id: 1,
    });
    expect(resolveReferencesPick(hit, vertices, { x: 99, y: 50 }, 3, 5)).toEqual({
      kind: 'line',
      id: 2,
    });
  });

  it('lets a crease shadow a vertex only outside the tighter vertex radius', () => {
    // 4 model units from the junction: past the vertex radius, inside the line's.
    expect(resolveReferencesPick(hit, vertices, { x: 104, y: 100 }, 3, 5)).toEqual({
      kind: 'line',
      id: 1,
    });
  });

  it('is null in empty space', () => {
    expect(resolveReferencesPick(hit, vertices, { x: 150, y: 50 }, 3, 5)).toBeNull();
  });
});

const COLORS: ReferencesOverlayColors = {
  folded: [0.5, 0.5, 0.5, 1],
  input: [0, 1, 0, 1],
  new: [1, 0, 1, 1],
};

describe('ghostSegmentsToStrokes', () => {
  it('groups by kind, folded dashed and the rest solid, in draw order', () => {
    const strokes = ghostSegmentsToStrokes(
      [
        { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, kind: 'new' },
        { a: { x: 0, y: 1 }, b: { x: 1, y: 1 }, kind: 'folded' },
        { a: { x: 0, y: 2 }, b: { x: 1, y: 2 }, kind: 'input' },
      ],
      COLORS
    );
    expect(strokes?.count).toBe(3);
    // folded, input, new
    expect(Array.from(strokes!.a)).toEqual([0, 1, 0, 2, 0, 0]);
    expect(Array.from(strokes!.color.slice(0, 4))).toEqual(COLORS.folded);
    expect(Array.from(strokes!.color.slice(4, 8))).toEqual(COLORS.input);
    expect(Array.from(strokes!.color.slice(8, 12))).toEqual(COLORS.new);
    expect(Array.from(strokes!.dashSlot ?? [])).toEqual([1, 0, 0]);
  });

  it('is null with nothing to draw', () => {
    expect(ghostSegmentsToStrokes([], COLORS)).toBeNull();
  });
});

describe('markersToOverlayPoints', () => {
  it('draws inputs as rings and the new mark as a disc, all screen-sized', () => {
    const points = markersToOverlayPoints(
      [
        { at: { x: 5, y: 6 }, kind: 'input' },
        { at: { x: 7, y: 8 }, kind: 'new' },
      ],
      COLORS
    );
    expect(points?.count).toBe(2);
    expect(Array.from(points!.center)).toEqual([5, 6, 7, 8]);
    expect(Array.from(points!.screenSpace)).toEqual([1, 1]);
    // Ring: transparent fill, coloured stroke.
    expect(Array.from(points!.fill.slice(0, 4))).toEqual([0, 1, 0, 0]);
    expect(Array.from(points!.stroke.slice(0, 4))).toEqual(COLORS.input);
    // Disc: filled.
    expect(Array.from(points!.fill.slice(4, 8))).toEqual(COLORS.new);
    expect(points!.radius[0]).toBeGreaterThan(points!.radius[1]);
  });

  it('is null with no markers', () => {
    expect(markersToOverlayPoints([], COLORS)).toBeNull();
  });
});

describe('isClick', () => {
  it('counts movement under the threshold as a click', () => {
    expect(isClick({ x: 10, y: 10 }, { x: 12, y: 13 })).toBe(true);
    expect(isClick({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(false);
  });
});
