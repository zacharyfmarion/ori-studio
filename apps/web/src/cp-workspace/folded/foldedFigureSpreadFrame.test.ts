/**
 * The frame an Edit figure's spread is built in, and its placement: with
 * nothing spread the two are the flat figure's affine, at any turn, scale and
 * offset, on either side; and the reveal is a direction on the page, however
 * the figure is turned.
 */
import type { ConnectedSpread, Point3, SpreadSolution } from '@oristudio/layer-spread';
import { describe, expect, it } from 'vitest';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { cpModelToSvg } from '../../lib/creasePatternViewport';
import type { Point } from '../../lib/geometry';
import type { ConnectedPaperScene, PreparedConnectedSpread } from '../../layer-spread/connectedScene';
import { applyFoldedPlacementToPoint } from '../adapters/cpFoldedToScene';
import { connectedSpreadSource } from './connectedSpreadSource';
import {
  foldedFigureSpreadFrame,
  foldedFigureSpreadPlacement,
  sameSpreadFrame,
  spreadReachFromPivot,
} from './foldedFigureSpreadFrame';
import { foldedFlatPaperScene } from './foldedFlatScene';
import { plainBook, PLAIN_BOOK } from './foldedPrecrease.fixtures';

/**
 * The book seen from the back: the kernel's back pass, mirrored, each stack
 * read from the other side, every face's other side up.
 */
function backOf(front: OristudioCpFoldedPaperScene): OristudioCpFoldedPaperScene {
  const mirror = ({ x, y }: Point): Point => ({ x: -x, y });
  return {
    ...front,
    flipped: true,
    faces: front.faces.map((face) => ({
      ...face,
      front_up: !face.front_up,
      outline: face.outline.map(mirror),
      edges: face.edges.map((edge) => ({ ...edge, from: mirror(edge.from), to: mirror(edge.to) })),
    })),
    subfaces: front.subfaces.map((subface) => ({
      polygon: subface.polygon.map(mirror),
      faces_top_to_bottom: [...subface.faces_top_to_bottom].reverse(),
    })),
  };
}

/** A solve by hand: the leaf folded over lifts toward its free edge. */
function prepared(kernel: OristudioCpFoldedPaperScene): PreparedConnectedSpread {
  const source = connectedSpreadSource(kernel);
  const reference = { plane: [0, 0, 0] as Point3, center: [0, 0, 0] as Point3, samples: 1, rms: 0 };
  const solution: SpreadSolution = {
    version: 'normalized-50-v1',
    heights: source.vertices.map((id) => (id === 2 || id === 5 ? 0.2 : 0)),
    references: [reference, reference],
    diagnostics: {
      status: 'solved',
      iterations: 1,
      qp_seconds: 0,
      variables: 6,
      constraints: 0,
      overlap_regions: 1,
      crossing_weight: 50,
      opening_scale: 1,
      max_relative_warp: 0,
      max_slope: 0.2,
      max_crossing: 0,
      rms_crossing: 0,
      mean_gap: 0.1,
    },
  };
  return { source, solution };
}

const PIVOT = cpModelToSvg({ x: 0.5, y: 0.5 });

