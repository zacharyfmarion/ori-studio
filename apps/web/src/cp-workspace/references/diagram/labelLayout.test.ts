import { describe, expect, it } from 'vitest';
import type { StepDiagramPrimitive } from '../referenceFinderDiagramToPrimitives';
import { createDiagramProjector, createOverlayProjector } from '../stepDiagramGeometry';
import { DIAGRAM_LABEL_INK, labelWidth } from './diagramInk';
import {
  diagramMarks,
  markOuterRadius,
  placeLabels,
  type LabelPlacement,
  type Rect,
} from './labelLayout';

const UNIT = { width: 1, height: 1 };
const CARD = createDiagramProjector(UNIT, 100);
const CARD_LAYOUT = {
  bounds: { x: 0, y: 0, width: 100, height: 100 },
  reserved: [{ x: 0, y: 0, width: 16, height: 13 }],
};

const mark = (at: readonly [number, number], text: string): StepDiagramPrimitive[] => [
  { kind: 'point', at, style: 'highlight' },
  { kind: 'label', at, text, style: 'highlight' },
];

/** The one placement of a model with a single label. */
function only(placed: Map<number, LabelPlacement>): LabelPlacement {
  expect(placed.size).toBe(1);
  return [...placed.values()][0]!;
}

/** Which side of its point a placed letter's box sits on, as screen signs. */
function sideOf(placement: LabelPlacement, point: { x: number; y: number }): [number, number] {
  const { box } = placement;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return [Math.sign(Math.round(cx - point.x)), Math.sign(Math.round(cy - point.y))];
}

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function inside(a: Rect, b: Rect): boolean {
  return (
    a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height
  );
}

/** The distance from a ring's centre to the nearest point of a box. */
function clearance(box: Rect, ring: { x: number; y: number }): number {
  const nx = Math.min(Math.max(ring.x, box.x), box.x + box.width);
  const ny = Math.min(Math.max(ring.y, box.y), box.y + box.height);
  return Math.hypot(nx - ring.x, ny - ring.y);
}

describe('where a letter goes first', () => {
  // The outward diagonal: a letter at a corner goes into the corner's own
  // margin, which is where a diagram puts it.
  it('stands off its point diagonally, away from the sheet middle', () => {
    const bottomLeft = only(placeLabels(mark([0.3, 0.3], 'P'), UNIT, CARD));
    expect(sideOf(bottomLeft, CARD([0.3, 0.3]))).toEqual([-1, 1]);
    expect(bottomLeft.anchor).toBe('end');
    const topRight = only(placeLabels(mark([0.7, 0.7], 'P'), UNIT, CARD));
    expect(sideOf(topRight, CARD([0.7, 0.7]))).toEqual([1, -1]);
    expect(topRight.anchor).toBe('start');
  });

  it('goes straight up or down from the vertical midline, centred', () => {
    const low = only(placeLabels(mark([0.5, 0.2], 'P'), UNIT, CARD));
    expect(sideOf(low, CARD([0.5, 0.2]))).toEqual([0, 1]);
    expect(low.anchor).toBe('middle');
    const high = only(placeLabels(mark([0.5, 0.8], 'P'), UNIT, CARD));
    expect(sideOf(high, CARD([0.5, 0.8]))).toEqual([0, -1]);
  });

  // The side is read in SVG units, so reading it off the SHEET would put every
  // back-side letter inside the drawing and leave the margin empty.
  it('decides the side in projected space, so a mirrored card keeps its margins', () => {
    const back = createDiagramProjector(UNIT, 100, true);
    // A mark on the sheet's left edge is drawn at the picture's RIGHT edge.
    expect(back([0.2, 0.5]).x).toBeGreaterThan(back([0.5, 0.5]).x);
    const placed = only(placeLabels(mark([0.2, 0.5], 'P'), UNIT, back));
    expect(sideOf(placed, back([0.2, 0.5]))[0]).toBe(1);
    expect(placed.anchor).toBe('start');
    // Unmirrored, the same mark goes the other way.
    expect(only(placeLabels(mark([0.2, 0.5], 'P'), UNIT, CARD)).anchor).toBe('end');
  });

  // Anchored at the near edge: a glyph wider than its estimate then grows away
  // from the mark rather than over it.
  it('anchors the text at the edge of its box nearest the point', () => {
    const left = only(placeLabels(mark([0.3, 0.5], 'P'), UNIT, CARD));
    expect(left.anchor).toBe('end');
    expect(left.x).toBeCloseTo(left.box.x + left.box.width, 9);
    const right = only(placeLabels(mark([0.7, 0.5], 'P'), UNIT, CARD));
    expect(right.anchor).toBe('start');
    expect(right.x).toBeCloseTo(right.box.x, 9);
    // The baseline is inside the box, near its bottom.
    expect(right.y).toBeGreaterThan(right.box.y + right.box.height / 2);
    expect(right.y).toBeLessThan(right.box.y + right.box.height);
  });

  it('sizes the box by the pen and the letters', () => {
    const one = only(placeLabels(mark([0.3, 0.3], 'P'), UNIT, CARD));
    const size = DIAGRAM_LABEL_INK.size * CARD.ink;
    expect(one.box.height).toBeCloseTo(size, 9);
    expect(one.box.width).toBeCloseTo(labelWidth('P', size), 9);
    const two = only(placeLabels(mark([0.3, 0.3], 'PQ'), UNIT, CARD));
    expect(two.box.width).toBeCloseTo(labelWidth('PQ', size), 9);
    expect(two.box.width).toBeGreaterThan(one.box.width * 2);
  });

  // A Q at the right edge of a card ran off it while every capital was taken
  // to be as wide as the average one.
  it('keeps a wide letter on the card where a narrow one fits', () => {
    const at: [number, number] = [0.92, 0.75];
    const p = only(placeLabels(mark(at, 'P'), UNIT, CARD, CARD_LAYOUT));
    const q = only(placeLabels(mark(at, 'Q'), UNIT, CARD, CARD_LAYOUT));
    expect(inside(p.box, CARD_LAYOUT.bounds)).toBe(true);
    expect(inside(q.box, CARD_LAYOUT.bounds)).toBe(true);
    expect(q.box.width).toBeGreaterThan(p.box.width);
  });
});

