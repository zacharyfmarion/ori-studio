import { describe, expect, it } from 'vitest';
import { visibility, type Point3 } from '@oristudio/layer-spread';
import type { FoldedSceneInk } from '../cp-workspace/adapters/cpFoldedToScene';
import type { SpreadGeometry } from '../cp-workspace/renderer/programs/spreadProgram';
import type { PaperLineItem, PaperLineRole } from '../lib/paper/paperScene';
import { DEFAULT_PAPER_STYLE, type PaperStyle } from '../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../lib/paper/paperStyleResolve';
import { connectedPaperScene, type ConnectedDrawing, type ConnectedInk, type ConnectedPaperScene } from './connectedScene';
import { meshSpreadGeometry, paintedSpreadGeometry, spreadGeometry } from './spreadGeometry';

it('keeps thin flap vertices and ink at their material depth after Float32 coordinate rounding', () => {
  // The lower boundary rounds down, outside this triangle in double precision.
  // Moving the flap by a tiny amount must not snap its depth to the middle.
  for (const shift of [0, 0.00002, 0.0001]) {
    const a: Point3 = [4000.0001 + shift, 3000.0001, 0];
    const b: Point3 = [4100.0001 + shift, 3000.0001, 0];
    const c: Point3 = [4000.0001 + shift, 3000.0101, 0];
    const drawing: ConnectedDrawing = {
      mesh: {
        positions: [a, b, c, [4000, 3000, 1], [4100, 3000, 1], [4000, 3100, 1]],
        triangles: [[0, 1, 2], [3, 4, 5]],
        triangleFaces: [0, 1],
        visibility: visibility(2, [[0, 1]]),
      },
      rings: [[0, 1, 2], [3, 4, 5]],
      front: [true, false],
      ink: [{
        face: 0, a, b,
        line: {
          kind: 'line', role: 'edge', face: 0,
          a: [a[0], a[1]], b: [b[0], b[1]],
          hidden: false, onBoundary: [true, true],
        },
      }],
    };
    const scene = connectedPaperScene(drawing, 100) as ConnectedPaperScene;
    const geometry = spreadGeometry(scene, DEFAULT_PAPER_STYLE, {});
    expect([...geometry.faces[0]!.fills.depth!]).toEqual([0, 0, 0]);
    expect([...geometry.faces[0]!.strokes.depth!]).toEqual([0]);
    expect([...geometry.faces[0]!.strokes.depthEnd!]).toEqual([0]);
    expect([...geometry.faces[1]!.fills.depth!]).toEqual([1, 1, 1]);
  }
});

/**
 * Three faces at different heights — a flat square, a sloped back face, a
 * high triangle — with edges, creases that erode, two dashed pens and an aux
 * line: every pen, every kind of end and every depth the live drawing has.
 */
function sampleScene(): ConnectedPaperScene {
  const positions: Point3[] = [
    [0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0],
    // Sloped: z = 10 + 0.2 (x - 50) + 0.2 (y - 50).
    [50, 50, 10], [150, 50, 30], [150, 150, 50], [50, 150, 30],
    [20, 120, 60], [80, 120, 60], [50, 180, 60],
  ];
  const height = (x: number, y: number) => 10 + 0.2 * (x - 50) + 0.2 * (y - 50);
  const line = (face: number, role: PaperLineRole, a: Point3, b: Point3, extra: Partial<PaperLineItem> = {}): ConnectedInk => ({
    face, a, b,
    line: { kind: 'line', role, face, a: [a[0], a[1]], b: [b[0], b[1]], hidden: false, onBoundary: [true, true], joined: [true, true], ...extra },
  });
  const ringEdges = (face: number, ring: number[]) =>
    ring.map((v, k) => line(face, 'edge', positions[v]!, positions[ring[(k + 1) % ring.length]!]!));
  const drawing: ConnectedDrawing = {
    mesh: {
      positions,
      triangles: [[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7], [8, 9, 10]],
      triangleFaces: [0, 0, 1, 1, 2],
      visibility: visibility(3, [[0, 1], [1, 2]]),
    },
    rings: [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10]],
    front: [true, false, true],
    ink: [
      ...ringEdges(0, [0, 1, 2, 3]),
      line(0, 'diagram-valley', [10, 10, 0], [90, 90, 0], {
        whole: { a: [-20, -20], b: [120, 120], onBoundary: [true, false] },
      }),
      ...ringEdges(1, [4, 5, 6, 7]),
      line(1, 'mountain', [60, 60, height(60, 60)], [140, 140, height(140, 140)]),
      line(1, 'diagram-mountain', [100, 60, height(100, 60)], [140, 100, height(140, 100)], { onBoundary: [false, true] }),
      ...ringEdges(2, [8, 9, 10]),
      line(2, 'aux', [30, 125, 60], [70, 125, 60], { onBoundary: [false, false] }),
    ],
  };
  return connectedPaperScene(drawing, 100) as ConnectedPaperScene;
}

/** Erode a few px, so the creases' ends move along them. */
const ERODING: PaperStyle = { ...DEFAULT_PAPER_STYLE, erode: 0.03 };

