import { describe, expect, it } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { vertexPointsFromTransport } from '../../engine/oristudioCpGeometry';
import { cpModelToSvg } from '../../lib/creasePatternViewport';
import { LineHitIndex } from '../picking/lineHitIndex';
import type { Rgba, StrokeGeometry } from '../renderer/types';
import {
  applyCreaseVisibility,
  ghostSegmentsToStrokes,
  isClick,
  markersToOverlayPoints,
  modelBoundsToUser,
  resolveReferencesPick,
  sheetFillGeometry,
  transportUserBounds,
  verticesOfLines,
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
  mark: [1, 1, 1, 1],
  mountain: [1, 0, 0, 1],
  valley: [0, 0, 1, 1],
  unassigned: [0.25, 0.25, 0.25, 1],
  unfoldedAlpha: 0.25,
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
    expect(Array.from(strokes!.color.slice(8, 12))).toEqual(COLORS.unassigned);
    expect(Array.from(strokes!.dashSlot ?? [])).toEqual([1, 0, 0]);
  });

  it('draws a crease in the ink that says which way it folds', () => {
    const strokes = ghostSegmentsToStrokes(
      [
        { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, kind: 'new', direction: 'mountain' },
        { a: { x: 0, y: 1 }, b: { x: 1, y: 1 }, kind: 'new', direction: 'valley' },
      ],
      COLORS
    );
    expect(Array.from(strokes!.color.slice(0, 4))).toEqual(COLORS.mountain);
    expect(Array.from(strokes!.color.slice(4, 8))).toEqual(COLORS.valley);
  });

  it('draws the uncreased part in the same ink, faintly', () => {
    const strokes = ghostSegmentsToStrokes(
      [{ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, kind: 'unfolded', direction: 'mountain' }],
      COLORS
    );
    const [r, g, b, a] = Array.from(strokes!.color.slice(0, 4));
    expect([r, g, b]).toEqual(COLORS.mountain.slice(0, 3));
    expect(a).toBeCloseTo(COLORS.mountain[3] * COLORS.unfoldedAlpha, 5);
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
    // Disc: filled, in the diagram's ink — a mark is a point, not a crease, so
    // it takes no fold colour.
    expect(Array.from(points!.fill.slice(4, 8))).toEqual(COLORS.mark);
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

describe('applyCreaseVisibility', () => {
  /** Four opaque strokes plus one appended hint overlay. */
  function strokes(): StrokeGeometry {
    const count = 5;
    return {
      a: new Float32Array(count * 2),
      b: new Float32Array(count * 2),
      color: Float32Array.from(Array.from({ length: count }, () => [1, 1, 1, 1]).flat()),
      widthMul: new Float32Array(count).fill(1),
      dashSlot: new Float32Array(count),
      dashPatterns: [],
      count,
    } as unknown as StrokeGeometry;
  }
  const alphaOf = (geometry: StrokeGeometry) =>
    Array.from({ length: geometry.count }, (_, i) => geometry.color[i * 4 + 3]);

  it('returns the buffer untouched when nothing is filtered', () => {
    const input = strokes();
    expect(applyCreaseVisibility(input, 4, { visible: null, dimmed: null, dimAlpha: 1 }, 1.25)).toBe(input);
  });

  it('zeroes a crease no step has reached and scales a dimmed one', () => {
    const out = applyCreaseVisibility(strokes(), 4, {
      visible: new Set([1, 2]),
      dimmed: new Set([2]),
      dimAlpha: 0.25,
    }, 1.25);
    // Crease 1 full, crease 2 dimmed, creases 3-4 hidden, and the appended hint
    // overlay (index 4, past the document's segments) dropped with them.
    expect(alphaOf(out)).toEqual([1, 0.25, 0, 0, 0]);
  });

  it('does not mutate the buffer it was given', () => {
    const input = strokes();
    applyCreaseVisibility(input, 4, { visible: new Set([1]), dimmed: null, dimAlpha: 0.5 }, 1.25);
    expect(alphaOf(input)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('dash continuity along one line', () => {
  const strokes = (pairs: [number, number, number, number][]) => ({
    a: Float32Array.from(pairs.flatMap(([ax, ay]) => [ax, ay])),
    b: Float32Array.from(pairs.flatMap(([, , bx, by]) => [bx, by])),
    color: new Float32Array(pairs.length * 4).fill(1),
    widthMul: new Float32Array(pairs.length).fill(1),
    count: pairs.length,
  });
  const visible = (n: number) => new Set(Array.from({ length: n }, (_, i) => i + 1));

  // A crease is split at every crossing. Each piece restarting the pattern is
  // what made a dashed line read as a row of unrelated dashes.
  it('measures collinear pieces on one ruler', () => {
    const out = applyCreaseVisibility(
      strokes([
        [0, 0, 3, 0],
        [3, 0, 7, 0],
        [7, 0, 9, 0],
      ]),
      3,
      { visible: visible(3), dimmed: null, dimAlpha: 1 }
    , 1.25);
    expect([...(out.dashPhase ?? [])]).toEqual([0, 3, 7]);
  });

  // The document stores a segment either way round; the ruler must not care.
  it('is the same ruler for a piece stored backwards', () => {
    const forward = applyCreaseVisibility(strokes([[3, 0, 7, 0]]), 1, {
      visible: visible(1),
      dimmed: null,
      dimAlpha: 1,
    }, 1.25);
    const backward = applyCreaseVisibility(strokes([[7, 0, 3, 0]]), 1, {
      visible: visible(1),
      dimmed: null,
      dimAlpha: 1,
    }, 1.25);
    expect([...(backward.dashPhase ?? [])]).toEqual([...(forward.dashPhase ?? [])]);
    // …and the segment is reoriented to match, so the pattern runs the same way.
    expect([...backward.a]).toEqual([...forward.a]);
    expect([...backward.b]).toEqual([...forward.b]);
  });

  // markhor step 41: a crease 0.02 long whose start, measured from the
  // origin, fell in a gap of the pattern. The ruler starts where the line's
  // visible crease starts, so its first piece opens with a dash; a piece of
  // the same line that is not shown yet does not move the start.
  it('starts each line’s ruler where its visible crease begins', () => {
    const out = applyCreaseVisibility(
      strokes([
        [5, 2, 6, 2],
        [6, 2, 9, 2],
        [1, 2, 5, 2],
        [0, 7, 4, 7],
      ]),
      4,
      { visible: new Set([1, 2, 4]), dimmed: null, dimAlpha: 1 },
      1.25
    );
    const phases = [...(out.dashPhase ?? [])];
    expect(phases[0]).toBeCloseTo(0, 6);
    expect(phases[1]).toBeCloseTo(1, 6);
    expect(phases[3]).toBeCloseTo(0, 6);
  });

  it('measures a diagonal along its own axis, not along x', () => {
    const k = Math.SQRT1_2;
    const out = applyCreaseVisibility(
      strokes([
        [0, 0, k, k],
        [k, k, 2 * k, 2 * k],
      ]),
      2,
      { visible: visible(2), dimmed: null, dimAlpha: 1 }
    , 1.25);
    const phases = [...(out.dashPhase ?? [])];
    expect(phases[0]).toBeCloseTo(0, 6);
    expect(phases[1]).toBeCloseTo(1, 6);
  });
});

describe('vertices worth marking', () => {
  const transport = (segs: [number, number, number, number][]) =>
    ({ segEndpoints: Float64Array.from(segs.flat()) }) as unknown as CpGeometryTransport;
  const ids = (n: number) => new Set(Array.from({ length: n }, (_, i) => i + 1));

  // The pattern splits a crease wherever its assignment changes. The plan folds
  // the whole line one way, so that split is invisible in the fold — a dot
  // there marks nothing the folder can use.
  it('drops a point where one straight line merely continues', () => {
    const geometry = transport([
      [0, 0, 5, 0],
      [5, 0, 9, 0],
    ]);
    const vertices = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 9, y: 0 },
    ];
    expect(
      [...verticesOfLines(geometry, vertices, ids(2), { dropCollinear: true })].sort()
    ).toEqual([0, 2]);
    // …but it is still a real point of the pattern, so picking keeps it.
    expect([...verticesOfLines(geometry, vertices, ids(2))].sort()).toEqual([0, 1, 2]);
  });

  it('keeps a point where two creases actually cross', () => {
    const geometry = transport([
      [0, 0, 5, 0],
      [5, 0, 5, 5],
    ]);
    const vertices = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ];
    expect(
      [...verticesOfLines(geometry, vertices, ids(2), { dropCollinear: true })].sort()
    ).toEqual([0, 1, 2]);
  });

  it('keeps a point where three creases meet, collinear pair or not', () => {
    const geometry = transport([
      [0, 0, 5, 0],
      [5, 0, 9, 0],
      [5, 0, 5, 4],
    ]);
    const vertices = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 9, y: 0 },
      { x: 5, y: 4 },
    ];
    expect(
      [...verticesOfLines(geometry, vertices, ids(3), { dropCollinear: true })].sort()
    ).toEqual([0, 1, 2, 3]);
  });
});

describe('the paper as a shape', () => {
  const transport = (segs: [number, number, number, number][]) =>
    ({ segEndpoints: Float64Array.from(segs.flat()) }) as unknown as CpGeometryTransport;
  // Exactly representable in f32, so the buffer round-trip is not the test.
  const GREY: Rgba = [0.25, 0.5, 0.75, 1];
  const square: [number, number, number, number][] = [
    [0, 0, 10, 0],
    [10, 0, 10, 10],
    [10, 10, 0, 10],
    [0, 10, 0, 0],
  ];

  // The clear colour is the ground the sheet lies on. Tinting the whole canvas
  // to say "you are looking at the back" claims the table turned over too.
  it('covers the sheet and nothing else', () => {
    const fill = sheetFillGeometry(transport(square), new Set([1, 2, 3, 4]), GREY);
    expect(fill).not.toBeNull();
    expect(fill!.count).toBe(6);
    const xs = [...fill!.position].filter((_, i) => i % 2 === 0);
    const ys = [...fill!.position].filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(10);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(10);
    // Two triangles of the same colour, one per vertex.
    expect([...fill!.color.slice(0, 4)]).toEqual([...GREY]);
    expect(fill!.color).toHaveLength(fill!.count * 4);
  });

  // A rotated sheet is still a rectangle; the hull does not care which order
  // the document stored its edges in.
  it('fills a sheet that is not axis-aligned', () => {
    const diamond: [number, number, number, number][] = [
      [5, 0, 10, 5],
      [10, 5, 5, 10],
      [5, 10, 0, 5],
      [0, 5, 5, 0],
    ];
    const fill = sheetFillGeometry(transport(diamond), new Set([1, 2, 3, 4]), GREY);
    expect(fill!.count).toBe(6);
  });

  it('is nothing at all without a border', () => {
    expect(sheetFillGeometry(transport(square), null, GREY)).toBeNull();
    expect(sheetFillGeometry(transport(square), new Set(), GREY)).toBeNull();
  });
});
