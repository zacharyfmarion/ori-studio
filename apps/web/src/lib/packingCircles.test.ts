import { describe, expect, it } from 'vitest';
import {
  boxPleatCpBounds,
  boxPleatPackingCircles,
  isCircularBpFlap,
  leafCirclePaperRadius,
  strainedEdgeLength,
  treemakerFoldBounds,
  treemakerPackingCircles,
} from './packingCircles';
import type { NodeSnapshot } from '../engine/types';
import type { OristudioBpSheet } from '../engine/oristudioBpTypes';

function leaf(id: number, x: number, y: number): NodeSnapshot {
  return {
    id,
    label: `n${id}`,
    loc: { x, y },
    is_leaf: true,
    is_pinned: false,
    is_conditioned: false,
    owner: null,
  };
}

function branch(id: number, x: number, y: number): NodeSnapshot {
  return { ...leaf(id, x, y), is_leaf: false };
}

function edge(nodes: [number, number], length: number, strain = 0) {
  return { nodes, length, strain };
}

function bpSheet(
  kind: OristudioBpSheet['kind'],
  width: number,
  height = width
): OristudioBpSheet {
  return {
    kind,
    width,
    height,
    grid: { kind: kind === 'diagonal' ? 'diagonal' : 'rectangular', interval: 1, snap: true },
  };
}

function bpFlap(x: number, y: number, radius: number, width = 0, height = 0) {
  return { anchor: { x, y }, width, height, radius };
}

describe('strainedEdgeLength', () => {
  it('is the nominal length when there is no strain', () => {
    expect(strainedEdgeLength({ length: 2, strain: 0 })).toBe(2);
  });

  it('applies strain the way Edge::strained_length does', () => {
    expect(strainedEdgeLength({ length: 2, strain: 0.5 })).toBe(3);
    expect(strainedEdgeLength({ length: 2, strain: -0.25 })).toBe(1.5);
  });
});

describe('leafCirclePaperRadius', () => {
  it('is the strained edge length scaled onto the paper', () => {
    const edges = [edge([1, 2], 2, 0.5)];
    expect(leafCirclePaperRadius(1, edges, 0.1)).toBeCloseTo(0.3, 12);
  });

  it('is zero for a node no edge reaches', () => {
    expect(leafCirclePaperRadius(99, [edge([1, 2], 2)], 0.1)).toBe(0);
  });
});

describe('treemakerPackingCircles', () => {
  const edges = [edge([1, 3], 2), edge([2, 3], 4)];
  const paper = { width: 1, height: 1, scale: 0.1 };

  it('emits one circle per leaf, flipped into the FOLD export’s space', () => {
    const nodes = [leaf(1, 0.2, 0.3), leaf(2, 0.8, 0.6), branch(3, 0.5, 0.5)];

    // to_fold_document writes [x, paper_height - y], so the circles follow.
    expect(treemakerPackingCircles(nodes, edges, paper)).toEqual([
      { cx: 0.2, cy: 0.7, r: 0.2 },
      { cx: 0.8, cy: 0.4, r: 0.4 },
    ]);
  });

  it('ignores branch nodes — only leaves get a circle', () => {
    const nodes = [branch(3, 0.5, 0.5)];
    expect(treemakerPackingCircles(nodes, edges, paper)).toEqual([]);
  });

  it('flips against the actual paper height, not against 1', () => {
    const tall = { width: 1, height: 4, scale: 0.1 };
    expect(treemakerPackingCircles([leaf(1, 0.2, 3)], edges, tall)[0].cy).toBe(1);
  });

  it('drops a leaf whose circle would have no radius', () => {
    expect(treemakerPackingCircles([leaf(9, 0.5, 0.5)], edges, paper)).toEqual([]);
  });

  it('bounds the FOLD by the paper, which its border creases span', () => {
    expect(treemakerFoldBounds({ width: 2, height: 3 })).toEqual([0, 0, 2, 3]);
  });
});

describe('isCircularBpFlap', () => {
  it('is true only with no width and no height', () => {
    expect(isCircularBpFlap({ width: 0, height: 0 })).toBe(true);
    expect(isCircularBpFlap({ width: 2, height: 0 })).toBe(false);
    expect(isCircularBpFlap({ width: 0, height: 2 })).toBe(false);
    expect(isCircularBpFlap({ width: 2, height: 3 })).toBe(false);
  });
});

