import { describe, expect, it } from 'vitest';
import { DIAGRAM_MARK_INK } from './diagram/diagramInk';
import {
  ARROWHEAD_ASPECT,
  arcEndDirection,
  arcExtent,
  arcStartDirection,
  arrowheadBase,
  arcPathData,
  arrowheadPoints,
  arrowheadSize,
  createDiagramProjector,
  dashRulerAlong,
  foldAndUnfoldArrow,
  foldAndUnfoldFromArc,
  arcSamplePoints,
  arcThroughPoints,
  foldArrowArc,
  foldArrowTrim,
  labelPlacement,
  type DiagramArc,
} from './stepDiagramGeometry';

const UNIT = { width: 1, height: 1 };
const CENTRE: readonly [number, number] = [0.5, 0.5];
/** A card's own projector, for the things that need one. */
const CARD = createDiagramProjector(UNIT, 100);

/** Pull the numbers back out of a path string. */
function numbers(path: string): number[] {
  return path
    .split(/[\sA-Za-z]+/)
    .filter((token) => token !== '')
    .map(Number);
}

describe('createDiagramProjector', () => {
  it('flips y so the sheet bottom lands at the bottom of the picture', () => {
    const project = createDiagramProjector(UNIT, 100);
    expect(project([0, 0])).toEqual({ x: 10, y: 90 });
    expect(project([1, 1])).toEqual({ x: 90, y: 10 });
    expect(project([0.5, 0])).toEqual({ x: 50, y: 90 });
    expect(project.scale).toBe(80);
    expect(project.viewBox).toBe('0 0 100 100');
  });

  it('centres a rectangle along its shorter side', () => {
    const project = createDiagramProjector({ width: 1, height: 0.5 }, 100);
    // Longer side spans the 80 units; the short side is centred in them.
    expect(project([0, 0])).toEqual({ x: 10, y: 70 });
    expect(project([1, 0.5])).toEqual({ x: 90, y: 30 });
  });
});

describe('arcExtent', () => {
  it('measures along the direction of travel', () => {
    const quarter = { center: [0, 0] as const, radius: 1, from: 0, to: Math.PI / 2 };
    expect(arcExtent({ ...quarter, ccw: true })).toBeCloseTo(Math.PI / 2);
    expect(arcExtent({ ...quarter, ccw: false })).toBeCloseTo((3 * Math.PI) / 2);
  });

  it('wraps a negative sweep', () => {
    expect(arcExtent({ center: [0, 0], radius: 1, from: 2.6, to: -2.6, ccw: false })).toBeCloseTo(
      5.2
    );
  });
});

describe('arcPathData', () => {
  const project = createDiagramProjector(UNIT, 100);

  it('takes sweep 0 for a counter-clockwise arc, because the projection flips y', () => {
    const path = arcPathData(
      { center: [0.5, 0.5], radius: 0.5, from: 0, to: Math.PI / 2, ccw: true },
      project
    );
    const [x0, y0, rx, ry, rotation, large, sweep, x1, y1] = numbers(path);
    expect([x0, y0]).toEqual([90, 50]);
    expect([x1, y1]).toEqual([50, 10]);
    expect([rx, ry, rotation]).toEqual([40, 40, 0]);
    expect(large).toBe(0);
    expect(sweep).toBe(0);
  });

  it('marks the long way round with the large-arc flag', () => {
    const path = arcPathData(
      { center: [0.5, 0.5], radius: 0.5, from: 0, to: Math.PI / 2, ccw: false },
      project
    );
    const [, , , , , large, sweep] = numbers(path);
    expect(large).toBe(1);
    expect(sweep).toBe(1);
  });
});

