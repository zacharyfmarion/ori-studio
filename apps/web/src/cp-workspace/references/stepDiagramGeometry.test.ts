import { describe, expect, it } from 'vitest';
import {
  DIAGRAM_ANGLE_MARK_INK,
  DIAGRAM_ARROWHEAD_INK,
  DIAGRAM_DIVISIONS_INK,
  DIAGRAM_LINE_INK,
  DIAGRAM_MARK_INK,
  DIAGRAM_MARKS,
  DIAGRAM_PLEAT_INK,
  DIAGRAM_RIGHT_ANGLE_INK,
  REFERENCES_VIEW_MARKS,
  type DivisionsPen,
} from './diagram/diagramInk';
import {
  angleMarkArcPoints,
  angleMarkDrawn,
  angleMarkPathData,
  angleMarkShape,
  ARROWHEAD_ASPECT,
  ARROWHEAD_MIN_STROKES,
  ARROWHEAD_NOTCH,
  DIAGRAM_CARD_DASH_SCALE,
  OFF_PAPER_REACH,
  TURN_OVER_HEAD,
  TURN_OVER_HEAD_PATH,
  TURN_OVER_PATH,
  arcArrowhead,
  arcEndDirection,
  arcEndPoint,
  arcExtent,
  arcExtremes,
  arcPieces,
  arcStartDirection,
  arcPathData,
  arrowheadAt,
  arrowheadPath,
  arrowheadReach,
  arrowheadSize,
  createDiagramProjector,
  createOverlayProjector,
  dashRulerAlong,
  dashZeroOf,
  divisionsDrawn,
  divisionsPathData,
  divisionsShape,
  divisionsStrokes,
  DIVISIONS_DIGIT_EMS,
  DIVISIONS_DIGIT_HALF_HEIGHT_EMS,
  erodeCreaseOnSheet,
  foldAndUnfoldArrow,
  foldAndUnfoldFromArc,
  arcPolyline,
  arcSamplePoints,
  arcThroughPoints,
  foldArrowArc,
  foldArrowLanding,
  foldArrowTrim,
  foldReturnOffset,
  halfArrowheadPath,
  oneWayArrow,
  pleatArrowDrawn,
  pleatArrowShape,
  pleatBolt,
  polylineMitres,
  polylinePieces,
  reversedStretches,
  ringPieces,
  strokePieces,
  pushArrowOutline,
  rightAngleDrawn,
  rightAnglePathData,
  rightAngleReach,
  rightAngleShape,
  rotateGlyph,
  strokedOutlinePoints,
  offPaperPathData,
  onSheetBoundary,
  paperRingPoints,
  paperSpan,
  sheetCorners,
  withPens,
  type DiagramArc,
  type SvgPoint,
} from './stepDiagramGeometry';
import { markRingWidth } from './diagram/labelLayout';

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

/** Measures a point against the line through `from` along `direction`: how far along it, and how far across. */
function frame(from: SvgPoint, direction: SvgPoint) {
  const norm = Math.hypot(direction.x, direction.y);
  const u = { x: direction.x / norm, y: direction.y / norm };
  return (p: SvgPoint) => ({
    along: (p.x - from.x) * u.x + (p.y - from.y) * u.y,
    across: (p.y - from.y) * u.x - (p.x - from.x) * u.y,
  });
}

/** The pieces of an arrowhead's path: `M tip L barb Q control barb Z`. */
function headPieces(d: string) {
  const match = /^M (\S+) (\S+) L (\S+) (\S+) Q (\S+) (\S+) (\S+) (\S+) Z$/.exec(d);
  if (!match) throw new Error(`not an arrowhead: ${d}`);
  const n = match.slice(1).map(Number);
  const point = (i: number) => ({ x: n[i]!, y: n[i + 1]! });
  return { tip: point(0), a: point(2), control: point(4), b: point(6) };
}

/** A point on the back's quadratic, from one barb (0) to the other (1). */
function onBack({ a, control, b }: ReturnType<typeof headPieces>, t: number): SvgPoint {
  const s = 1 - t;
  return {
    x: s * s * a.x + 2 * s * t * control.x + t * t * b.x,
    y: s * s * a.y + 2 * s * t * control.y + t * t * b.y,
  };
}

describe('arrowheadAt', () => {
  it('stands the tip a reach in front of the notch, and the barbs either side behind it', () => {
    const head = arrowheadAt({ x: 10, y: 10 }, { x: 1, y: 0 }, 10);
    expect(head.notch).toEqual({ x: 10, y: 10 });
    expect(head.tip.x).toBeCloseTo(10 + 10 * (1 - ARROWHEAD_NOTCH), 12);
    expect(head.tip.y).toBeCloseTo(10, 12);
    const [a, b] = head.barbs;
    // Both on the line through the barbs, a notch's depth behind the notch.
    expect(a.x).toBeCloseTo(10 - 10 * ARROWHEAD_NOTCH, 12);
    expect(b.x).toBeCloseTo(a.x, 12);
    expect(a.y - 10).toBeCloseTo(-(b.y - 10), 12);
    expect(Math.abs(a.y - b.y)).toBeCloseTo((2 * 10) / ARROWHEAD_ASPECT, 12);
  });

  it('normalises the direction', () => {
    const long = arrowheadAt({ x: 0, y: 0 }, { x: 0, y: 3 }, 6);
    const unit = arrowheadAt({ x: 0, y: 0 }, { x: 0, y: 1 }, 6);
    expect(long).toEqual(unit);
    expect(long.tip.y).toBeCloseTo(arrowheadReach(6), 12);
  });

  // A printed diagram's head is slim — a little over half as wide as it is
  // long — with a back that curves in toward the tip. The template's
  // straight-backed 2.5 : 1 triangle read as a blunt wedge beside one, and
  // twice as long as wide (4 : 1) as a little too narrow.
  it('is a little over half as wide as it is long, its back curving in by about a fifth of it', () => {
    expect(ARROWHEAD_ASPECT).toBe(3.4);
    expect(ARROWHEAD_NOTCH).toBeGreaterThanOrEqual(0.18);
    expect(ARROWHEAD_NOTCH).toBeLessThanOrEqual(0.22);
    const length = 10;
    const head = arrowheadAt({ x: 3, y: -2 }, { x: 0.6, y: 0.8 }, length);
    const [a, b] = head.barbs;
    const base = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const width = Math.hypot(a.x - b.x, a.y - b.y);
    expect(Math.hypot(head.tip.x - base.x, head.tip.y - base.y)).toBeCloseTo(length, 12);
    expect(length / width).toBeCloseTo(ARROWHEAD_ASPECT / 2, 12);
    expect(Math.hypot(head.notch.x - base.x, head.notch.y - base.y)).toBeCloseTo(
      ARROWHEAD_NOTCH * length,
      12
    );
  });
});

describe('arrowheadPath', () => {
  const head = arrowheadAt({ x: 20, y: 30 }, { x: 3, y: -4 }, 12);
  const pieces = headPieces(arrowheadPath(head));
  const at = frame(head.notch, { x: 3, y: -4 });

  it('runs tip, barb, back, barb, and closes', () => {
    expect(pieces.tip.x).toBeCloseTo(head.tip.x, 3);
    expect(pieces.tip.y).toBeCloseTo(head.tip.y, 3);
    expect(pieces.a.x).toBeCloseTo(head.barbs[0].x, 3);
    expect(pieces.b.y).toBeCloseTo(head.barbs[1].y, 3);
  });

  // The shaft ends at the notch, so the back's middle has to be exactly there
  // — anywhere else leaves a gap between the stroke and the head, or a lump.
  it('bends its back through the notch, on the axis', () => {
    const middle = onBack(pieces, 0.5);
    expect(middle.x).toBeCloseTo(head.notch.x, 3);
    expect(middle.y).toBeCloseTo(head.notch.y, 3);
    expect(at(head.notch).across).toBeCloseTo(0, 12);
  });

  it('is concave: every point of the back lies between the barbs’ line and the notch', () => {
    const barbs = at(head.barbs[0]).along;
    const tip = at(head.tip).along;
    // The notch is strictly between the barbs' line and the tip.
    expect(barbs).toBeLessThan(0);
    expect(tip).toBeGreaterThan(0);
    for (let t = 0.05; t < 1; t += 0.05) {
      const along = at(onBack(pieces, t)).along;
      expect(along).toBeGreaterThan(barbs + 2e-3);
      expect(along).toBeLessThanOrEqual(2e-3);
    }
  });
});