describe('boxPleatPackingCircles', () => {
  const sheet = bpSheet('rectangular', 16);

  it('emits a circle at the anchor, flipped into the .cp export’s space', () => {
    expect(boxPleatPackingCircles([bpFlap(8, 7, 1)], sheet)).toEqual([
      { cx: 8, cy: 9, r: 1 },
    ]);
  });

  it('skips flaps that are not circles', () => {
    // A rounded rectangle has no representation in the Edit document, and the
    // four corner discs that would carry it exactly read as four flaps in
    // conflict. Nothing is emitted rather than something misleading.
    const flaps = [bpFlap(2, 2, 1, 3, 0), bpFlap(4, 4, 1, 0, 3), bpFlap(6, 6, 1, 2, 2)];
    expect(boxPleatPackingCircles(flaps, sheet)).toEqual([]);
  });

  it('emits circles only for the circular flaps in a mixed layout', () => {
    const flaps = [bpFlap(8, 7, 1), bpFlap(2, 2, 1, 3, 3), bpFlap(4, 12, 2)];
    expect(boxPleatPackingCircles(flaps, sheet)).toEqual([
      { cx: 8, cy: 9, r: 1 },
      { cx: 4, cy: 4, r: 2 },
    ]);
  });

  it('skips a flap with no radius', () => {
    expect(boxPleatPackingCircles([bpFlap(8, 8, 0)], sheet)).toEqual([]);
  });

  it('bounds a rectangular sheet by the sheet itself', () => {
    expect(boxPleatCpBounds(bpSheet('rectangular', 16, 12))).toEqual([0, 0, 16, 12]);
  });

  /**
   * A diagonal sheet is a diamond in a render box one cell wider than an odd
   * size, shifted half a cell. Working in that frame is what keeps this from
   * restating `DiagonalGrid::transform_matrix`; these pin that the frame is the
   * space the `.cp` bounds and the circles agree on.
   */
  describe('on a diagonal sheet', () => {
    it('shifts an odd size by half a cell and bounds by the render box', () => {
      const diagonal = bpSheet('diagonal', 5);
      expect(boxPleatCpBounds(diagonal)).toEqual([0, 0, 6, 6]);
      expect(boxPleatPackingCircles([bpFlap(2, 3, 1)], diagonal)).toEqual([
        { cx: 2.5, cy: 2.5, r: 1 },
      ]);
    });

    it('has no shift on an even size', () => {
      const diagonal = bpSheet('diagonal', 6);
      expect(boxPleatCpBounds(diagonal)).toEqual([0, 0, 6, 6]);
      expect(boxPleatPackingCircles([bpFlap(2, 3, 1)], diagonal)).toEqual([
        { cx: 2, cy: 3, r: 1 },
      ]);
    });
  });

  /**
   * The centre of the sheet must land at the centre of the bounds, on both axes
   * and both sheet kinds — that is the whole claim the kernel's uniform
   * min-corner-to-min-corner mapping rests on.
   */
  it.each([
    // Sheet, and where its centre sits in grid coordinates. The diagonal
    // diamond of odd size 5 has corners at (2.5,-0.5) (5.5,2.5) (2.5,5.5)
    // (-0.5,2.5), so its centre is 2.5 — the half-cell shift, not 3.
    { name: 'a square sheet', sheet: bpSheet('rectangular', 16), centre: { x: 8, y: 8 } },
    { name: 'an oblong sheet', sheet: bpSheet('rectangular', 16, 12), centre: { x: 8, y: 6 } },
    { name: 'an odd diagonal sheet', sheet: bpSheet('diagonal', 5), centre: { x: 2.5, y: 2.5 } },
    { name: 'an even diagonal sheet', sheet: bpSheet('diagonal', 8), centre: { x: 4, y: 4 } },
  ])('puts a centred flap at the centre of the bounds on $name', ({ sheet: under, centre }) => {
    const [minX, minY, maxX, maxY] = boxPleatCpBounds(under);
    const [circle] = boxPleatPackingCircles([bpFlap(centre.x, centre.y, 1)], under);

    expect(circle.cx).toBeCloseTo((minX + maxX) / 2, 12);
    expect(circle.cy).toBeCloseTo((minY + maxY) / 2, 12);
  });
});