describe('arcEndDirection', () => {
  it('points along the travel direction at the end, in screen space', () => {
    // Counter-clockwise from 0 to π/2 ends at the top of the circle travelling
    // toward −x; the screen tangent is leftward with no vertical component.
    const ccw = arcEndDirection(
      { center: [0, 0], radius: 1, from: 0, to: Math.PI / 2, ccw: true },
      CARD
    );
    expect(ccw.x).toBeCloseTo(-1);
    expect(ccw.y).toBeCloseTo(0);
    // Clockwise from π/2 down to 0 ends at the right, travelling toward −y in
    // sheet space, which is +y (down) on screen.
    const cw = arcEndDirection(
      { center: [0, 0], radius: 1, from: Math.PI / 2, to: 0, ccw: false },
      CARD
    );
    expect(cw.x).toBeCloseTo(0);
    expect(cw.y).toBeCloseTo(1);
  });
});

describe('arrowheadPoints', () => {
  it('puts the tip first and the base behind it, symmetric about the direction', () => {
    const points = arrowheadPoints({ x: 10, y: 10 }, { x: 1, y: 0 }, 6);
    expect(points).toBe('10,10 4,12.4 4,7.6');
  });

  it('normalises the direction', () => {
    expect(arrowheadPoints({ x: 0, y: 0 }, { x: 0, y: 3 }, 6)).toBe('0,0 -2.4,-6 2.4,-6');
  });

  // `images/arrow_head.svg` is 5.7005 long on a half-base of 2.2805 — exactly
  // 2.5 : 1. Drawn at 3 : 1 it reads as a dart rather than an arrowhead.
  it('is the reference head, 2.5 to 1', () => {
    const size = 10;
    const points = arrowheadPoints({ x: 0, y: 0 }, { x: 1, y: 0 }, size)
      .split(' ')
      .map((p) => p.split(',').map(Number));
    const [tip, left, right] = points;
    const half = Math.abs(left[1] - right[1]) / 2;
    expect(Math.abs(tip[0] - left[0]) / half).toBeCloseTo(ARROWHEAD_ASPECT, 12);
    expect(ARROWHEAD_ASPECT).toBeCloseTo(5.7005 / 2.2805, 3);
  });

  // A stroke that stops at the base meets a perpendicular edge; one that runs
  // to the tip crosses the head and reads skewed.
  it('reports a base the stroke can stop at, square to the direction', () => {
    const tip = { x: 10, y: 4 };
    const dir = { x: 3, y: 4 };
    const base = arrowheadBase(tip, dir, 5);
    expect(Math.hypot(tip.x - base.x, tip.y - base.y)).toBeCloseTo(5, 12);
    // Base → tip is parallel to the direction, so the base edge is square to it.
    const along = (tip.x - base.x) * dir.y - (tip.y - base.y) * dir.x;
    expect(along).toBeCloseTo(0, 12);
  });
});

describe('labelPlacement', () => {
  const project = createDiagramProjector(UNIT, 100);

  it('pushes a label away from the sheet centre and anchors toward it', () => {
    const bottomLeft = labelPlacement([0, 0], UNIT, project);
    expect(bottomLeft.anchor).toBe('end');
    expect(bottomLeft.dx).toBeCloseTo(-3.5);
    expect(bottomLeft.dy).toBeCloseTo(5.6);
    const topRight = labelPlacement([1, 1], UNIT, project);
    expect(topRight.anchor).toBe('start');
    expect(topRight.dx).toBeCloseTo(3.5);
    expect(topRight.dy).toBeCloseTo(-2.8);
  });

  it('centres a label on the vertical midline', () => {
    const placement = labelPlacement([0.5, 0.2], UNIT, project);
    expect(placement.anchor).toBe('middle');
    expect(placement.dx).toBe(0);
  });
});

