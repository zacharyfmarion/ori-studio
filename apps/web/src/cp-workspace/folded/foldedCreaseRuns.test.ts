/**
 * Erode on a folded figure's flat creases and crease marks, on hand-built
 * kernel scenes: a flat crease reaches the painter cut at every vertex, a mark
 * cut where it crosses one, and the crease is what erodes — at a border or a
 * fold, never at a crossing. The same over the real engine is
 * `fold/canvas/foldPaneErode.wasm.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { OristudioCpFoldedPaperFace, OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import type { PaperLineItem, PaperScene } from '../../lib/paper/paperScene';
import { erodeLine } from '../../lib/paper/paperSvg';
import { auxLineEnds, auxLineRuns, creaseRuns, flatEdgeRuns, runEnds } from './foldedCreaseRuns';
import { foldedFlatPaperScene } from './foldedFlatScene';
import { kernelFace, precreasedBook, PRECREASED_BOOK } from './foldedPrecrease.fixtures';

const ERODE = 0.04;
const point = (x: number, y: number): Point => ({ x, y });

function kernelScene(
  faces: OristudioCpFoldedPaperFace[],
  sheet: Array<[number, number]>,
  aux: OristudioCpFoldedPaperScene['aux_lines'] = []
): OristudioCpFoldedPaperScene {
  return {
    schema_version: 3,
    flipped: false,
    sheet: 1,
    faces,
    // Each face on its own subface: one layer, nothing over anything.
    subfaces: faces.map(({ outline }, face) => ({ polygon: outline, faces_top_to_bottom: [face] })),
    aux_lines: aux,
    sheet_points: sheet.map(([x, y]) => point(x, y)),
  };
}

/**
 * A unit square precreased across at x = ½ and y = `y`, four faces round the
 * crossing: sheet vertices 0 1 2 along the bottom, 3 on the right at `y`, 4 5
 * 6 along the top, 7 on the left at `y`, 8 the crossing.
 */
function crossed(y = 0.5, aux: OristudioCpFoldedPaperScene['aux_lines'] = []): OristudioCpFoldedPaperScene {
  return kernelScene(
    [
      kernelFace([[0, 0], [0.5, 0], [0.5, y], [0, y]], [0, 1, 8, 7], ['border', 'flat', 'flat', 'border']),
      kernelFace([[0.5, 0], [1, 0], [1, y], [0.5, y]], [1, 2, 3, 8], ['border', 'border', 'flat', 'flat']),
      kernelFace([[0.5, y], [1, y], [1, 1], [0.5, 1]], [8, 3, 4, 5], ['flat', 'border', 'border', 'flat']),
      kernelFace([[0, y], [0.5, y], [0.5, 1], [0, 1]], [7, 8, 5, 6], ['flat', 'flat', 'border', 'border']),
    ],
    [[0, 0], [0.5, 0], [1, 0], [1, y], [1, 1], [0.5, 1], [0, 1], [0, y], [0.5, y]],
    aux
  );
}

/** The figure's scene in its own units (one scene px per kernel unit, y up). */
function sceneOf(kernel: OristudioCpFoldedPaperScene): PaperScene {
  return foldedFlatPaperScene(kernel, { markHidden: false, toScenePx: ({ x, y }) => [x, y], scale: 1 });
}

/** The aux ink a scene draws along the line `a`–`b` under erode, as merged parameters along it. */
function inkAlong(scene: PaperScene, a: Point, b: Point, which: (line: PaperLineItem) => boolean = () => true): number[][] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const span = dx * dx + dy * dy;
  const off = ([x, y]: [number, number]) => Math.abs(dx * (y - a.y) - dy * (x - a.x)) / Math.sqrt(span);
  const along = ([x, y]: [number, number]) => ((x - a.x) * dx + (y - a.y) * dy) / span;
  const stretches = scene.items
    .flatMap((item) => {
      if (item.kind !== 'line' || item.role !== 'aux' || !which(item)) return [];
      if (off(item.a) > 1e-9 || off(item.b) > 1e-9) return [];
      const ink = erodeLine(item, ERODE * scene.sheet);
      return ink ? [[along(ink[0]), along(ink[1])].sort((p, q) => p - q)] : [];
    })
    .sort((p, q) => p[0]! - q[0]!);
  const merged: number[][] = [];
  for (const [low, high] of stretches) {
    const last = merged[merged.length - 1];
    if (last && low! <= last[1]! + 1e-9) last[1] = Math.max(last[1]!, high!);
    else merged.push([low!, high!]);
  }
  return merged.map((stretch) => stretch.map((t) => Math.round(t * 1e6) / 1e6));
}

