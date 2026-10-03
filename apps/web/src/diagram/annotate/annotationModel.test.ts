import { describe, expect, it } from 'vitest';
import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import {
  ARROW_BEND,
  arrowApex,
  carryAnnotation,
  createAnnotation,
  defaultBend,
  flipAnnotationArc,
  frameOf,
  isDegenerate,
  labelHalfWidth,
  mirrorMove,
  moveAnnotation,
  moveAnnotationEnd,
} from './annotationModel';

const SQUARE = { width: 1, height: 1 };
const id = () => 'annotation-1';

describe('a new annotation', () => {
  it('puts a sign or a label at the press, with its own defaults', () => {
    expect(createAnnotation('turn-over', [0.2, 0.3], [0.9, 0.9], SQUARE, id)).toEqual({
      id: 'annotation-1',
      kind: 'turn-over',
      from: [0.2, 0.3],
      to: [0.2, 0.3],
      axis: 'vertical',
    });
    expect(createAnnotation('rotate', [0.2, 0.3], [0.2, 0.3], SQUARE, id).rotate).toEqual({
      amount: 'quarter',
      direction: 'cw',
    });
    expect(createAnnotation('label', [0.2, 0.3], [0.2, 0.3], SQUARE, id).text).toBe('A');
  });

  it('draws a line or a push from the drag, with no bulge', () => {
    const line = createAnnotation('hidden-line', [0, 0], [1, 1], SQUARE, id);
    expect(line).toEqual({ id: 'annotation-1', kind: 'hidden-line', from: [0, 0], to: [1, 1] });
  });

  it('bulges a fold arrow toward the picture’s middle, as References does', () => {
    // Along the top, left to right: the middle is below, which is the right of its travel.
    const top = createAnnotation('valley-arrow', [0.2, 0.1], [0.8, 0.1], SQUARE, id);
    expect(top.bend).toBeCloseTo(-ARROW_BEND, 9);
    expect(arrowApex(top.from, top.to, top.bend!)[1]).toBeGreaterThan(0.1);
    // Along the bottom: the middle is above.
    const bottom = createAnnotation('valley-arrow', [0.2, 0.9], [0.8, 0.9], SQUARE, id);
    expect(arrowApex(bottom.from, bottom.to, bottom.bend!)[1]).toBeLessThan(0.9);
    expect(defaultBend([0.2, 0.9], [0.8, 0.9], SQUARE)).toBeCloseTo(ARROW_BEND, 9);
  });
});

describe('an arrow’s arc', () => {
  it('bulges to the left of its travel as the page shows it for a positive bend', () => {
    // Travelling right on a y-down page, left is up.
    const apex = arrowApex([0, 0.5], [1, 0.5], 0.25);
    expect(apex[0]).toBeCloseTo(0.5, 9);
    expect(apex[1]).toBeCloseTo(0.25, 9);
    // A 60° arc's sagitta: 1 − cos 30° of its chord.
    expect(arrowApex([0, 0], [1, 0], ARROW_BEND)[1]).toBeCloseTo(-(1 - Math.cos(Math.PI / 6)), 9);
  });

  it('turns over with Flip arc, and nothing else does', () => {
    const arrow: KnownDiagramAnnotation = { id: 'a', kind: 'mountain-arrow', from: [0, 0], to: [1, 0], bend: 0.2 };
    expect(flipAnnotationArc(arrow).bend).toBe(-0.2);
    const line: KnownDiagramAnnotation = { id: 'b', kind: 'valley-line', from: [0, 0], to: [1, 0] };
    expect(flipAnnotationArc(line)).toBe(line);
  });
});