describe('foldArrowArc', () => {

  const on = (arc: DiagramArc, angle: number) => [
    arc.center[0] + arc.radius * Math.cos(angle),
    arc.center[1] + arc.radius * Math.sin(angle),
  ];

  it('passes through both points and subtends 60°, as CalcArrow builds it', () => {
    const arc = foldArrowArc([0, 1], [1, 1], CENTRE);
    expect(arc).not.toBeNull();
    if (!arc) return;
    expect(on(arc, arc.from)[0]).toBeCloseTo(0, 9);
    expect(on(arc, arc.from)[1]).toBeCloseTo(1, 9);
    expect(on(arc, arc.to)[0]).toBeCloseTo(1, 9);
    expect(on(arc, arc.to)[1]).toBeCloseTo(1, 9);
    // 2 * ha, with ha = 30° — upstream's fixed arc half-angle.
    expect(arcExtent(arc)).toBeCloseTo(Math.PI / 3, 9);
  });

  /**
   * "We'll want the bulge of the arc to always be toward the inside of the
   * square … so we pick the value of the center that's farther away"
   * (refDgmr.cpp:37-44).
   */
  it('puts the centre on the far side of the chord from the sheet middle', () => {
    const middle = [0.5, 0.5];
    for (const [from, to] of [
      [
        [0, 1],
        [1, 1],
      ],
      [
        [0, 0],
        [0, 1],
      ],
      [
        [1, 0],
        [0, 0.5],
      ],
    ] as const) {
      const arc = foldArrowArc(from, to, CENTRE);
      expect(arc).not.toBeNull();
      if (!arc) continue;
      const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      const toCentre = [arc.center[0] - mid[0], arc.center[1] - mid[1]];
      const toMiddle = [middle[0] - mid[0], middle[1] - mid[1]];
      // Opposite sides of the chord: the arc bulges toward the sheet's middle.
      expect(toCentre[0] * toMiddle[0] + toCentre[1] * toMiddle[1]).toBeLessThanOrEqual(1e-9);
    }
  });

  it('draws nothing for a fold that moves a point onto itself', () => {
    expect(foldArrowArc([0.25, 0.25], [0.25, 0.25], CENTRE)).toBeNull();
  });
});

describe('arrowheadSize', () => {
  // From the pen, not from the paper: the same picture is drawn over a camera,
  // where a share of the paper is a head that grows to eighty pixels on a fit
  // view and keeps growing as you zoom.
  it('is a fixed number of the drawing’s own units for a long arrow', () => {
    const arc = foldArrowArc([0, 0], [1, 1], CENTRE);
    if (!arc) throw new Error('no arc');
    expect(arrowheadSize(arc, CARD)).toBeCloseTo(10.56 * CARD.ink, 9);
    // …and the card's ink is a share of its paper, so this reproduces exactly
    // what a share of the paper used to give: 0.11 of the sheet.
    expect(arrowheadSize(arc, CARD)).toBeCloseTo(0.11 * CARD.scale, 9);
  });

  // The reason a small arc does not end up mostly arrowhead. The cap is a share
  // of the chord because it is about that arrow, not about the pen.
  it('caps at a share of the chord for a short one', () => {
    const arc = foldArrowArc([0.5, 0.5], [0.6, 0.5], CENTRE);
    if (!arc) throw new Error('no arc');
    expect(arrowheadSize(arc, CARD)).toBeCloseTo(0.26 * 0.1 * CARD.scale, 9);
  });
});