describe('arcArrowhead', () => {
  // A quarter circle, turning left as it goes: tight enough that the
  // tangent at the end and a reach before it differ by a lot.
  const arc: DiagramArc = { center: [0.5, 0.5], radius: 0.1, from: 0, to: Math.PI / 2, ccw: true };
  const length = 8;
  const head = arcArrowhead(arc, CARD, length);

  it('puts its notch where the stroke ends', () => {
    const end = CARD(arcEndPoint(arc));
    expect(head.notch.x).toBeCloseTo(end.x, 12);
    expect(head.notch.y).toBeCloseTo(end.y, 12);
  });

  // "Centred along the tangent line of the end of the line": the axis is the
  // stroke's own direction where it stops, not the direction some way further
  // round the circle, where the tip happens to land.
  it('lays its axis along the stroke’s direction where it stops', () => {
    const axis = { x: head.tip.x - head.notch.x, y: head.tip.y - head.notch.y };
    const norm = Math.hypot(axis.x, axis.y);
    const tangent = arcEndDirection(arc, CARD);
    expect(axis.x / norm).toBeCloseTo(tangent.x, 12);
    expect(axis.y / norm).toBeCloseTo(tangent.y, 12);
    // …which on a curve is not the direction further on.
    const further = { ...arc, to: arc.to + arrowheadReach(length) / (arc.radius * CARD.scale) };
    const there = arcEndDirection(further, CARD);
    expect(Math.abs(axis.x / norm - there.x) + Math.abs(axis.y / norm - there.y)).toBeGreaterThan(0.1);
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
    expect(arrowheadSize(arc, CARD)).toBeCloseTo(8.5 * CARD.ink, 9);
  });

  // The reason a small arc does not end up mostly arrowhead. The cap is a share
  // of the chord because it is about that arrow, not about the pen.
  it('caps at a share of the chord for a short one', () => {
    const arc = foldArrowArc([0.35, 0.5], [0.65, 0.5], CENTRE);
    if (!arc) throw new Error('no arc');
    const capped = 0.26 * 0.3 * CARD.scale;
    expect(capped).toBeLessThan(8.5 * CARD.ink);
    expect(capped).toBeGreaterThan(ARROWHEAD_MIN_STROKES * stroke(CARD));
    expect(arrowheadSize(arc, CARD)).toBeCloseTo(capped, 9);
  });

  // Capped any shorter, the head is no wider than the stroke it ends, and the
  // stroke's cap shows through its sides — at a heavy pen, even on a long arc.
  it('is never shorter than four of the arrow’s own strokes', () => {
    const tiny = foldArrowArc([0.5, 0.5], [0.52, 0.5], CENTRE);
    if (!tiny) throw new Error('no arc');
    expect(0.26 * 0.02 * CARD.scale).toBeLessThan(ARROWHEAD_MIN_STROKES * stroke(CARD));
    expect(arrowheadSize(tiny, CARD)).toBeCloseTo(ARROWHEAD_MIN_STROKES * stroke(CARD), 9);
    const heavy = withPens(CARD, { ...DIAGRAM_LINE_INK, arrow: { ...DIAGRAM_LINE_INK.arrow, width: 4 } });
    const long = foldArrowArc([0, 0], [1, 1], CENTRE);
    if (!long) throw new Error('no arc');
    expect(arrowheadSize(long, heavy)).toBeCloseTo(ARROWHEAD_MIN_STROKES * 4 * CARD.ink, 9);
    // Its sides then stand clear of the stroke's round cap at the notch.
    const head = arcArrowhead(long, heavy, arrowheadSize(long, heavy));
    const [barb] = head.barbs;
    const side = { x: head.tip.x - barb.x, y: head.tip.y - barb.y };
    const toNotch = { x: head.notch.x - barb.x, y: head.notch.y - barb.y };
    const clearance = Math.abs(side.x * toNotch.y - side.y * toNotch.x) / Math.hypot(side.x, side.y);
    expect(clearance).toBeGreaterThan((4 * CARD.ink) / 2);
  });
});

/** The arrow's stroke width in a projector's own units. */
function stroke(project: typeof CARD): number {
  return project.pens.arrow.width * project.ink;
}

