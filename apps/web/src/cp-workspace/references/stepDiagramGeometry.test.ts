import { describe, expect, it } from 'vitest';
import { DIAGRAM_LINE_INK, DIAGRAM_MARK_INK } from './diagram/diagramInk';
import {
  ARROWHEAD_ASPECT,
  DIAGRAM_CARD_DASH_SCALE,
  arcEndDirection,
  arcEndPoint,
  arcExtent,
  arcStartDirection,
  arrowheadBase,
  arcPathData,
  arrowheadPoints,
  arrowheadSize,
  createDiagramProjector,
  createOverlayProjector,
  dashRulerAlong,
  dashZeroOf,
  erodeCreaseOnSheet,
  foldAndUnfoldArrow,
  foldAndUnfoldFromArc,
  arcPolyline,
  arcSamplePoints,
  arcThroughPoints,
  foldArrowArc,
  foldArrowLanding,
  foldArrowTrim,
  onSheetBoundary,
  sheetCorners,
  withPens,
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

  // The pen's runs are measured against creases on the canvas and against the
  // paper on a card, where a valley's `12.8` is an eighth of the sheet: five
  // repeats across a thumbnail read as a few strokes, not as a dashed line.
  it('shortens a card’s dashes, and only a card’s', () => {
    expect(createDiagramProjector(UNIT, 100).dashScale).toBe(DIAGRAM_CARD_DASH_SCALE);
    expect(DIAGRAM_CARD_DASH_SCALE).toBe(0.5);
    const view = { origin: [0, 0] as const, ex: [1, 0] as const, ey: [0, -1] as const };
    expect(createOverlayProjector(view, 1).dashScale).toBe(1);
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

describe('foldArrowLanding', () => {
  const rim = DIAGRAM_MARK_INK.radius * CARD.ink;

  // A point folded onto a point: the far end of the arc is another mark, and a
  // stroke drawn to its centre crosses the ring and turns round inside it.
  it('stops an arc one rim short of the mark it lands on', () => {
    const p: [number, number] = [0.2, 0.2];
    const q: [number, number] = [0.8, 0.6];
    const out = foldArrowArc(p, q, CENTRE);
    if (!out) throw new Error('no arc');
    const landed = foldArrowLanding(out, [CARD(p), CARD(q)], rim, CARD);
    const end = CARD(arcEndPoint(landed));
    const mark = CARD(q);
    // Trimmed along the arc, whose chord is a hair shorter than the arc.
    expect(Math.hypot(end.x - mark.x, end.y - mark.y)).toBeCloseTo(rim, 2);
    // Shorter by exactly that much, from the same start, on the same circle.
    expect(landed.radius * arcExtent(landed)).toBeCloseTo(
      out.radius * arcExtent(out) - rim / CARD.scale,
      9
    );
    expect(landed.from).toBe(out.from);
    expect(landed.center).toEqual(out.center);
  });

  // A point folded onto a line lands on nothing marked, and the arc ends where
  // it ends — the two strokes meet on the line.
  it('leaves an arc that lands on a line alone', () => {
    const p: [number, number] = [0.25, 0.8];
    const onLine: [number, number] = [0.8, 0.2];
    const out = foldArrowArc(p, onLine, CENTRE);
    if (!out) throw new Error('no arc');
    expect(foldArrowLanding(out, [CARD(p)], rim, CARD)).toBe(out);
  });

  it('counts a mark within the rim as landed on, and one beyond it as not', () => {
    const p: [number, number] = [0.2, 0.2];
    const q: [number, number] = [0.8, 0.6];
    const out = foldArrowArc(p, q, CENTRE);
    if (!out) throw new Error('no arc');
    const nudge = (by: number): [number, number] => [q[0] + by / CARD.scale, q[1]];
    expect(foldArrowLanding(out, [CARD(nudge(rim * 0.9))], rim, CARD)).not.toBe(out);
    expect(foldArrowLanding(out, [CARD(nudge(rim * 1.1))], rim, CARD)).toBe(out);
  });

  // The start gives up a rim too; an arc with no room for both would turn
  // inside out rather than shorten.
  it('leaves an arc too short to trim at both ends', () => {
    const p: [number, number] = [0.5, 0.5];
    const q: [number, number] = [0.5 + rim / CARD.scale, 0.5];
    const out = foldArrowArc(p, q, CENTRE);
    if (!out) throw new Error('no arc');
    expect(foldArrowLanding(out, [CARD(q)], rim, CARD)).toBe(out);
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

  // markhor step 41: a crease 0.02 long, whose start measured from the origin
  // fell inside a gap of the pattern — a fold the reader could not see. On a
  // ruler that starts where the crease starts it opens with a dash, and the
  // pieces after it carry the pattern on from there.
  it('starts the pattern where the crease begins when told where that is', () => {
    const pieces: (readonly [{ x: number; y: number }, { x: number; y: number }])[] = [
      [
        { x: 0.552, y: 0.979 },
        { x: 0.537, y: 0.963 },
      ],
      [
        { x: 0.687, y: 1.123 },
        { x: 0.762, y: 1.203 },
      ],
    ];
    const zero = dashZeroOf(pieces);
    expect(zero).toEqual({ x: 0.537, y: 0.963 });
    const first = dashRulerAlong(0.552, 0.979, 0.537, 0.963, zero);
    expect(first.phase).toBeCloseTo(0, 9);
    // The next piece's phase is its distance along the line from that start.
    const next = dashRulerAlong(0.687, 1.123, 0.762, 1.203, zero);
    expect(next.phase).toBeCloseTo(Math.hypot(0.687 - 0.537, 1.123 - 0.963), 6);
    // Without a zero the ruler is the origin's, as before.
    expect(dashRulerAlong(0.552, 0.979, 0.537, 0.963).phase).not.toBeCloseTo(0, 3);
    expect(dashZeroOf([])).toBeUndefined();
  });
});

describe('erodeCreaseOnSheet', () => {
  // D8, on a step's sheet: an end on the paper's edge retreats by the share of
  // the longer side, an end inside stays, a crease the pull would invert is
  // dropped. Sheet units, before projection.
  it('pulls an end on the edge in and leaves one inside alone', () => {
    expect(erodeCreaseOnSheet([0, 0.5], [1, 0.5], UNIT, 0.1)).toEqual([
      [0.1, 0.5],
      [0.9, 0.5],
    ]);
    expect(erodeCreaseOnSheet([0, 0.5], [0.6, 0.5], UNIT, 0.1)).toEqual([
      [0.1, 0.5],
      [0.6, 0.5],
    ]);
    expect(erodeCreaseOnSheet([0.2, 0.2], [0.7, 0.7], UNIT, 0.1)).toEqual([
      [0.2, 0.2],
      [0.7, 0.7],
    ]);
  });

  it('measures the share against the longer side, and finds the edge round the centre', () => {
    // A 2 × 1 sheet: 0.1 of it is 0.2.
    const wide = { width: 2, height: 1 };
    expect(erodeCreaseOnSheet([0, 0.5], [2, 0.5], wide, 0.1)).toEqual([
      [0.2, 0.5],
      [1.8, 0.5],
    ]);
    // On the canvas the paper sits where the document put it.
    const placed = { width: 2, height: 1, centre: [10, 10] as const };
    expect(erodeCreaseOnSheet([9, 10], [11, 10], placed, 0.1)).toEqual([
      [9.2, 10],
      [10.8, 10],
    ]);
    // A point on the edge's line but off the paper is not on its edge.
    expect(erodeCreaseOnSheet([-1, 0.5], [0.5, 0.5], UNIT, 0.1)).toEqual([
      [-1, 0.5],
      [0.5, 0.5],
    ]);
  });

  it('finds the edge of a turned sheet along its own axes', () => {
    // A square of side 2 turned 45° about (10, 10): its corners are 2/√2 out
    // along the diagonals, and its edges run along (1, 1)/√2 and (−1, 1)/√2.
    // A book fold from one edge's middle to the opposite one runs along the
    // y axis of the space from (10, 9) to (10, 11) — strictly inside the
    // upright 2 × 2 box, and on the paper's edge at both ends.
    const r = Math.SQRT1_2;
    const turned = {
      width: 2,
      height: 2,
      centre: [10, 10] as const,
      axes: { x: [r, r] as const, y: [-r, r] as const },
    };
    const fold = erodeCreaseOnSheet([10, 10 - 2 * r], [10, 10 + 2 * r], turned, 0.1)!;
    expect(fold[0].map((v) => Number(v.toFixed(6)))).toEqual([10, Number((10 - 2 * r + 0.2).toFixed(6))]);
    expect(fold[1].map((v) => Number(v.toFixed(6)))).toEqual([10, Number((10 + 2 * r - 0.2).toFixed(6))]);
    // An end on the upright box's edge is inside the turned paper and stays.
    expect(erodeCreaseOnSheet([11, 10], [10, 10], turned, 0.1)).toEqual([
      [11, 10],
      [10, 10],
    ]);
    // A corner is on the edge; the middle is not.
    expect(erodeCreaseOnSheet([10 + 2 * r, 10], [10, 10], turned, 0.1)!.map((p) => p.map((v) => Number(v.toFixed(6))))).toEqual([
      [Number((10 + 2 * r - 0.2).toFixed(6)), 10],
      [10, 10],
    ]);
  });

  it('drops a crease the pull would invert, and is the identity at zero', () => {
    expect(erodeCreaseOnSheet([0, 0.5], [1, 0.5], UNIT, 0.5)).toBeNull();
    expect(erodeCreaseOnSheet([0, 0.5], [1, 0.5], UNIT, 0)).toEqual([
      [0, 0.5],
      [1, 0.5],
    ]);
  });
});

describe('the sheet’s edge', () => {
  const r = Math.SQRT1_2;
  const turned = {
    width: 2,
    height: 2,
    centre: [10, 10] as const,
    axes: { x: [r, r] as const, y: [-r, r] as const },
  };
  const round = (p: readonly number[]) => p.map((v) => Number(v.toFixed(6)));

  it('is the rule erode reads an endpoint by', () => {
    expect(onSheetBoundary([0, 0.5], UNIT)).toBe(true);
    expect(onSheetBoundary([0.5, 1], UNIT)).toBe(true);
    expect(onSheetBoundary([0.5, 0.5], UNIT)).toBe(false);
    // On the edge's line but off the paper: not on its edge.
    expect(onSheetBoundary([-1, 0.5], UNIT)).toBe(false);
    // Found round the centre, along the paper's own axes.
    expect(onSheetBoundary([10, 10 - 2 * r], turned)).toBe(true);
    expect(onSheetBoundary([11, 10], turned)).toBe(false);
    expect(onSheetBoundary([0.5, 0.5], { width: 0, height: 0 })).toBe(false);
  });

  it('runs through the four corners, which are all on it', () => {
    expect(sheetCorners(UNIT)).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    expect(sheetCorners({ width: 2, height: 1, centre: [10, 10] })).toEqual([
      [9, 9.5],
      [11, 9.5],
      [11, 10.5],
      [9, 10.5],
    ]);
    const corners = sheetCorners(turned);
    expect(corners.map(round)).toEqual([
      round([10, 10 - 2 * r]),
      round([10 + 2 * r, 10]),
      round([10, 10 + 2 * r]),
      round([10 - 2 * r, 10]),
    ]);
    for (const corner of corners) expect(onSheetBoundary(corner, turned)).toBe(true);
  });
});

describe('arcPolyline', () => {
  it('runs from the start to the end in the direction of travel, on the circle', () => {
    const arc: DiagramArc = { center: [0, 0], radius: 2, from: 0, to: Math.PI / 2, ccw: true };
    const points = arcPolyline(arc);
    expect(points.length).toBeGreaterThanOrEqual(3);
    expect(points[0]!.map((v) => Number(v.toFixed(9)))).toEqual([2, 0]);
    expect(points[points.length - 1]!.map((v) => Number(v.toFixed(9)))).toEqual([0, 2]);
    for (const [x, y] of points) expect(Math.hypot(x, y)).toBeCloseTo(2, 9);
    // The same ends the other way round go the long way, clockwise.
    const long = arcPolyline({ ...arc, ccw: false });
    expect(long.length).toBeGreaterThan(points.length);
    expect(long[Math.floor(long.length / 2)]![0]).toBeLessThan(0);
  });

  it('spaces its vertices under a pen: a chord of 5° at most', () => {
    const arc: DiagramArc = { center: [0, 0], radius: 1, from: 0, to: Math.PI, ccw: true };
    const points = arcPolyline(arc);
    expect(points.length).toBe(37);
    for (let i = 1; i < points.length; i += 1) {
      const [ax, ay] = points[i - 1]!;
      const [bx, by] = points[i]!;
      expect(Math.hypot(bx - ax, by - ay)).toBeLessThanOrEqual(2 * Math.sin(Math.PI / 72) + 1e-9);
    }
  });
});

describe('withPens', () => {
  it('is the same projection with the pens swapped', () => {
    const pens = { ...DIAGRAM_LINE_INK, arrow: { ...DIAGRAM_LINE_INK.arrow, width: 9 } };
    const copy = withPens(CARD, pens);
    expect(copy([0.25, 0.75])).toEqual(CARD([0.25, 0.75]));
    expect(copy.pens).toBe(pens);
    expect(CARD.pens).toBe(DIAGRAM_LINE_INK);
    for (const key of ['scale', 'ex', 'ey', 'ink', 'dashScale', 'viewBox', 'size', 'mirrored'] as const) {
      expect(copy[key]).toEqual(CARD[key]);
    }
  });
});