describe('a mirrored projector', () => {
  const sheet = { width: 1, height: 1 };

  it('reflects x about the sheet and leaves y alone', () => {
    const front = createDiagramProjector(sheet, 100);
    const back = createDiagramProjector(sheet, 100, true);
    // The sheet's corners swap sides; a point's height does not move.
    expect(back([0, 0.25])).toEqual(front([1, 0.25]));
    expect(back([1, 0.25])).toEqual(front([0, 0.25]));
    expect(back([0.5, 0.9])).toEqual(front([0.5, 0.9]));
    expect(back.viewBox).toBe(front.viewBox);
    expect(back.scale).toBe(front.scale);
  });

  // A reflection reverses handedness, so an arc drawn with the same sweep flag
  // would bow the wrong way — the arrow would say "fold the other direction".
  it('flips the arc sweep flag, not just the endpoints', () => {
    const arc = {
      center: [0.5, 0.5] as const,
      radius: 0.25,
      from: 0,
      to: Math.PI / 2,
      ccw: true,
    };
    const front = arcPathData(arc, createDiagramProjector(sheet, 100));
    const back = arcPathData(arc, createDiagramProjector(sheet, 100, true));
    const sweepOf = (d: string) => d.split(' ').at(-3);
    expect(sweepOf(front)).not.toBe(sweepOf(back));
  });

  // The offset is applied in SVG units, so reading the side off the SHEET puts
  // every back-side label inside the drawing and leaves the margin empty.
  it('pushes a label into the margin it is actually next to', () => {
    const back = createDiagramProjector(sheet, 100, true);
    // A mark on the sheet's left edge is drawn at the picture's RIGHT edge.
    expect(back([0, 0.5]).x).toBeGreaterThan(back([0.5, 0.5]).x);
    const placed = labelPlacement([0, 0.5], sheet, back);
    expect(placed.anchor).toBe('start');
    expect(placed.dx).toBeGreaterThan(0);
    // Unmirrored, the same mark goes the other way.
    const front = createDiagramProjector(sheet, 100);
    expect(labelPlacement([0, 0.5], sheet, front).anchor).toBe('end');
  });

  it('turns the arrowhead round with the picture', () => {
    const arc = {
      center: [0.5, 0.5] as const,
      radius: 0.25,
      from: 0,
      to: Math.PI / 2,
      ccw: true,
    };
    const back = createDiagramProjector(UNIT, 100, true);
    expect(arcEndDirection(arc, back).x).toBeCloseTo(-arcEndDirection(arc, CARD).x, 12);
    expect(arcEndDirection(arc, back).y).toBeCloseTo(arcEndDirection(arc, CARD).y, 12);
    expect(arcStartDirection(arc, back).x).toBeCloseTo(-arcStartDirection(arc, CARD).x, 12);
  });
});

describe('foldArrowTrim', () => {
  const at = (arc: DiagramArc, angle: number): [number, number] => [
    arc.center[0] + arc.radius * Math.cos(angle),
    arc.center[1] + arc.radius * Math.sin(angle),
  ];

  // Two rules, and both were wrong in turn. A shaft that begins inside the ring
  // hides the mark under its own line; a head that carries on round the circle
  // ends up past the mark and across the shaft that starts there, which reads
  // as a tangle rather than a journey.
  it('starts the shaft on the ring and leaves the head beside the mark', () => {
    const out = foldArrowArc([1, 0.5], [0, 0.5], CENTRE);
    if (!out) throw new Error('no arc');
    const head = arrowheadSize(out, CARD) / CARD.scale;
    const arrow = foldAndUnfoldFromArc(out, head);
    if (!arrow) throw new Error('no arrow');
    const rim = (DIAGRAM_MARK_INK.radius * CARD.ink) / CARD.scale;
    const trimmed = foldArrowTrim(arrow, head, rim);

    const mark = at(arrow.out, arrow.out.from);
    const image = at(arrow.out, arrow.out.to);
    const start = at(trimmed.out, trimmed.out.from);
    const tip = at(arrow.back, trimmed.tip);

    // On the rim, not at the centre.
    expect(Math.hypot(start[0] - mark[0], start[1] - mark[1])).toBeCloseTo(rim, 3);

    // Beside the mark: the head is offset across the fold's travel, and level
    // with the mark along it rather than beyond it.
    const span = Math.hypot(image[0] - mark[0], image[1] - mark[1]);
    const along = [(image[0] - mark[0]) / span, (image[1] - mark[1]) / span];
    const off = [tip[0] - mark[0], tip[1] - mark[1]];
    const beyond = off[0] * along[0] + off[1] * along[1];
    const aside = Math.abs(off[0] * along[1] - off[1] * along[0]);
    expect(aside).toBeGreaterThan(Math.abs(beyond) * 4);
    expect(aside).toBeCloseTo(head, 3);
  });

  // "Back" should read as the same journey returned, not a longer one.
  it('comes back about as far as it went', () => {
    for (const [from, to] of [
      [[1, 0.5], [0, 0.5]],
      [[0.5, 0.08], [0.5, 0.52]],
      [[1, 0], [0, 1]],
    ] as const) {
      const arrow = foldAndUnfoldArrow(from, to, CENTRE, 0.05);
      if (!arrow) throw new Error('no arrow');
      const length = (arc: DiagramArc) => arc.radius * arcExtent(arc);
      const ratio = length(arrow.back) / length(arrow.out);
      expect(ratio).toBeGreaterThan(0.85);
      expect(ratio).toBeLessThan(1.2);
    }
  });
});