describe('foldReturnOffset', () => {
  // The loop opens by what the head's length was before the head was made
  // smaller: a smaller head is no reason for the two strokes to crowd each
  // other. So this is exactly the old head, cap and all.
  it('is the old head’s length for a long arrow: 0.11 of the sheet on a card', () => {
    const arc = foldArrowArc([0, 0], [1, 1], CENTRE);
    if (!arc) throw new Error('no arc');
    expect(foldReturnOffset(arc, CARD)).toBeCloseTo(10.56 * CARD.ink, 9);
    expect(foldReturnOffset(arc, CARD)).toBeCloseTo(0.11 * CARD.scale, 9);
    expect(foldReturnOffset(arc, CARD)).toBeGreaterThan(arrowheadSize(arc, CARD));
  });

  it('caps at the same share of the chord as the head did', () => {
    const arc = foldArrowArc([0.5, 0.5], [0.6, 0.5], CENTRE);
    if (!arc) throw new Error('no arc');
    expect(foldReturnOffset(arc, CARD)).toBeCloseTo(0.26 * 0.1 * CARD.scale, 9);
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

  /** A fold across the card, its strokes trimmed as the card trims them, in sheet units. */
  function trimmedArrow() {
    const out = foldArrowArc([1, 0.5], [0, 0.5], CENTRE);
    if (!out) throw new Error('no arc');
    const head = arrowheadSize(out, CARD) / CARD.scale;
    const offset = foldReturnOffset(out, CARD) / CARD.scale;
    const arrow = foldAndUnfoldFromArc(out, offset);
    if (!arrow) throw new Error('no arrow');
    const rim = (DIAGRAM_MARK_INK.radius * CARD.ink) / CARD.scale;
    return { arrow, head, offset, rim, trimmed: foldArrowTrim(arrow, head, rim) };
  }

  // Two rules, and both were wrong in turn. A shaft that begins inside the ring
  // hides the mark under its own line; a head that carries on round the circle
  // ends up past the mark and across the shaft that starts there, which reads
  // as a tangle rather than a journey.
  it('starts the shaft on the ring and leaves the head beside the mark', () => {
    const { arrow, head, offset, rim, trimmed } = trimmedArrow();
    const mark = at(arrow.out, arrow.out.from);
    const image = at(arrow.out, arrow.out.to);
    const start = at(trimmed.out, trimmed.out.from);
    const tip = arcArrowhead(trimmed.back, CARD, head * CARD.scale).tip;

    // On the rim, not at the centre.
    expect(Math.hypot(start[0] - mark[0], start[1] - mark[1])).toBeCloseTo(rim, 3);

    // Beside the mark: the head is offset across the fold's travel, and level
    // with the mark along it rather than beyond it — by the return's offset,
    // give or take the hair the tip lands off the circle by.
    const from = CARD(mark);
    const to = CARD(image);
    const toward = frame(from, { x: to.x - from.x, y: to.y - from.y });
    const { along: beyond, across } = toward(tip);
    expect(Math.abs(across)).toBeGreaterThan(Math.abs(beyond) * 4);
    expect(Math.abs(Math.abs(across) - offset * CARD.scale)).toBeLessThan(0.05 * head * CARD.scale);
  });

  // The head sits on the shaft: its notch is where the return now stops, and
  // it reaches from there along the stroke to within a hair of where the
  // return used to end — the arc's bend over the reach, `reach² / 2r`.
  it('stops the return a head’s reach short, so the head’s tip lands where the return ended', () => {
    const { arrow, head, trimmed } = trimmedArrow();
    const length = (arc: DiagramArc) => arc.radius * arcExtent(arc);
    const reach = arrowheadReach(head);
    expect(length(trimmed.back)).toBeCloseTo(length(arrow.back) - reach, 12);
    expect(trimmed.back.from).toBe(arrow.back.from);

    const tip = arcArrowhead(trimmed.back, CARD, head * CARD.scale).tip;
    const ended = CARD(arcEndPoint(arrow.back));
    const radius = arrow.back.radius * CARD.scale;
    const hair = (reach * CARD.scale) ** 2 / (2 * radius);
    expect(Math.hypot(tip.x - ended.x, tip.y - ended.y)).toBeLessThan(hair * 1.05);
    expect(hair).toBeLessThan(0.05 * head * CARD.scale);
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

describe('the turn-over glyph', () => {
  /** The stroke's opening: where it starts, and its first control point. */
  const [x0, y0, x1, y1] = /^M (\S+) (\S+) C (\S+) (\S+) /.exec(TURN_OVER_PATH)!.slice(1).map(Number);

  // The glyph's stroke is the house's, verbatim, except for the stretch the
  // head covers: it stops at the notch as a fold arrow's shaft does.
  it('starts its stroke at the head’s notch, and draws the rest as transcribed', () => {
    expect(x0).toBeCloseTo(TURN_OVER_HEAD.notch.x, 3);
    expect(y0).toBeCloseTo(TURN_OVER_HEAD.notch.y, 3);
    expect(TURN_OVER_PATH).toContain(
      '13.926 1.855 C 8.533 2.887 8.711 7.191 8.711 7.191 C 8.698 9.071 9.698 10.738 11.328 11.674 ' +
        'C 12.958 12.610 14.966 12.596 16.583 11.638 C 18.200 10.679 19.176 8.925 19.138 7.046 ' +
        'C 19.138 7.046 19.318 2.887 13.925 1.855 C 13.925 1.855 5.675 0.094 1.496 5.066'
    );
  });

  // The stroke is written from the head end, so the head points back against
  // its opening direction — the tangent where it now starts, not where it was
  // transcribed to start, twenty degrees round the curve.
  it('lays the head along the stroke where the stroke meets it', () => {
    const axis = frame(TURN_OVER_HEAD.notch, { x: x0 - x1, y: y0 - y1 });
    expect(axis(TURN_OVER_HEAD.tip).across).toBeCloseTo(0, 2);
    expect(axis(TURN_OVER_HEAD.tip).along).toBeCloseTo(arrowheadReach(4.1), 2);
  });

  it('keeps its length, and puts its tip within two thirds of a unit of the transcribed end', () => {
    const [a, b] = TURN_OVER_HEAD.barbs;
    const base = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(Math.hypot(TURN_OVER_HEAD.tip.x - base.x, TURN_OVER_HEAD.tip.y - base.y)).toBeCloseTo(4.1, 9);
    expect(Math.hypot(TURN_OVER_HEAD.tip.x - 25.282, TURN_OVER_HEAD.tip.y - 4.923)).toBeLessThan(2 / 3);
    expect(TURN_OVER_HEAD_PATH).toBe(arrowheadPath(TURN_OVER_HEAD));
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

  // An annotation's end put down off a ring's middle: on the ring, not a rim back from where it was.
  it('stops an arc that ends elsewhere in a ring on its near side', () => {
    const p: [number, number] = [0.2, 0.2];
    const q: [number, number] = [0.8, 0.6];
    const out = foldArrowArc(p, q, CENTRE);
    if (!out) throw new Error('no arc');
    const end = CARD(arcEndPoint(out));
    // The arc's direction where it ends, on the card.
    const before = CARD(arcEndPoint({ ...out, to: out.to - (out.ccw ? 1 : -1) * 0.01 }));
    const length = Math.hypot(end.x - before.x, end.y - before.y);
    const along = { x: (end.x - before.x) / length, y: (end.y - before.y) / length };
    // The mark ahead of the end (0.9 and 0.5 of a rim) and behind it, the end past the middle.
    for (const share of [0.9, 0.5, -0.5]) {
      const mark = { x: end.x + along.x * share * rim, y: end.y + along.y * share * rim };
      const landed = foldArrowLanding(out, [mark], rim, CARD);
      const stop = CARD(arcEndPoint(landed));
      expect(Math.hypot(stop.x - mark.x, stop.y - mark.y)).toBeCloseTo(rim, 4);
      // On the near side: the stroke stops before reaching the mark.
      expect((mark.x - stop.x) * along.x + (mark.y - stop.y) * along.y).toBeGreaterThan(0);
    }
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

describe('paperSpan', () => {
  const square: readonly (readonly [number, number])[] = sheetCorners(UNIT);
  const span = (
    from: readonly [number, number],
    to: readonly [number, number],
    outline: readonly (readonly [number, number])[] = square
  ) => {
    const found = paperSpan(from, to, outline);
    return found && found.map((t) => Number(t.toFixed(9)));
  };

  it('is the whole of a segment on the paper, and none of one off it', () => {
    expect(span([0.2, 0.2], [0.8, 0.6])).toEqual([0, 1]);
    expect(span([1.2, 0.2], [1.5, 0.9])).toBeNull();
    // Beside the paper and parallel to an edge: off it all the way along.
    expect(span([-0.2, 0.1], [-0.2, 0.9])).toBeNull();
  });

  it('is the stretch between where the segment crosses the outline', () => {
    // In from the left, out through the right.
    expect(span([-0.5, 0.5], [1.5, 0.5])).toEqual([0.25, 0.75]);
    // Leaving through one edge only.
    expect(span([0.5, 0.5], [0.5, 2])).toEqual([0, 1 / 3].map((t) => Number(t.toFixed(9))));
    // Through a corner's neighbourhood diagonally.
    expect(span([-1, -1], [2, 2])).toEqual([1 / 3, 2 / 3].map((t) => Number(t.toFixed(9))));
  });

  it('counts a segment along an edge, or just touching a corner from inside, as on the paper', () => {
    expect(span([0, 0.2], [0, 0.8])).toEqual([0, 1]);
    expect(span([0.5, 0.5], [1, 1])).toEqual([0, 1]);
    // Touching the paper at one point is not a stretch of it.
    expect(span([1, 1], [2, 1.5])).toBeNull();
  });

  it('reads the outline wound either way, and turned', () => {
    expect(span([-0.5, 0.5], [1.5, 0.5], [...square].reverse())).toEqual([0.25, 0.75]);
    // A diamond: the unit square turned 45° about its middle.
    const r = Math.SQRT1_2;
    const diamond = [
      [0.5, 0.5 - r],
      [0.5 + r, 0.5],
      [0.5, 0.5 + r],
      [0.5 - r, 0.5],
    ] as const;
    const [t0, t1] = paperSpan([-1, 0.5], [2, 0.5], diamond)!;
    expect(t0).toBeCloseTo((1.5 - r) / 3, 9);
    expect(t1).toBeCloseTo((1.5 + r) / 3, 9);
  });

  it('is none without a paper to lie on', () => {
    expect(span([0, 0], [1, 1], [])).toBeNull();
    expect(span([0, 0], [1, 1], [[0, 0], [1, 1], [2, 2]])).toBeNull();
  });
});

describe('offPaperPathData', () => {
  const ring = [
    { x: 10, y: 10 },
    { x: 90, y: 10 },
    { x: 90, y: 90 },
    { x: 10, y: 90 },
  ];

  it('cuts the paper out of a box that reaches well past it', () => {
    const reach = OFF_PAPER_REACH * 80;
    expect(offPaperPathData([ring])).toBe(
      `M ${10 - reach} ${10 - reach} H ${90 + reach} V ${90 + reach} H ${10 - reach} Z ` +
        'M 10 10 L 90 10 L 90 90 L 10 90 Z'
    );
    expect(paperRingPoints(ring)).toBe('10,10 90,10 90,90 10,90');
  });

  it('cuts every ring, skips an empty one, and is empty with no paper at all', () => {
    const flap = [
      { x: 90, y: 10 },
      { x: 130, y: 10 },
      { x: 130, y: 90 },
    ];
    const path = offPaperPathData([ring, [], flap]);
    expect(path.match(/M /g)).toHaveLength(3);
    // The box spans both rings.
    const reach = OFF_PAPER_REACH * 120;
    expect(path.startsWith(`M ${10 - reach} ${10 - reach} H ${130 + reach} `)).toBe(true);
    expect(offPaperPathData([[], []])).toBe('');
  });
});

describe('a projector’s marks', () => {
  const view = { origin: [0, 0], ex: [400, 0], ey: [0, -400] } as const;
  /** A long arc, whose chord does not cap its head. */
  const arc = { center: [0.5, 0.5], radius: 0.4, from: 0, to: Math.PI / 2, ccw: true } as const;

  it('are the print sizes on a page and a card, and carried by a copy', () => {
    expect(createOverlayProjector(view, 1).marks).toEqual(DIAGRAM_MARKS);
    expect(createDiagramProjector({ width: 1, height: 1 }, 100).marks).toEqual(DIAGRAM_MARKS);
    const screen = createOverlayProjector(view, 1, DIAGRAM_LINE_INK, REFERENCES_VIEW_MARKS);
    expect(withPens(screen, DIAGRAM_LINE_INK).marks).toBe(REFERENCES_VIEW_MARKS);
  });

  it('size an arrowhead, so the References view draws a larger one than a page', () => {
    const page = createOverlayProjector(view, 1);
    const screen = createOverlayProjector(view, 1, DIAGRAM_LINE_INK, REFERENCES_VIEW_MARKS);
    expect(arrowheadSize(arc, page)).toBeCloseTo(DIAGRAM_MARKS.arrowheadLength, 9);
    expect(arrowheadSize(arc, screen)).toBeCloseTo(REFERENCES_VIEW_MARKS.arrowheadLength, 9);
  });
});

describe('the Diagram’s glyphs', () => {
  const close = (a: { x: number; y: number }, b: { x: number; y: number }, digits = 6) => {
    expect(a.x).toBeCloseTo(b.x, digits);
    expect(a.y).toBeCloseTo(b.y, digits);
  };
  const arc = { center: [0.5, 0.2] as const, radius: 0.4, from: 2.2, to: 0.9, ccw: false };

  it('stops a one-way arrow’s stroke at its head’s notch, the tip where the stroke used to end', () => {
    const head = arrowheadSize(arc, CARD);
    const { shaft, head: drawn } = oneWayArrow(arc, CARD, head);
    expect(shaft).not.toBeNull();
    close(CARD(arcEndPoint(shaft!)), drawn.notch);
    const tip = CARD(arcEndPoint(arc));
    // Within a hair of the old end: how far the arc bends from its tangent over the reach, reach² / 2r.
    const hair = arrowheadReach(head) ** 2 / (2 * arc.radius * CARD.scale);
    expect(Math.hypot(drawn.tip.x - tip.x, drawn.tip.y - tip.y)).toBeLessThan(1.5 * hair);
    // Too short for a shaft: the head alone.
    expect(oneWayArrow({ ...arc, to: 2.19 }, CARD, head).shaft).toBeNull();
  });

  it('gives a mountain fold’s head one barb, on the outside of the curve, wider than a filled head’s', () => {
    const { head } = oneWayArrow(arc, CARD, arrowheadSize(arc, CARD));
    const centre = CARD(arc.center);
    const path = halfArrowheadPath(head, centre);
    const [tip, barb, notch] = [...path.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    close(tip!, head.tip, 2);
    close(notch!, head.notch, 2);
    const away = (p: { x: number; y: number }) => Math.hypot(p.x - centre.x, p.y - centre.y);
    expect(away(barb!)).toBeGreaterThan(Math.max(...head.barbs.map(away)));
  });

  it('outlines a push arrow from its cleft tail to its tip, and shrinks it whole when it is short', () => {
    const size = { head: 12, headHalf: 7.5, shaftHalf: 3.2, cleft: 4.5 };
    const outline = pushArrowOutline({ x: 0, y: 0 }, { x: 100, y: 0 }, size)!;
    expect(outline).toHaveLength(8);
    close(outline[0]!, { x: 100, y: 0 });
    // The head's barbs, the shaft's sides at the tail, the cleft between them.
    expect(outline.map((p) => Math.abs(p.y))).toEqual([0, 7.5, 3.2, 3.2, 0, 3.2, 3.2, 7.5]);
    close(outline[4]!, { x: 4.5, y: 0 });
    const short = pushArrowOutline({ x: 0, y: 0 }, { x: 10.5, y: 0 }, size)!;
    expect(Math.max(...short.map((p) => p.y))).toBeCloseTo(7.5 / 2, 6);
    expect(pushArrowOutline({ x: 1, y: 1 }, { x: 1, y: 1 }, size)).toBeNull();
  });

  it('draws the rotate glyph as two arrows going the way the model turns', () => {
    const centre = { x: 50, y: 50 };
    for (const direction of ['cw', 'ccw'] as const) {
      const { heads } = rotateGlyph(centre, 12, 6, direction);
      for (const head of heads) {
        // Each head points along the circle, the right way round: clockwise on the page is
        // (radius × direction) pointing into the page with y down.
        const r = { x: head.notch.x - centre.x, y: head.notch.y - centre.y };
        const d = { x: head.tip.x - head.notch.x, y: head.tip.y - head.notch.y };
        const turn = Math.sign(r.x * d.y - r.y * d.x);
        expect(turn).toBe(direction === 'cw' ? 1 : -1);
        expect(Math.hypot(r.x, r.y)).toBeCloseTo(12, 6);
      }
    }
  });
});

describe('a right-angle mark (Revision 2)', () => {
  const close = (a: SvgPoint, b: SvgPoint, digits = 9) => {
    expect(a.x).toBeCloseTo(b.x, digits);
    expect(a.y).toBeCloseTo(b.y, digits);
  };
  const length = (a: SvgPoint, b: SvgPoint) => Math.hypot(b.x - a.x, b.y - a.y);
  const size = { inset: 4, side: 7, leg: 11 };

  it('is an ∟ set into the angle off its vertex, with a closed square in its corner', () => {
    // Opening down and to the right from (10, 20), y down: the lines it marks run along x and y from there.
    const { legs, square } = rightAngleShape({ x: 10, y: 20 }, { x: Math.SQRT1_2, y: Math.SQRT1_2 }, size);
    const [endA, inner, endB] = legs;
    // Its inner corner 4 in from each line: inset·√2 along the diagonal.
    close(inner, { x: 14, y: 24 });
    expect(length({ x: 10, y: 20 }, inner)).toBeCloseTo(4 * Math.SQRT2, 9);
    // Each leg parallel to a line, `leg` long, ending 15 out along it: past the square.
    close(endA, { x: 25, y: 24 });
    close(endB, { x: 14, y: 35 });
    // The square in the ∟'s corner, its far corner (inset + side)·√2 out along the diagonal.
    const [onA, far, onB] = square;
    close(onA, { x: 21, y: 24 });
    close(far, { x: 21, y: 31 });
    close(onB, { x: 14, y: 31 });
    expect(length({ x: 10, y: 20 }, far)).toBeCloseTo(11 * Math.SQRT2, 9);
  });

  it('keeps its shape turned any way: legs square and `leg` long, the square’s far sides ending on them', () => {
    const vertex = { x: 0, y: 0 };
    const diagonal = { x: Math.cos(0.3), y: Math.sin(0.3) };
    const { legs, square } = rightAngleShape(vertex, diagonal, size);
    const [endA, inner, endB] = legs;
    const [onA, far, onB] = square;
    const along = (from: SvgPoint, to: SvgPoint) => ({ x: (to.x - from.x) / length(from, to), y: (to.y - from.y) / length(from, to) });
    const a = along(inner, endA);
    const b = along(inner, endB);
    expect(length(inner, endA)).toBeCloseTo(11, 9);
    expect(length(inner, endB)).toBeCloseTo(11, 9);
    expect(a.x * b.x + a.y * b.y).toBeCloseTo(0, 9);
    // Each leg 45° off the diagonal, the first anticlockwise of it on the page (y down), the second clockwise.
    expect(Math.atan2(a.y, a.x)).toBeCloseTo(0.3 - Math.PI / 4, 9);
    expect(Math.atan2(b.y, b.x)).toBeCloseTo(0.3 + Math.PI / 4, 9);
    close(inner, { x: 4 * Math.SQRT2 * diagonal.x, y: 4 * Math.SQRT2 * diagonal.y });
    close(far, { x: 11 * Math.SQRT2 * diagonal.x, y: 11 * Math.SQRT2 * diagonal.y });
    // The square's far sides end on the legs, `side` from the inner corner, and meet square at the far corner.
    close(onA, { x: inner.x + 7 * a.x, y: inner.y + 7 * a.y });
    close(onB, { x: inner.x + 7 * b.x, y: inner.y + 7 * b.y });
    expect((onA.x - far.x) * (onB.x - far.x) + (onA.y - far.y) * (onB.y - far.y)).toBeCloseTo(0, 9);
    expect(length(onA, far)).toBeCloseTo(7, 9);
    expect(length(onB, far)).toBeCloseTo(7, 9);
  });

  it('is drawn at its ink’s size, the way its diagonal goes through the projector, mirrored on the back', () => {
    const overlay = createOverlayProjector({ origin: [0, 0], ex: [100, 0], ey: [0, -100] }, 2);
    // Sheet units are y up: toward (1, 1) from (0.5, 0.5) is up and to the right on the page.
    const drawn = rightAngleDrawn([0.5, 0.5], [0.6, 0.6], overlay)!;
    const ink = 2;
    expect(DIAGRAM_RIGHT_ANGLE_INK).toEqual({ inset: 4, side: 7, leg: 11 });
    close(drawn.legs[0], { x: 50 + 4 * ink, y: -50 - 15 * ink });
    close(drawn.legs[1], { x: 50 + 4 * ink, y: -50 - 4 * ink });
    close(drawn.legs[2], { x: 50 + 15 * ink, y: -50 - 4 * ink });
    close(drawn.square[1], { x: 50 + 11 * ink, y: -50 - 11 * ink });
    // The back of a card: it opens the other way across, as the paper does.
    const back = createDiagramProjector(UNIT, 100, true);
    const front = createDiagramProjector(UNIT, 100, false);
    const onBack = rightAngleDrawn([0.2, 0.2], [0.3, 0.3], back)!;
    const onFront = rightAngleDrawn([0.2, 0.2], [0.3, 0.3], front)!;
    for (const part of ['legs', 'square'] as const) {
      onBack[part].forEach((point, index) => {
        const mirror = onFront[part][2 - index]!;
        // Symmetric about its diagonal: its first leg on the back is its second on the front, mirrored.
        expect(point.x - back([0.2, 0.2]).x).toBeCloseTo(-(mirror.x - front([0.2, 0.2]).x), 9);
        expect(point.y).toBeCloseTo(mirror.y, 9);
      });
    }
    // Only its direction is read: a point twice as far draws the same mark.
    expect(rightAngleDrawn([0.5, 0.5], [0.7, 0.7], overlay)).toEqual(rightAngleDrawn([0.5, 0.5], [0.6, 0.6], overlay));
    // Opening no way, it draws nothing.
    expect(rightAngleDrawn([0.5, 0.5], [0.5, 0.5], overlay)).toBeNull();
  });

  it('is one path of two subpaths: its ∟, then its square’s far sides', () => {
    const shape = rightAngleShape({ x: 10, y: 20 }, { x: Math.SQRT1_2, y: Math.SQRT1_2 }, size);
    expect(rightAnglePathData(shape)).toBe('M 25 24 L 14 24 L 14 35 M 21 24 L 21 31 L 14 31');
  });

  it('reaches half its pen past its four square ends, and √2 of that past its two mitred corners', () => {
    const reach = rightAngleReach(2);
    expect(reach.legs[0]).toBe(1);
    expect(reach.legs[1]).toBeCloseTo(Math.SQRT2, 12);
    expect(reach.legs[2]).toBe(1);
    expect(reach.square[0]).toBe(1);
    expect(reach.square[1]).toBeCloseTo(Math.SQRT2, 12);
    expect(reach.square[2]).toBe(1);
  });
});

describe('an angle mark (15b)', () => {
  const size = { radius: 10, tick: 1, spacing: 2 };

  it('sweeps the angle between its arms, under a half turn, whichever arm comes first', () => {
    // Arms along +x and +y (y down: a quarter turn clockwise on the page).
    const shape = angleMarkShape({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 3 }, 1, size)!;
    expect(shape.start).toBeCloseTo(0, 12);
    expect(shape.sweep).toBeCloseTo(Math.PI / 2, 12);
    // The other way round sweeps back: the same arc.
    const back = angleMarkShape({ x: 0, y: 0 }, { x: 0, y: 3 }, { x: 5, y: 0 }, 1, size)!;
    expect(back.sweep).toBeCloseTo(-Math.PI / 2, 12);
    // An obtuse angle across the ±π seam is still the angle the arms make, never its reflex.
    const obtuse = angleMarkShape({ x: 0, y: 0 }, { x: -1, y: 0.2 }, { x: -1, y: -0.2 }, 1, size)!;
    expect(Math.abs(obtuse.sweep)).toBeCloseTo(2 * Math.atan(0.2), 12);
  });

  it('puts each half’s ticks across its middle, spaced along the arc, each its length either side', () => {
    const shape = angleMarkShape({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 3 }, 1, size)!;
    expect(shape.ticks).toHaveLength(2);
    const [inner, outer] = shape.ticks[0]!;
    // A quarter of the way: 22.5°, from 9 to 11.
    expect(Math.atan2(inner.y, inner.x)).toBeCloseTo(Math.PI / 8, 12);
    expect(Math.hypot(inner.x, inner.y)).toBeCloseTo(9, 12);
    expect(Math.hypot(outer.x, outer.y)).toBeCloseTo(11, 12);
    expect(Math.atan2(shape.ticks[1]![0].y, shape.ticks[1]![0].x)).toBeCloseTo((3 * Math.PI) / 8, 12);
    // Two ticks a half: 2 apart along the arc, either side of its middle.
    const two = angleMarkShape({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 3 }, 2, size)!;
    expect(two.ticks).toHaveLength(4);
    const [a, b] = [two.ticks[0]![0], two.ticks[1]![0]];
    // Measured along the arc: 2 at a radius of 10 is a fifth of a radian.
    expect(Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x)).toBeCloseTo(2 / 10, 12);
  });

  it('is nothing when an arm has no direction, or the arms lie along one line', () => {
    expect(angleMarkShape({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 3 }, 1, size)).toBeNull();
    expect(angleMarkShape({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 2, y: 0 }, 1, size)).toBeNull();
    expect(angleMarkShape({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: -2, y: 0 }, 1, size)).toBeNull();
  });

  it('is drawn at its ink’s size — about 5 mm at an annotation’s ink — mirrored with the paper', () => {
    expect(DIAGRAM_ANGLE_MARK_INK.radius * 0.331).toBeCloseTo(5, 0);
    const overlay = createOverlayProjector({ origin: [0, 0], ex: [100, 0], ey: [0, -100] }, 2);
    const shape = angleMarkDrawn([0.5, 0.5], [[0.9, 0.5], [0.5, 0.9]], 1, overlay)!;
    expect(shape.radius).toBe(DIAGRAM_ANGLE_MARK_INK.radius * 2);
    // Sheet y up: the second arm is up the page, so the arc sweeps anticlockwise there.
    expect(shape.sweep).toBeCloseTo(-Math.PI / 2, 12);
    const back = createDiagramProjector(UNIT, 100, true);
    const front = createDiagramProjector(UNIT, 100, false);
    const arms = [[0.4, 0.2], [0.2, 0.4]] as const;
    expect(angleMarkDrawn([0.2, 0.2], arms, 1, back)!.sweep).toBeCloseTo(-angleMarkDrawn([0.2, 0.2], arms, 1, front)!.sweep, 12);
  });

  it('writes its arc and ticks as one path, and gives its arc as points a degree apart at most', () => {
    const shape = angleMarkShape({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 3 }, 1, size)!;
    const d = angleMarkPathData(shape);
    // The arc from the first arm to the second, then a tick a half.
    expect(d.startsWith('M 10 0 A 10 10 0 0 1 0 10 M ')).toBe(true);
    expect(d.match(/M /g)).toHaveLength(3);
    const points = angleMarkArcPoints(shape);
    expect(points).toHaveLength(91);
    expect(points[45]!.x).toBeCloseTo(10 * Math.SQRT1_2, 12);
  });
});

describe('arcExtremes', () => {
  it('is an arc’s bounds exactly, under a projector that turns and mirrors it', () => {
    const turned = (degrees: number, mirrored: boolean) => {
      const [c, s] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
      return createOverlayProjector({ origin: [40, 70], ex: [3 * c, 3 * s], ey: mirrored ? [3 * s, -3 * c] : [-3 * s, 3 * c] }, 1);
    };
    const arcs: DiagramArc[] = [
      { center: [10, 5], radius: 4, from: 0.3, to: 2.9, ccw: true },
      { center: [10, 5], radius: 4, from: 0.3, to: 2.9, ccw: false },
      { center: [-2, 1], radius: 7, from: -1.2, to: -1.1, ccw: true },
    ];
    for (const project of [turned(0, false), turned(33, false), turned(-120, true)]) {
      for (const arc of arcs) {
        const box = (points: SvgPoint[]) => ({
          left: Math.min(...points.map(({ x }) => x)),
          right: Math.max(...points.map(({ x }) => x)),
          top: Math.min(...points.map(({ y }) => y)),
          bottom: Math.max(...points.map(({ y }) => y)),
        });
        const extent = arcExtent(arc);
        const sampled = Array.from({ length: 20001 }, (_, i) => {
          const angle = arc.from + (arc.ccw ? 1 : -1) * extent * (i / 20000);
          return project([arc.center[0] + arc.radius * Math.cos(angle), arc.center[1] + arc.radius * Math.sin(angle)]);
        });
        const [exact, fine] = [box(arcExtremes(arc, project)), box(sampled)];
        for (const side of ['left', 'right', 'top', 'bottom'] as const) expect(exact[side]).toBeCloseTo(fine[side], 4);
      }
    }
  });
});

describe('strokedOutlinePoints', () => {
  const box = (points: SvgPoint[]) => ({
    left: Math.min(...points.map(({ x }) => x)),
    right: Math.max(...points.map(({ x }) => x)),
    top: Math.min(...points.map(({ y }) => y)),
    bottom: Math.max(...points.map(({ y }) => y)),
  });

  it('bounds a mitred outline by its mitres’ tips, and a corner past the limit by its edges’ ends', () => {
    // A right angle mitres √2 half pens out along its bisector: a square's corners, a pen past each side.
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(box(strokedOutlinePoints(square, 2))).toEqual({ left: -1, right: 11, top: -1, bottom: 11 });
    // A 20° spike mitres 5.76 half pens out: bevelled at SVG's 4, mitred under a limit of 6.
    const spike = [
      { x: 0, y: 0 },
      { x: 100, y: Math.tan((10 * Math.PI) / 180) * 100 },
      { x: 100, y: -Math.tan((10 * Math.PI) / 180) * 100 },
    ];
    expect(box(strokedOutlinePoints(spike, 2)).left).toBeCloseTo(-Math.sin((10 * Math.PI) / 180), 12);
    expect(box(strokedOutlinePoints(spike, 2, 6)).left).toBeCloseTo(-1 / Math.sin((10 * Math.PI) / 180), 9);
  });

  it('bounds an outline smaller than its pen by its edges’ inner sides too, which reach past its far side', () => {
    // A thin sliver, a pen of 20: its long edge's inner side is 10 past it, beyond the bevelled far corner's ends.
    const sliver = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 2, y: 0.5 },
    ];
    const points = strokedOutlinePoints(sliver, 20);
    expect(box(points).top).toBeCloseTo(-10, 12);
    expect(box(points).bottom).toBeGreaterThanOrEqual(10);
    // Repeated points draw no edge of their own.
    expect(box(strokedOutlinePoints([...sliver, sliver[2]!, sliver[0]!], 20))).toEqual(box(points));
  });
});

describe('a pleat arrow (15c)', () => {
  const size = { step: 4, back: 2, gap: 6, head: 5 };
  const tail = { x: 0, y: 0 };
  const tip = { x: 100, y: 0 };
  /** Its runs: every other segment, the first, the last and the gaps between its Zs. */
  const runs = (bolt: readonly SvgPoint[]) =>
    bolt.slice(1).flatMap((point, index) => (index % 2 === 0 ? [[bolt[index]!, point] as const] : []));
  const direction = ([a, b]: readonly [SvgPoint, SvgPoint]) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  };

  it('starts on its tail and ends on its tip, its runs parallel and stepped apart by a Z each', () => {
    for (const kinks of [1, 2, 3, 5]) {
      const bolt = pleatBolt(tail, tip, kinks, false, size)!;
      // Its tail, its first run's end, a Z each, a gap between each, its tip.
      expect(bolt).toHaveLength(2 * kinks + 2);
      expect(bolt[0]).toEqual(tail);
      expect(bolt.at(-1)).toEqual(tip);
      const way = runs(bolt).map(direction);
      expect(way).toHaveLength(kinks + 1);
      for (const each of way) {
        expect(each.x).toBeCloseTo(way[0]!.x, 12);
        expect(each.y).toBeCloseTo(way[0]!.y, 12);
      }
      // Each Z steps `step` across the runs, and `back` back along them.
      const d = way[0]!;
      for (let z = 0; z < kinks; z += 1) {
        const [a, b] = [bolt[1 + 2 * z]!, bolt[2 + 2 * z]!];
        const [dx, dy] = [b.x - a.x, b.y - a.y];
        expect(dx * -d.y + dy * d.x).toBeCloseTo(size.step, 12);
        expect(dx * d.x + dy * d.y).toBeCloseTo(-size.back, 12);
      }
      // The first run and the last alike: the Zs in the middle.
      const [first, last] = [runs(bolt)[0]!, runs(bolt).at(-1)!];
      expect(Math.hypot(first[1].x - first[0].x, first[1].y - first[0].y)).toBeCloseTo(
        Math.hypot(last[1].x - last[0].x, last[1].y - last[0].y),
        12
      );
    }
  });

  it('steps its Zs to the right of the way it points on a y-down page, mirrored to the left, its runs leaning the other way', () => {
    // Pointing along +x, y down: the right is +y.
    const right = pleatBolt(tail, tip, 1, false, size)!;
    expect(right[2]!.y - right[1]!.y).toBeGreaterThan(0);
    expect(right[1]!.y).toBeLessThan(0);
    const left = pleatBolt(tail, tip, 1, true, size)!;
    expect(left[2]!.y - left[1]!.y).toBeLessThan(0);
    expect(left[1]!.y).toBeGreaterThan(0);
    // A mirror image of each other across the line from tail to tip.
    left.forEach((point, index) => {
      expect(point.x).toBeCloseTo(right[index]!.x, 12);
      expect(point.y).toBeCloseTo(-right[index]!.y, 12);
    });
  });

  it('draws its Zs smaller on an arrow too short for them, as a short push does, and nothing for one of no length', () => {
    // At its full size: two heads' room either side, and the Zs.
    const full = 4 * size.head + 2 * (size.step + size.back) + size.gap;
    const fits = pleatBolt(tail, { x: full, y: 0 }, 2, false, size)!;
    const short = pleatBolt(tail, { x: full / 2, y: 0 }, 2, false, size)!;
    const across = (bolt: readonly SvgPoint[]) => {
      const d = direction([bolt[0]!, bolt[1]!]);
      return (bolt[2]!.x - bolt[1]!.x) * -d.y + (bolt[2]!.y - bolt[1]!.y) * d.x;
    };
    expect(across(fits)).toBeCloseTo(size.step, 12);
    expect(across(short)).toBeCloseTo(size.step / 2, 12);
    expect(pleatBolt(tail, tail, 1, false, size)).toBeNull();
  });

  it('puts the valley arrow’s head on its last run, its tip on the bolt’s and the shaft stopped at its notch', () => {
    const shape = pleatArrowShape(tail, tip, 1, false, size, 8)!;
    expect(shape.head.tip.x).toBeCloseTo(tip.x, 12);
    expect(shape.head.tip.y).toBeCloseTo(tip.y, 12);
    const end = shape.shaft!.at(-1)!;
    expect(end).toEqual(shape.head.notch);
    // Along the last run: the bolt's way there.
    const way = direction([shape.bolt.at(-2)!, shape.bolt.at(-1)!]);
    const axis = direction([shape.head.notch, shape.head.tip]);
    expect(axis.x).toBeCloseTo(way.x, 12);
    expect(axis.y).toBeCloseTo(way.y, 12);
    expect(Math.hypot(tip.x - end.x, tip.y - end.y)).toBeCloseTo(arrowheadReach(8), 12);
  });

  it('is drawn at its ink’s size, its head a fold arrow’s, its Zs on the paper’s side of it in a picture of the back too', () => {
    expect(DIAGRAM_PLEAT_INK.step * 0.331).toBeCloseTo(2.25, 2);
    const overlay = createOverlayProjector({ origin: [0, 0], ex: [400, 0], ey: [0, -400] }, 2);
    const drawn = pleatArrowDrawn([0.1, 0.5], [0.9, 0.5], 1, false, overlay)!;
    const across = drawn.bolt[2]!.y - drawn.bolt[1]!.y;
    // y down on the page, the arrow pointing along +x: its Zs step down, the ink's step.
    expect(across).toBeGreaterThan(0);
    const d = direction([drawn.bolt[0]!, drawn.bolt[1]!]);
    expect((drawn.bolt[2]!.x - drawn.bolt[1]!.x) * -d.y + across * d.x).toBeCloseTo(DIAGRAM_PLEAT_INK.step * 2, 9);
    // A fold arrow's head at this ink: its full length, as the arrow is long enough for it.
    expect(Math.hypot(drawn.head.tip.x - drawn.head.notch.x, drawn.head.tip.y - drawn.head.notch.y)).toBeCloseTo(
      arrowheadReach(DIAGRAM_ARROWHEAD_INK.length * 2),
      9
    );
    // A picture of the paper's back mirrors it: the Zs step to the other side on the page.
    const back = createDiagramProjector(UNIT, 100, true);
    const front = createDiagramProjector(UNIT, 100, false);
    const side = (project: typeof back) => {
      const bolt = pleatArrowDrawn([0.2, 0.5], [0.8, 0.5], 1, false, project)!.bolt;
      const run = direction([bolt[0]!, bolt[1]!]);
      return Math.sign((bolt[2]!.x - bolt[1]!.x) * -run.y + (bolt[2]!.y - bolt[1]!.y) * run.x);
    };
    expect(side(back)).toBe(-side(front));
  });

  it('stands its Zs’ mitres out past half its pen, as SVG mitres them, and no further than its limit', () => {
    // A right angle: its mitre √2 halves of the pen out along its bisector.
    const corner = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const [tip] = polylineMitres(corner, 2);
    expect(tip!.x).toBeCloseTo(11, 12);
    expect(tip!.y).toBeCloseTo(-1, 12);
    // Its ends are caps, not joins; a corner sharper than the limit is bevelled.
    const spike = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(polylineMitres(spike, 2)).toEqual([]);
    expect(polylineMitres(spike, 2, 40)).toHaveLength(1);
  });
});

describe('a stroke behind a flap, in pieces (15e)', () => {
  it('cuts a stretch where a hidden one starts and ends, each piece in front or behind', () => {
    expect(strokePieces(0, 1, undefined)).toEqual([{ start: 0, end: 1, hidden: false }]);
    expect(strokePieces(0, 1, [[0.2, 0.5]])).toEqual([
      { start: 0, end: 0.2, hidden: false },
      { start: 0.2, end: 0.5, hidden: true },
      { start: 0.5, end: 1, hidden: false },
    ]);
    // A stroke stopped short of its mark's end: the stretch past it is not drawn.
    expect(strokePieces(0, 0.4, [[0, 0.6]])).toEqual([{ start: 0, end: 0.4, hidden: true }]);
    expect(reversedStretches([[0, 0.3]])).toEqual([[0.7, 1]]);
  });

  it('cuts an arc shaft by shares of the arc its mark was compiled as, the drawn one a stretch of it', () => {
    const whole = { center: [0, 0] as const, radius: 1, from: 0, to: Math.PI / 2, ccw: true };
    // Stopped short of its head at 80% of the way.
    const drawn = { ...whole, to: 0.8 * (Math.PI / 2) };
    const pieces = arcPieces(drawn, whole, [[0, 0.5]]);
    expect(pieces.map(({ hidden }) => hidden)).toEqual([true, false]);
    expect(pieces[0]!.arc.from).toBeCloseTo(0, 12);
    expect(pieces[0]!.arc.to).toBeCloseTo(Math.PI / 4, 12);
    expect(pieces[1]!.arc.to).toBeCloseTo(drawn.to, 12);
    // Nothing hidden: the drawn arc itself, not one rebuilt from shares.
    expect(arcPieces(drawn, whole, undefined)).toEqual([{ arc: drawn, hidden: false }]);
  });

  it('cuts a run of lines at the shares of its mark’s length, through its corners', () => {
    const run = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const pieces = polylinePieces(run, 20, [[0.25, 0.75]]);
    expect(pieces.map(({ hidden, length }) => [hidden, length])).toEqual([
      [false, 5],
      [true, 10],
      [false, 5],
    ]);
    // The hidden piece turns the corner.
    expect(pieces[1]!.points).toEqual([
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
  });

  it('draws a ring’s hidden arcs from its rightmost point, clockwise as the page shows it', () => {
    // Sheet y up, the page's y down, one unit a px.
    const project = createOverlayProjector({ origin: [0, 0], ex: [1, 0], ey: [0, -1] }, 1);
    const pieces = ringPieces([0, 0], 10, [[0, 0.25]], project);
    expect(pieces.map(({ hidden }) => hidden)).toEqual([true, false]);
    // From the right to the bottom of the page: a quarter, clockwise (sweep 1).
    expect(numbers(pieces[0]!.d)).toEqual([10, 0, 10, 10, 0, 0, 1, 0, 10]);
    expect(pieces[0]!.length).toBeCloseTo(5 * Math.PI, 12);
  });
});

describe('equal divisions (Revision 2)', () => {
  /** An annotation's ink in mm, as the canvas and a page print one. */
  const INK_MM = 0.3307;
  const mm = (value: number) => value / INK_MM;
  /** The sizes at one ink: the shape is then in ink. */
  const size = (offset: number) => ({
    offset,
    overshoot: DIAGRAM_DIVISIONS_INK.overshoot,
    tick: DIAGRAM_DIVISIONS_INK.tick,
    spacing: DIAGRAM_DIVISIONS_INK.spacing,
    tickFloor: DIAGRAM_DIVISIONS_INK.tickFloor,
    spacingFloor: 1.2,
    lean: (DIAGRAM_DIVISIONS_INK.leanDeg * Math.PI) / 180,
    number: DIAGRAM_DIVISIONS_INK.number,
    gap: DIAGRAM_DIVISIONS_INK.gap,
  });
  const look = { parts: 4, ticks: 1, mirrored: false, numbered: false };
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 0 };
  /** A segment as a sorted key, whichever end it is drawn from. */
  const key = ([a, b]: readonly [SvgPoint, SvgPoint]) =>
    [a, b]
      .map(({ x, y }) => `${x.toFixed(9)},${y.toFixed(9)}`)
      .sort()
      .join(' ');

  it('stands a divider square to the line it measures at each end and between parts, `parts + 1` of them', () => {
    const shape = divisionsShape(from, to, { ...look, parts: 5 }, size(mm(2.5)))!;
    expect(shape.dividers).toHaveLength(6);
    shape.dividers.forEach(([a, b], i) => {
      expect(a.x).toBeCloseTo((100 * i) / 5, 12);
      expect(b.x).toBeCloseTo((100 * i) / 5, 12);
    });
    // To the right of the way it runs, y down: below a line running right.
    expect(shape.side).toEqual({ x: -0, y: 1 });
    expect(shape.line[0].y).toBeCloseTo(mm(2.5), 12);
    expect(shape.line[1]).toMatchObject({ x: 100 });
    // `mirrored`, to the left.
    expect(divisionsShape(from, to, { ...look, mirrored: true }, size(mm(2.5)))!.line[0].y).toBeCloseTo(-mm(2.5), 12);
    expect(divisionsShape(from, from, look, size(5))).toBeNull();
  });

  it('runs a divider from the line it measures to 1.65 mm past its line, straddling the line evenly where it is nearer than that (ED4)', () => {
    const ends = (offset: number) => {
      const [a, b] = divisionsShape(from, to, look, size(mm(offset)))!.dividers[1]!;
      return [a.y, b.y].map((y) => Number((y * INK_MM).toFixed(2)) + 0);
    };
    // 2.5 mm: in the margin, from the edge out past the line.
    expect(ends(2.5)).toEqual([0, 4.15]);
    // 1 mm: as far on the paper's side of its line as past it, 0.65 mm into the paper.
    expect(ends(1)).toEqual([-0.65, 2.65]);
    // None: the template's |\|\| symbol, the line on the edge, dividers straddling it.
    expect(ends(0)).toEqual([-1.65, 1.65]);
  });

  it('leans each tick 20° off square as a backslash does across a level line, whichever way the line was drawn', () => {
    const forward = divisionsShape(from, to, { ...look, ticks: 2 }, size(mm(2.5)))!;
    // Drawn the other way, on the same side: the very same ticks.
    const backward = divisionsShape(to, from, { ...look, ticks: 2, mirrored: true }, size(mm(2.5)))!;
    expect(backward.ticks.map(key).sort()).toEqual(forward.ticks.map(key).sort());
    for (const [a, b] of forward.ticks) {
      // Down and to the right, top to bottom: a backslash.
      const lean = Math.atan2(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      expect((b.x - a.x) * (b.y - a.y)).toBeGreaterThan(0);
      expect((lean * 180) / Math.PI).toBeCloseTo(20, 9);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(2 * DIAGRAM_DIVISIONS_INK.tick, 9);
    }
    // Two ticks a part, spaced along the line at its middle.
    const first = forward.ticks.slice(0, 2).map(([a, b]) => (a.x + b.x) / 2);
    expect(first[1]! - first[0]!).toBeCloseTo(DIAGRAM_DIVISIONS_INK.spacing, 9);
    expect((first[0]! + first[1]!) / 2).toBeCloseTo(12.5, 9);
  });

  it('leans its ticks as a backslash on the page in a picture of the paper’s back, its line kept on the paper’s side', () => {
    const drawn = (mirrored: boolean) =>
      divisionsDrawn([0.2, 0.8], [0.8, 0.8], { ...look, offset: 7.5 }, createDiagramProjector(UNIT, 100, mirrored))!;
    const [front, back] = [drawn(false), drawn(true)];
    for (const shape of [front, back]) {
      for (const [a, b] of shape.ticks) expect((b.x - a.x) * (b.y - a.y)).toBeGreaterThan(0);
    }
    // The paper's side of its line is mirrored with it: the line stays on the same side of the edge on the page.
    expect(Math.sign(back.side.y)).toBe(Math.sign(front.side.y));
  });

  it('draws a crowded part’s ticks smaller, down to their floor and no further, and says so: 32 parts on 25 mm', () => {
    const short = { x: mm(25), y: 0 };
    const three = divisionsShape(from, short, { ...look, parts: 32, ticks: 3 }, size(mm(2.5)))!;
    expect(three.crowded).toBe(true);
    const group = three.ticks.slice(0, 3).map(([a, b]) => (a.x + b.x) / 2);
    // Spaced at the floor: two pens.
    expect(group[1]! - group[0]!).toBeCloseTo(1.2, 9);
    const [a, b] = three.ticks[0]!;
    expect(Math.hypot(b.x - a.x, b.y - a.y) / 2).toBeCloseTo(DIAGRAM_DIVISIONS_INK.tickFloor, 9);
    // One tick a part shrinks too, and fits above its floor.
    const one = divisionsShape(from, short, { ...look, parts: 32 }, size(mm(2.5)))!;
    expect(one.crowded).toBe(false);
    const [c, d] = one.ticks[0]!;
    const half = Math.hypot(d.x - c.x, d.y - c.y) / 2;
    expect(half).toBeLessThan(DIAGRAM_DIVISIONS_INK.tick);
    expect(half).toBeGreaterThan(DIAGRAM_DIVISIONS_INK.tickFloor);
    // A part long enough: the sketch's size.
    expect(divisionsShape(from, to, look, size(mm(2.5)))!.crowded).toBe(false);
  });

  it('prints its count upright beside its line’s middle, its box 2 ink past the dividers’ ends, on level and upright lines', () => {
    const offset = mm(2.5);
    const level = divisionsShape(from, to, { ...look, parts: 7, numbered: true }, size(offset))!.number!;
    expect(level.text).toBe('7');
    expect(level.size).toBe(DIAGRAM_DIVISIONS_INK.number);
    expect(level.at.x).toBeCloseTo(50, 9);
    const past = offset + DIAGRAM_DIVISIONS_INK.overshoot + DIAGRAM_DIVISIONS_INK.gap;
    expect(level.at.y - level.halfHeight).toBeCloseTo(past, 9);
    expect(level.halfHeight).toBeCloseTo(DIVISIONS_DIGIT_HALF_HEIGHT_EMS * DIAGRAM_DIVISIONS_INK.number, 9);
    // Upright, to the left of a line running down: its box's side 2 ink past.
    const upright = divisionsShape(from, { x: 0, y: 100 }, { ...look, parts: 12, numbered: true }, size(offset))!.number!;
    expect(upright.halfWidth).toBeCloseTo(DIVISIONS_DIGIT_EMS * DIAGRAM_DIVISIONS_INK.number, 9);
    expect(upright.at.y).toBeCloseTo(50, 9);
    expect(upright.at.x + upright.halfWidth).toBeCloseTo(-past, 9);
    expect(divisionsShape(from, to, look, size(offset))!.number).toBeNull();
  });

  it('is drawn at its ink, its line in the existing creases’ pen and its marks in a ring’s, its offset taken in ink', () => {
    const overlay = createOverlayProjector({ origin: [0, 0], ex: [400, 0], ey: [0, -400] }, 2);
    const drawn = divisionsDrawn([0.1, -0.5], [0.9, -0.5], { ...look, offset: 7.5 }, overlay)!;
    expect(drawn.pens).toEqual({ line: DIAGRAM_LINE_INK.crease.width * 2, marks: markRingWidth(overlay) });
    expect(drawn.line[0].y - 200).toBeCloseTo(15, 9);
    expect(drawn.dividers[0]![1].y - 200).toBeCloseTo(15 + DIAGRAM_DIVISIONS_INK.overshoot * 2, 9);
    // Two paths: the line, and the dividers and ticks.
    const d = divisionsPathData(drawn);
    expect(d.line.match(/M/g)).toHaveLength(1);
    expect(d.marks.match(/M/g)).toHaveLength(5 + 4);
    expect(divisionsStrokes(drawn)).toHaveLength(1 + 5 + 4);
  });

  it('draws each stroke in the pen its table names', () => {
    const overlay = createOverlayProjector({ origin: [0, 0], ex: [400, 0], ey: [0, -400] }, 2);
    const pens = DIAGRAM_DIVISIONS_INK.pens as { line: DivisionsPen; marks: DivisionsPen };
    const was = { ...pens };
    try {
      // The table swapped: the drawing follows it, not a choice of its own.
      Object.assign(pens, { line: 'ring', marks: 'crease' });
      const drawn = divisionsDrawn([0.1, -0.5], [0.9, -0.5], { ...look, offset: 7.5 }, overlay)!;
      expect(drawn.pens).toEqual({ line: markRingWidth(overlay), marks: DIAGRAM_LINE_INK.crease.width * 2 });
    } finally {
      Object.assign(pens, was);
    }
  });
});