describe('moving one', () => {
  const arrow: KnownDiagramAnnotation = { id: 'a', kind: 'push-arrow', from: [0.1, 0.1], to: [0.5, 0.5] };

  it('moves the whole, or one end', () => {
    expect(moveAnnotation(arrow, [0.1, -0.1])).toMatchObject({ from: [0.2, 0], to: [0.6, 0.4] });
    expect(moveAnnotation(arrow, [0, 0])).toBe(arrow);
    expect(moveAnnotationEnd(arrow, 'to', [0.9, 0.9])).toMatchObject({ from: [0.1, 0.1], to: [0.9, 0.9] });
  });

  it('moves a sign whole by either end: it has one place', () => {
    const sign: KnownDiagramAnnotation = { id: 's', kind: 'turn-over', from: [0.5, 0.5], to: [0.5, 0.5] };
    expect(moveAnnotationEnd(sign, 'from', [0.2, 0.2])).toMatchObject({ from: [0.2, 0.2], to: [0.2, 0.2] });
  });

  it('knows a slip from a line', () => {
    expect(isDegenerate({ ...arrow, to: [0.105, 0.1] }, 0.015)).toBe(true);
    expect(isDegenerate(arrow, 0.015)).toBe(false);
    expect(isDegenerate({ id: 'l', kind: 'label', from: [0, 0], to: [0, 0] }, 0.015)).toBe(false);
  });
});

describe('carrying one through its picture’s move', () => {
  it('flips a mirror’s bulge and sense, and turns a turn-over’s axis a quarter turn round', () => {
    const frame = frameOf(400, 300)!;
    expect(frame).toEqual({ width: 1, height: 0.75 });
    const mirror = mirrorMove(frame);
    const arrow: KnownDiagramAnnotation = { id: 'a', kind: 'valley-arrow', from: [0.1, 0.2], to: [0.4, 0.2], bend: 0.1 };
    expect(carryAnnotation(arrow, mirror)).toMatchObject({ from: [0.9, 0.2], to: [0.6, 0.2], bend: -0.1 });
    const rotate: KnownDiagramAnnotation = {
      id: 'r',
      kind: 'rotate',
      from: [0.5, 0.5],
      to: [0.5, 0.5],
      rotate: { amount: 'half', direction: 'cw' },
    };
    expect(carryAnnotation(rotate, mirror).rotate).toEqual({ amount: 'half', direction: 'ccw' });
    const turnOver: KnownDiagramAnnotation = { id: 't', kind: 'turn-over', from: [0, 0], to: [0, 0], axis: 'vertical' };
    const quarter = { point: (point: [number, number]) => point, mirrors: false, turnDeg: 90 };
    expect(carryAnnotation(turnOver, quarter).axis).toBe('horizontal');
    expect(carryAnnotation(turnOver, { ...quarter, turnDeg: 180 }).axis).toBe('vertical');
    expect(carryAnnotation(turnOver, { ...quarter, turnDeg: 15 }).axis).toBe('vertical');
  });
});

describe('keeping within reach', () => {
  it('stops an end, a new annotation and a carried point at the reach the file reads', () => {
    const line: KnownDiagramAnnotation = { id: 'l', kind: 'valley-line', from: [0.1, 0.5], to: [0.9, 0.5] };
    expect(moveAnnotationEnd(line, 'from', [-6, 0.5]).from).toEqual([-4, 0.5]);
    expect(createAnnotation('push-arrow', [-9, 0], [0, 9], SQUARE, id)).toMatchObject({ from: [-4, 0], to: [0, 4] });
    const mirror = mirrorMove({ width: 1, height: 1 });
    expect(carryAnnotation({ ...line, from: [-3.5, 0.5] }, mirror).from).toEqual([4, 0.5]);
  });

  it('moves a body only as far as keeps it whole', () => {
    const line: KnownDiagramAnnotation = { id: 'l', kind: 'valley-line', from: [0.1, 0.5], to: [0.9, 0.5] };
    const moved = moveAnnotation(line, [-9, 0]);
    expect(moved.from[0]).toBeCloseTo(-4, 9);
    expect(moved.to[0] - moved.from[0]).toBeCloseTo(0.8, 9);
  });
});

describe('a label’s width', () => {
  it('counts a wide character as an em and a Latin one as a little over half', () => {
    expect(labelHalfWidth('漢字漢字')).toBeGreaterThan(labelHalfWidth('ABCD') * 1.5);
    expect(labelHalfWidth('')).toBeGreaterThan(0);
  });
});
