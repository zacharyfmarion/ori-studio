import { describe, expect, it } from 'vitest';
import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import {
  ANNOTATION_KINDS,
  angleMarkArms,
  angleMarkAt,
  flipAnnotation,
  flipCentre,
  flipChangesMark,
  flipsOver,
  rightAngleAt,
  rightAngleDiagonal,
} from './annotationModel';

/** A point, to within rounding: a mirrored coordinate is `2c − x`. */
const near = (point: readonly number[]) => point.map((value) => expect.closeTo(value, 12));

/**
 * Flip Horizontal and Flip Vertical (Zach, 2026-10-05): a mark turned over in
 * place, as a mirrored picture carries it — an arrow or a line about its
 * middle, any other mark about the point it is anchored to.
 */
describe('flipping a mark over', () => {
  it('turns an arc over about its middle: left to right its ends change sides, top to bottom it bulges the other way', () => {
    const arrow: KnownDiagramAnnotation = { id: 'a', kind: 'valley-arrow', from: [0.2, 0.3], to: [0.6, 0.5], bend: 0.2 };
    expect(flipCentre(arrow)).toEqual(near([0.4, 0.4]));
    expect(flipAnnotation(arrow, 'horizontal')).toEqual({ ...arrow, from: near([0.6, 0.3]), to: near([0.2, 0.5]), bend: -0.2 });
    expect(flipAnnotation(arrow, 'vertical')).toEqual({ ...arrow, from: near([0.2, 0.5]), to: near([0.6, 0.3]), bend: -0.2 });
    // Twice over is where it was.
    const back = flipAnnotation(flipAnnotation(arrow, 'horizontal'), 'horizontal');
    expect(back).toEqual({ ...arrow, from: near(arrow.from), to: near(arrow.to) });
  });

  it('turns a shaped arrow over about the middle of its nodes, every handle with it', () => {
    const shaped: KnownDiagramAnnotation = {
      id: 's',
      kind: 'mountain-arrow',
      from: [0.2, 0.5],
      to: [0.6, 0.5],
      path: [
        { at: [0.2, 0.5], out: [0.3, 0.2] },
        { at: [0.6, 0.5], in: [0.5, 0.2] },
      ],
    };
    expect(flipAnnotation(shaped, 'vertical').path).toEqual([
      { at: near([0.2, 0.5]), out: near([0.3, 0.8]) },
      { at: near([0.6, 0.5]), in: near([0.5, 0.8]) },
    ]);
  });

  it('turns a fold-and-unfold arrow’s return shaped by hand over with it, about the middle of both', () => {
    const unfold: KnownDiagramAnnotation = {
      id: 'u',
      kind: 'fold-unfold-arrow',
      from: [0.2, 0.5],
      to: [0.6, 0.5],
      path: [
        { at: [0.2, 0.5], out: [0.3, 0.4] },
        { at: [0.6, 0.5], in: [0.5, 0.4] },
      ],
      back: [
        { at: [0.6, 0.5], out: [0.5, 0.65] },
        { at: [0.25, 0.55], in: [0.35, 0.7] },
      ],
    };
    expect(flipCentre(unfold)).toEqual(near([0.4, 0.525]));
    const flipped = flipAnnotation(unfold, 'vertical');
    expect(flipped.back).toEqual([
      { at: near([0.6, 0.55]), out: near([0.5, 0.4]) },
      { at: near([0.25, 0.5]), in: near([0.35, 0.35]) },
    ]);
    expect(flipped.back![0]!.at).toEqual(flipped.to);
    expect(flipChangesMark(unfold, 'vertical')).toBe(true);
  });

  it('steps a pleat arrow’s Zs to the other side, and turns a rotation the other way where it is', () => {
    const pleat: KnownDiagramAnnotation = { id: 'p', kind: 'pleat-arrow', from: [0.2, 0.4], to: [0.6, 0.4] };
    expect(flipAnnotation(pleat, 'horizontal')).toEqual({ ...pleat, from: near([0.6, 0.4]), to: near([0.2, 0.4]), mirrored: true });
    const rotate: KnownDiagramAnnotation = {
      id: 'r',
      kind: 'rotate',
      from: [0.5, 0.5],
      to: [0.5, 0.5],
      rotate: { amount: 'quarter', direction: 'cw' },
    };
    expect(flipAnnotation(rotate, 'vertical')).toEqual({ ...rotate, rotate: { amount: 'quarter', direction: 'ccw' } });
  });

  it('keeps a right angle’s corner and an angle mark’s vertex, turning the way they open', () => {
    const square: KnownDiagramAnnotation = { id: 'q', kind: 'right-angle', ...rightAngleAt([0.5, 0.5], [1, 1]) };
    const turned = flipAnnotation(square, 'horizontal');
    expect(turned.from).toEqual([0.5, 0.5]);
    expect(rightAngleDiagonal(turned)).toEqual(near([-Math.SQRT1_2, Math.SQRT1_2]));
    const mark: KnownDiagramAnnotation = { id: 'm', kind: 'angle-mark', ...angleMarkAt([0.5, 0.5], [0.6, 0.5], [0.5, 0.4])!, ticks: 2 };
    const flipped = flipAnnotation(mark, 'horizontal');
    expect(flipped.from).toEqual([0.5, 0.5]);
    expect(flipped.ticks).toBe(2);
    expect(angleMarkArms(flipped)).toEqual([near([-1, 0]), near([0, -1])]);
  });

  it('keeps a callout’s point and a close-up’s area where they are, the box and the close-up going over to the other side', () => {
    const callout: KnownDiagramAnnotation = { id: 'c', kind: 'callout', from: [0.3, 0.6], to: [0.7, 0.3], text: 'Repeat behind' };
    expect(flipAnnotation(callout, 'horizontal')).toEqual({ ...callout, to: near([-0.1, 0.3]) });
    const zoom: KnownDiagramAnnotation = { id: 'z', kind: 'close-up', from: [0.5, 0.3], to: [1.21, 0.3], radius: 0.08, scale: 2 };
    expect(flipAnnotation(zoom, 'horizontal')).toEqual({ ...zoom, to: near([-0.21, 0.3]), radius: expect.closeTo(0.08, 12) });
  });

  it('turns equal divisions over about the middle of the line they measure, their line kept on its side of the paper (Revision 2)', () => {
    const slant: KnownDiagramAnnotation = { id: 'd', kind: 'divisions', from: [0.2, 0.3], to: [0.6, 0.5], parts: 4, offset: 2.5 };
    expect(flipCentre(slant)).toEqual(near([0.4, 0.4]));
    expect(flipAnnotation(slant, 'horizontal')).toEqual({ ...slant, from: near([0.6, 0.3]), to: near([0.2, 0.5]), mirrored: true });
    expect(flipChangesMark(slant, 'horizontal')).toBe(true);
    // Along a level line, left to right draws it as it was; top to bottom puts the line over.
    const level: KnownDiagramAnnotation = { ...slant, from: [0.2, 0.3], to: [0.6, 0.3] };
    expect(flipChangesMark(level, 'horizontal')).toBe(false);
    expect(flipChangesMark(level, 'vertical')).toBe(true);
    expect(flipAnnotation(level, 'vertical')).toEqual({ ...level, from: near([0.2, 0.3]), to: near([0.6, 0.3]), mirrored: true });
  });

  it('leaves a circle, a label and a turn-over as they are, their point the same either way over; and offers an enlarge area, a star and a shape no Flip', () => {
    expect(ANNOTATION_KINDS.filter((kind) => !flipsOver(kind))).toEqual(['turn-over', 'label', 'circle', 'star', 'zoom', 'oval', 'rectangle']);
    // An oval or a rectangle (Revision 3): a flip of one is only a turn, which its box's handles make.
    const oval: KnownDiagramAnnotation = { id: 'o', kind: 'oval', from: [0.5, 0.5], to: [0.5, 0.5], size: [0.3, 0.1], angle: 30 };
    expect(flipAnnotation(oval, 'horizontal')).toBe(oval);
    // A star keeps its own turn (Revision 3): no Flip, as a circle, and its box turns it.
    const star: KnownDiagramAnnotation = { id: 's', kind: 'star', from: [0.5, 0.5], to: [0.5, 0.5], angle: 20 };
    expect(flipAnnotation(star, 'horizontal')).toBe(star);
    const label: KnownDiagramAnnotation = { id: 'l', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'A' };
    expect(flipAnnotation(label, 'horizontal')).toBe(label);
    expect(flipChangesMark(label, 'vertical')).toBe(false);
    // Not because it has no side: a turned rounded rectangle mirrored would lie at 180° less its angle.
    // Revision 2 gives an area no Flip; its turn comes only from its paper.
    const turned: KnownDiagramAnnotation = { id: 'z', kind: 'zoom', from: [0.5, 0.5], to: [0.5, 0.5], size: [0.3, 0.1], angle: 30 };
    expect(flipAnnotation(turned, 'horizontal')).toBe(turned);
  });

  it('keeps a line’s ends behind a flap with their ends, and says when it would turn over onto itself', () => {
    const line: KnownDiagramAnnotation = { id: 'v', kind: 'valley-line', from: [0.2, 0.7], to: [0.6, 0.7], behind: { from: 2 } };
    expect(flipAnnotation(line, 'horizontal')).toEqual({ ...line, from: near([0.6, 0.7]), to: near([0.2, 0.7]) });
    expect(flipChangesMark(line, 'horizontal')).toBe(true);
    expect(flipChangesMark(line, 'vertical')).toBe(false);
  });
});