/**
 * Each face's fills as triangles in any vertex order, and its lines as drawn:
 * the same, but for depths, which agree to 1e-6 — the painter's are looked up
 * from Float32 positions.
 */
function expectSameDrawing(actual: SpreadGeometry, expected: SpreadGeometry) {
  expect(actual.visibility).toBe(expected.visibility);
  expect(actual.faces).toHaveLength(expected.faces.length);
  type Face = SpreadGeometry['faces'][number];
  const triangles = (fills: Face['fills']) =>
    new Map(Array.from({ length: fills.count / 3 }, (_, t) => {
      const corners = [0, 1, 2]
        .map((k) => ({ at: `${fills.position[2 * (3 * t + k)]},${fills.position[2 * (3 * t + k) + 1]}`, depth: fills.depth![3 * t + k]! }))
        .sort((l, r) => l.at.localeCompare(r.at));
      const key = `${corners.map((c) => c.at).join(' ')} ${[...fills.color.subarray(12 * t, 12 * t + 4)].join(',')}`;
      return [key, corners.map((c) => c.depth)] as const;
    }));
  const lines = (strokes: Face['strokes']) =>
    Array.from({ length: strokes.count }, (_, s) => {
      const slot = strokes.dashSlot ? Math.round(strokes.dashSlot[s]!) : 0;
      const drawn = [
        [...strokes.a.subarray(2 * s, 2 * s + 2), ...strokes.b.subarray(2 * s, 2 * s + 2)].join(','),
        [...strokes.color.subarray(4 * s, 4 * s + 4)].join(','),
        strokes.widthMul[s],
        slot ? strokes.dashPatterns![slot - 1]!.join(',') : 'solid',
        strokes.dashPhase?.[s] ?? 0,
      ].join(' | ');
      return { drawn, depths: [strokes.depth![s]!, strokes.depthEnd![s]!] };
    });
  expected.faces.forEach((face, f) => {
    const want = triangles(face.fills),
      got = triangles(actual.faces[f]!.fills);
    expect([...got.keys()].sort()).toEqual([...want.keys()].sort());
    for (const [key, depths] of want) got.get(key)!.forEach((depth, k) => expect(depth).toBeCloseTo(depths[k]!, 6));
    const wantLines = lines(face.strokes),
      gotLines = lines(actual.faces[f]!.strokes);
    expect(gotLines.map((l) => l.drawn)).toEqual(wantLines.map((l) => l.drawn));
    wantLines.forEach(({ depths }, s) => depths.forEach((depth, k) => expect(gotLines[s]!.depths[k]).toBeCloseTo(depth, 6)));
  });
}

describe('a live spread drawn straight from its mesh', () => {
  const inks: [string, FoldedSceneInk][] = [
    ['the Diagram', { policy: PAPER_STYLE_POLICIES.fold }],
    ['Edit', { policy: PAPER_STYLE_POLICIES['folded-flat'] }],
    ['a tinted, see-through face', { policy: PAPER_STYLE_POLICIES.fold, faceAlpha: 0.9, faces: new Map([[1, { tint: [1, 0, 0, 0.5], alpha: 0.8 }]]) }],
  ];
  it.each(inks)('draws what the painter draws, for %s', (_, ink) => {
    const scene = sampleScene();
    const drawn = meshSpreadGeometry(scene, ERODING, ink);
    expect(drawn).not.toBeNull();
    // The creases eroded, so the comparison reaches ends the mesh does not hold.
    expect(drawn!.faces[1]!.strokes.depth![4]).toBeGreaterThan(14 / 60);
    expectSameDrawing(drawn!, paintedSpreadGeometry(scene, ERODING, ink));
  });

  it('draws what is left when a host leaves lines out', () => {
    // As Fold's folded pane does with Precreases off.
    const full = sampleScene();
    const scene = { ...full, items: full.items.filter((item) => item.kind !== 'line' || (item.role !== 'aux' && item.face !== 0)) };
    const ink = { policy: PAPER_STYLE_POLICIES.fold };
    const drawn = meshSpreadGeometry(scene, ERODING, ink);
    expect(drawn).not.toBeNull();
    expect(drawn!.faces[0]!.strokes.count).toBe(0);
    expectSameDrawing(drawn!, paintedSpreadGeometry(scene, ERODING, ink));
  });

  it('draws a piece the host changed face by face, as the painter does', () => {
    const full = sampleScene();
    const items = full.items.map((item) =>
      item.kind === 'face' && !item.hidden && item.face === 2 ? { ...item, rings: [[[20, 120], [80, 120], [65, 150], [50, 180]] as [number, number][]] } : item);
    const scene = { ...full, items };
    const ink = { policy: PAPER_STYLE_POLICIES.fold };
    expect(meshSpreadGeometry(scene, ERODING, ink)).toBeNull();
    expect(spreadGeometry(scene, ERODING, ink)).toEqual(paintedSpreadGeometry(scene, ERODING, ink));
  });
});