describe('what a letter keeps clear of', () => {
  // The old offset was less than the ring's radius plus half a glyph, so every
  // letter sat on the ring round its own mark.
  it('never covers the ring round its own mark', () => {
    for (const at of [
      [0.3, 0.3],
      [0.5, 0.5],
      [0.5, 0.2],
      [0, 0],
      [1, 1],
      [0.05, 0.95],
    ] as const) {
      const placed = only(placeLabels(mark(at, 'P'), UNIT, CARD, CARD_LAYOUT));
      expect(clearance(placed.box, CARD(at)), `${at}`).toBeGreaterThanOrEqual(
        markOuterRadius(CARD) - 1e-9
      );
    }
  });

  it('moves off the ring round another mark', () => {
    // Q's ring sits exactly where P's letter would go first: up and to the
    // right of P, a little way off.
    const p: [number, number] = [0.6, 0.6];
    const q: [number, number] = [0.66, 0.66];
    const alone = only(placeLabels(mark(p, 'P'), UNIT, CARD));
    const moved = only(
      placeLabels([...mark(p, 'P'), { kind: 'point', at: q, style: 'highlight' }], UNIT, CARD)
    );
    expect(clearance(alone.box, CARD(q))).toBeLessThan(markOuterRadius(CARD));
    expect(clearance(moved.box, CARD(q))).toBeGreaterThanOrEqual(markOuterRadius(CARD) - 1e-9);
    expect(clearance(moved.box, CARD(p))).toBeGreaterThanOrEqual(markOuterRadius(CARD) - 1e-9);
  });

  it('does not land on a letter already placed', () => {
    // Two references at one point — a line's letter at a mark, say.
    const placed = placeLabels(
      [...mark([0.6, 0.6], 'P'), { kind: 'label', at: [0.6, 0.6], text: 'A', style: 'highlight' }],
      UNIT,
      CARD
    );
    expect(placed.size).toBe(2);
    const [first, second] = [...placed.values()];
    expect(overlap(first!.box, second!.box)).toBe(false);
    // Placed in order: the first letter gets the place it wanted.
    expect(sideOf(first!, CARD([0.6, 0.6]))).toEqual([1, -1]);
  });

  it('stays inside a card and off the corner the step number covers', () => {
    // A mark at every corner and one on each edge — where the outward
    // diagonal leaves the picture, and where the top-left one is under the
    // number.
    const spots = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0.5, 1],
      [0, 0.5],
      [0.1, 0.92],
    ] as const;
    const primitives = spots.flatMap((at, i) => mark(at, String.fromCharCode(80 + i)));
    const placed = placeLabels(primitives, UNIT, CARD, CARD_LAYOUT);
    expect(placed.size).toBe(spots.length);
    const rings = diagramMarks(primitives, CARD);
    for (const [index, placement] of placed) {
      const label = primitives[index] as { text: string };
      expect(inside(placement.box, CARD_LAYOUT.bounds), label.text).toBe(true);
      expect(overlap(placement.box, CARD_LAYOUT.reserved[0]!), label.text).toBe(false);
      for (const ring of rings) {
        expect(clearance(placement.box, ring), label.text).toBeGreaterThanOrEqual(
          markOuterRadius(CARD) - 1e-9
        );
      }
      for (const [other, otherPlacement] of placed) {
        if (other === index) continue;
        expect(overlap(placement.box, otherPlacement.box), label.text).toBe(false);
      }
    }
  });

  // A letter for a line sits on the line, and the line is what it names: a
  // letter across it hides a piece of the thing it is for. An earlier crease
  // is context, drawn faint, and a letter over one is the lesser evil next to
  // a letter pushed away from its own mark.
  it('stands off the line it sits on, and ignores an earlier crease', () => {
    const at: [number, number] = [0.5, 0.5];
    const named = (style: 'highlight' | 'crease' | 'mountain'): StepDiagramPrimitive[] => [
      { kind: 'line', from: [0, 0], to: [1, 1], style },
      { kind: 'label', at, text: 'A', style: 'highlight' },
    ];
    // Alone at the middle a letter goes straight up — which, over the
    // diagonal, is across the line; up-left is off it.
    expect(sideOf(only(placeLabels(named('crease'), UNIT, CARD)), CARD(at))).toEqual([0, -1]);
    expect(sideOf(only(placeLabels(named('highlight'), UNIT, CARD)), CARD(at))).toEqual([-1, -1]);
    expect(sideOf(only(placeLabels(named('mountain'), UNIT, CARD)), CARD(at))).toEqual([-1, -1]);
  });

  // The canvas's paper sits wherever the document put it, and its size says
  // nothing about where its middle is: "outward" is from the middle it names.
  it('takes outward from the sheet’s own middle when it is given one', () => {
    const view = { origin: [10, 90] as const, ex: [80, 0] as const, ey: [0, -80] as const };
    const overlay = createOverlayProjector(view, 1);
    // The unit sheet's top-right corner, which from a middle up and to the
    // right of the sheet is the bottom-left.
    const at: [number, number] = [1, 1];
    const shifted = { width: 1, height: 1, centre: [2.5, 2.5] as const };
    expect(sideOf(only(placeLabels(mark(at, 'P'), UNIT, overlay)), overlay(at))).toEqual([1, -1]);
    expect(sideOf(only(placeLabels(mark(at, 'P'), shifted, overlay)), overlay(at))).toEqual([-1, 1]);
  });

  // The canvas has no edge and no number: a letter at a corner keeps the
  // outward diagonal a card would have had to give up.
  it('goes anywhere when there are no bounds', () => {
    const view = { origin: [10, 90] as const, ex: [80, 0] as const, ey: [0, -80] as const };
    const overlay = createOverlayProjector(view, 1);
    const placed = only(placeLabels(mark([0, 1], 'P'), UNIT, overlay));
    expect(sideOf(placed, overlay([0, 1]))).toEqual([-1, -1]);
    expect(placed.box.x).toBeLessThan(10);
    expect(placed.box.y).toBeLessThan(10);
  });

  // A letter that overlaps something is a reference the reader can still
  // find; a missing one is not.
  it('takes the least-bad place rather than none when nothing fits', () => {
    const cramped = { bounds: { x: 45, y: 45, width: 10, height: 10 } };
    const placed = placeLabels(mark([0.5, 0.5], 'P'), UNIT, CARD, cramped);
    expect(placed.size).toBe(1);
    const { box } = only(placed);
    // Still beside the mark rather than flung somewhere arbitrary.
    expect(Math.hypot(box.x + box.width / 2 - 50, box.y + box.height / 2 - 50)).toBeLessThan(20);
  });

  it('keys each placement by the label’s index in the list drawn', () => {
    const primitives: StepDiagramPrimitive[] = [
      { kind: 'sheet', width: 1, height: 1 },
      ...mark([0.2, 0.2], 'P'),
      { kind: 'line', from: [0, 0], to: [1, 1], style: 'valley' },
      { kind: 'label', at: [0.5, 0.5], text: 'A', style: 'highlight' },
    ];
    const placed = placeLabels(primitives, UNIT, CARD);
    expect([...placed.keys()]).toEqual([2, 4]);
  });
});