describe('a flat crease’s run', () => {
  it('runs through a crossing to the paper’s edge, and retreats only there', () => {
    const runs = flatEdgeRuns(crossed(), 1e-9);
    // The bottom-left face's upright edge, x = ½ from the edge up to the crossing: the crease goes on as far again.
    expect(runs[0]![1]).toEqual({ before: 0, after: 1, onBoundary: [true, true] });
    // Its edge along y = ½, from the crossing out to the left edge: in its own direction, the crease came as far.
    expect(runs[0]![2]).toEqual({ before: 1, after: 0, onBoundary: [true, true] });
    expect(runs[0]![0]).toBeNull();
  });

  it('erodes two crossing precreases at the edge alone', () => {
    const scene = sceneOf(crossed());
    expect(inkAlong(scene, point(0.5, 0), point(0.5, 1))).toEqual([[ERODE, 1 - ERODE]]);
    expect(inkAlong(scene, point(0, 0.5), point(1, 0.5))).toEqual([[ERODE, 1 - ERODE]]);
  });

  it('keeps the stub of a crease another cuts within twice the pull of the edge', () => {
    // The piece of x = ½ below the crossing is 0.06 long; eroded on its own it was nothing.
    expect(inkAlong(sceneOf(crossed(0.06)), point(0.5, 0), point(0.5, 1))).toEqual([[ERODE, 1 - ERODE]]);
  });

  it('stops at a fold, and retreats there: a precreased book', () => {
    const kernel = precreasedBook();
    const runs = flatEdgeRuns(kernel, 1e-9);
    const { underHigh, overHigh } = PRECREASED_BOOK;
    // Each leaf's half of the precrease runs from the paper's edge to the fold, and no further.
    expect(runs[underHigh]![0]).toEqual({ before: 0, after: 0, onBoundary: [true, true] });
    expect(runs[overHigh]![0]).toEqual({ before: 0, after: 0, onBoundary: [true, true] });
  });

  it('draws the outline of a face of flat creases as lines when one reaches the edge', () => {
    // Creases joining the edges' midpoints: a diamond of flat creases whose corners are on the edge.
    const kernel = kernelScene(
      [
        kernelFace([[0, 0], [0.5, 0], [0, 0.5]], [0, 1, 7], ['border', 'flat', 'border']),
        kernelFace([[0.5, 0], [1, 0], [1, 0.5]], [1, 2, 3], ['border', 'border', 'flat']),
        kernelFace([[1, 0.5], [1, 1], [0.5, 1]], [3, 4, 5], ['border', 'border', 'flat']),
        kernelFace([[0.5, 1], [0, 1], [0, 0.5]], [5, 6, 7], ['border', 'border', 'flat']),
        kernelFace([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]], [1, 3, 5, 7], ['flat', 'flat', 'flat', 'flat']),
      ],
      [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]
    );
    const scene = sceneOf(kernel);
    const diamond = scene.items.find((item) => item.kind === 'face' && item.face === 4);
    expect(diamond).not.toHaveProperty('outline');
    const side = Math.SQRT1_2;
    // Every face that draws the crease pulls it back at both ends.
    expect(inkAlong(scene, point(0.5, 0), point(1, 0.5))).toEqual([[ERODE / side, 1 - ERODE / side].map((t) => Math.round(t * 1e6) / 1e6)]);
    for (const item of scene.items) {
      if (item.kind === 'line' && item.role === 'aux') expect(item.onBoundary).toEqual([true, true]);
    }
  });
});

describe('a crease mark’s run', () => {
  it('reads a flat crease it ends on as inside its layer, and a border as an end', () => {
    const kernel = crossed();
    expect(auxLineEnds(kernel, { face: 0, from: point(0.25, 0.25), to: point(0.5, 0.25) }, 1e-9)).toEqual([false, false]);
    expect(auxLineEnds(kernel, { face: 0, from: point(0, 0.25), to: point(0.5, 0.25) }, 1e-9)).toEqual([true, false]);
  });

  it('goes on into the face across the flat crease it was cut at', () => {
    // A segment across x = ½ at y = ¼, and a mark from the left edge across the same crease at y = 0.1.
    const kernel = crossed(0.5, [
      { face: 0, from: point(0.25, 0.25), to: point(0.5, 0.25) },
      { face: 1, from: point(0.5, 0.25), to: point(0.75, 0.25) },
      { face: 0, from: point(0, 0.1), to: point(0.5, 0.1) },
      { face: 1, from: point(0.5, 0.1), to: point(0.53, 0.1) },
    ]);
    const runs = auxLineRuns(kernel, 1e-9);
    expect(runs[0]).toEqual({ before: 0, after: 1, onBoundary: [false, false] });
    expect(runs[1]).toEqual({ before: 1, after: 0, onBoundary: [false, false] });
    expect(runs[3]!.onBoundary).toEqual([true, false]);
    const scene = sceneOf(kernel);
    expect(inkAlong(scene, point(0, 0.25), point(1, 0.25))).toEqual([[0.25, 0.75]]);
    // The mark's piece past the crease, 0.03 long, is the far end; the pull at the edge takes 0.04 from the whole.
    expect(inkAlong(scene, point(0, 0.1), point(1, 0.1))).toEqual([[ERODE, 0.53]]);
  });
});

describe('runEnds', () => {
  it('lays the crease along the piece, and flags only the piece’s own retreating ends', () => {
    const run = { before: 1, after: 0, onBoundary: [true, true] as [boolean, boolean] };
    expect(runEnds([2, 0], [4, 0], run)).toEqual({ onBoundary: [false, true], whole: { a: [0, 0], b: [4, 0], onBoundary: [true, true] } });
    // A stretch of the piece: the crease past both of its ends.
    expect(runEnds([2, 0], [4, 0], run, [0.5, 0.75]).onBoundary).toEqual([false, false]);
    expect(runEnds([2, 0], [4, 0], { before: 0, after: 0, onBoundary: [true, false] })).toEqual({ onBoundary: [true, false] });
  });

  it('chains a graph’s joining edges straight through a vertex that does not retreat', () => {
    const runs = creaseRuns(
      [
        { u: 0, v: 1, from: point(0, 0), to: point(1, 0), joins: true },
        { u: 2, v: 1, from: point(3, 0), to: point(1, 0), joins: true },
        { u: 1, v: 3, from: point(1, 0), to: point(1, 1), joins: true },
      ],
      (vertex) => vertex !== 1,
      1e-9
    );
    expect(runs[0]).toEqual({ before: 0, after: 2, onBoundary: [true, true] });
    expect(runs[1]).toEqual({ before: 0, after: 0.5, onBoundary: [true, true] });
    // Nothing carries the third on straight: a crease of its own.
    expect(runs[2]).toEqual({ before: 0, after: 0, onBoundary: [false, true] });
  });
});