describe('an arc across a change of coordinates', () => {
  /** A similarity: scale, rotate, flip — what a real frame map is. */
  const map = (p: readonly [number, number]): [number, number] => {
    const [c, s] = [Math.cos(0.7), Math.sin(0.7)];
    const [x, y] = [p[0] * 37, -p[1] * 37];
    return [x * c - y * s + 11, x * s + y * c - 4];
  };

  // A centre, a radius and two angles are not points, and no point map moves
  // them. Three points on the arc are — and because the map is a similarity, a
  // circle's image is a circle, so the three images determine it exactly.
  it('survives as three points and comes back the same arc', () => {
    for (const arc of [
      foldArrowArc([0, 0], [1, 1], CENTRE),
      foldArrowArc([1, 0.5], [0, 0.5], CENTRE),
      foldArrowArc([0.5, 0.1], [0.5, 0.9], CENTRE),
    ]) {
      if (!arc) throw new Error('no arc');
      const [a, m, b] = arcSamplePoints(arc).map(map) as [
        [number, number],
        [number, number],
        [number, number],
      ];
      const back = arcThroughPoints(a, m, b);
      expect(back).not.toBeNull();
      if (!back) continue;

      // The image circle: centre mapped, radius scaled by the similarity.
      const centre = map(arc.center);
      expect(back.center[0]).toBeCloseTo(centre[0], 6);
      expect(back.center[1]).toBeCloseTo(centre[1], 6);
      expect(back.radius).toBeCloseTo(arc.radius * 37, 6);
      // The same sweep, and the ends in the same order — the direction is what
      // the middle sample is for, and the reflection in the map reverses it.
      expect(arcExtent(back)).toBeCloseTo(arcExtent(arc), 6);
      expect(back.ccw).toBe(!arc.ccw);
    }
  });

  it('refuses three points on a line rather than inventing a circle', () => {
    expect(arcThroughPoints([0, 0], [1, 1], [2, 2])).toBeNull();
    expect(arcThroughPoints([0, 0], [0, 0], [0, 0])).toBeNull();
  });
});

describe('the dash ruler on a line that is only nearly axis-aligned', () => {
  // One crease drawn twice — once from the document, once recovered by
  // interpolating along its own chord — is the case this exists for. The
  // recovered copy carries about 1e-16 of drift, and an exact `dx === 0` test
  // canonicalised it the opposite way: the two dashed copies then landed half a
  // period apart and filled each other's gaps, so the line read solid.
  it('agrees with the exact line about which way it runs', () => {
    const exact = dashRulerAlong(0, 200, 0, 150);
    for (const drift of [1e-16, -1e-16, 1e-13, -1e-13]) {
      const nearly = dashRulerAlong(drift, 200, drift, 150);
      expect(nearly.ay, `drift ${drift}`).toBeCloseTo(exact.ay, 9);
      expect(nearly.by, `drift ${drift}`).toBeCloseTo(exact.by, 9);
      expect(nearly.phase, `drift ${drift}`).toBeCloseTo(exact.phase, 6);
    }
  });

  it('still tells a real slope from vertical', () => {
    // A line a reader could see is not vertical keeps its own direction.
    const sloped = dashRulerAlong(0, 0, -1, 1);
    expect(sloped.ax).toBeCloseTo(-1, 9);
    expect(sloped.ay).toBeCloseTo(1, 9);
  });
});