describe('foldedFigureSpreadFrame', () => {
  it('composes with its placement to the flat figure’s affine, front and back', () => {
    const placements = [
      { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
      { offset: { x: 40, y: -12 }, scale: 0.5, rotation: 0.7 },
      { offset: { x: -300, y: 25 }, scale: 2.3, rotation: -2.1 },
      { offset: { x: 1, y: 2 }, scale: 1, rotation: Math.PI },
    ];
    for (const kernel of [plainBook(), backOf(plainBook())]) {
      for (const placement of placements) {
        const frame = foldedFigureSpreadFrame(PIVOT, placement.rotation);
        const placed = foldedFigureSpreadPlacement(placement, PIVOT);
        for (const face of kernel.faces) {
          for (const point of face.outline) {
            const [x, y] = frame.toScenePx(point);
            const flat = applyFoldedPlacementToPoint(cpModelToSvg(point), placement, PIVOT);
            expect(placed.scale * x + placed.x).toBeCloseTo(flat.x, 9);
            expect(placed.scale * y + placed.y).toBeCloseTo(flat.y, 9);
          }
        }
      }
    }
  });

  it('builds at the paper map’s scale, which a turn keeps', () => {
    const unit = cpModelToSvg({ x: 1, y: 0 }).x - cpModelToSvg({ x: 0, y: 0 }).x;
    for (const rotation of [0, 1.3]) {
      const frame = foldedFigureSpreadFrame(PIVOT, rotation);
      expect(frame.scale).toBeCloseTo(unit, 12);
      const [ax, ay] = frame.toScenePx({ x: 0, y: 0 });
      const [bx, by] = frame.toScenePx({ x: 1, y: 0 });
      expect(Math.hypot(bx - ax, by - ay)).toBeCloseTo(unit, 9);
    }
  });

  it('keeps the reveal on the page however the figure turns: the near layer is pulled, on either side', () => {
    const spread: ConnectedSpread = { kind: 'connected', version: 1, amount: 1, reveal: [1, 0] };
    for (const [kernel, nearIsOver] of [
      [plainBook(), true],
      [backOf(plainBook()), false],
    ] as const) {
      const connected = prepared(kernel);
      for (const rotation of [0, Math.PI / 2, 1.1, -2.5]) {
        const frame = foldedFigureSpreadFrame(PIVOT, rotation);
        const at = (amount: number) =>
          (
            foldedFlatPaperScene(kernel, {
              markHidden: false,
              live: true,
              connected,
              spread: { ...spread, amount },
              toScenePx: frame.toScenePx,
              scale: frame.scale,
            }) as ConnectedPaperScene
          ).connected.mesh.positions;
        const flat = at(0);
        const spreadOut = at(1);
        const moved = spreadOut.map(([x, y], v) => [x - flat[v]![0], y - flat[v]![1]] as const);
        // Every vertex moves along the reveal, on the page: never across it.
        for (const [dx, dy] of moved) expect(Math.abs(dy)).toBeLessThan(1e-9 * Math.max(1, Math.abs(dx)));
        // The folded-over leaf's free corners are the ones lifted: forward from
        // the front, where that leaf is near, back from the back, where it is far.
        const lifted = moved.filter(([dx]) => Math.abs(dx) > 1e-9);
        expect(lifted.length).toBeGreaterThan(0);
        for (const [dx] of lifted) expect(Math.sign(dx)).toBe(nearIsOver ? 1 : -1);
      }
    }
    expect(PLAIN_BOOK.over).toBe(1);
  });

  it('tells frames apart by pivot and turn only', () => {
    expect(sameSpreadFrame(foldedFigureSpreadFrame(PIVOT, 0.5), foldedFigureSpreadFrame({ ...PIVOT }, 0.5))).toBe(true);
    expect(sameSpreadFrame(foldedFigureSpreadFrame(PIVOT, 0.5), foldedFigureSpreadFrame(PIVOT, 0.6))).toBe(false);
    expect(
      sameSpreadFrame(foldedFigureSpreadFrame(PIVOT, 0), foldedFigureSpreadFrame({ x: PIVOT.x + 1, y: PIVOT.y }, 0))
    ).toBe(false);
  });
});

describe('spreadReachFromPivot', () => {
  it('measures along the figure’s own axes, its turn undone', () => {
    const pivot = { x: 10, y: 20 };
    const rotation = Math.PI / 2;
    // A point 3 along the figure's x and 1 along its y, turned a quarter.
    const reach = spreadReachFromPivot({ pivot, rotation }, (visit) => {
      visit(pivot.x - 1, pivot.y + 3);
      visit(pivot.x + 0.5, pivot.y - 2);
    });
    expect(reach.halfWidth).toBeCloseTo(3, 12);
    expect(reach.halfHeight).toBeCloseTo(1, 12);
  });
});
