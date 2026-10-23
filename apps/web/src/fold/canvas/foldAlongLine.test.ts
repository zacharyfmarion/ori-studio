import { describe, expect, it } from 'vitest';
import type { FoldScene } from '../engine/foldEngineWire';
import { bookScene, flatSquareLandmarks, flatSquareScene } from './foldCanvas.fixtures';
import { foldAlongLine, resolveAlongPick } from './foldAlongLine';
import { foldPickIndex } from './foldPicking';

const RADII = { point: 0.03, line: 0.03 };
/** y = 0.5, across the sheet. */
const ACROSS = { n: [0, 1] as [number, number], d: 0.5 };

const near = (actual: readonly [number, number] | undefined, expected: [number, number]) => {
  expect(actual?.[0]).toBeCloseTo(expected[0], 9);
  expect(actual?.[1]).toBeCloseTo(expected[1], 9);
};

/** The book, with a short valley mark across y = 0.5 on its right half, where it lies on the sheet. */
function bookWithMark(): FoldScene {
  return {
    ...bookScene(),
    crease_marks: [{ from: { x: 0.75, y: 0.4 }, to: { x: 0.75, y: 0.6 }, letter: 'valley', made_at: 2, pieces: [] }],
  };
}

describe('points along a located line', () => {
  it('runs across the folded form and snaps to where it crosses an edge, and to its middle', () => {
    const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
    const along = foldAlongLine(index, ACROSS, 'folded');
    expect(along.pieces).toHaveLength(1);
    // The left edge's middle is a landmark of its own; the line's middle is the sheet's centre.
    const edge = resolveAlongPick(index, along, { x: 0.01, y: 0.51 }, RADII, false);
    expect(edge).toMatchObject({ kind: 'point', provenance: 'midpoint' });
    near(edge?.sheet, [0, 0.5]);
    const middle = resolveAlongPick(index, along, { x: 0.49, y: 0.52 }, RADII, false);
    expect(middle).toMatchObject({ provenance: 'midpoint' });
    near(middle?.sheet, [0.5, 0.5]);
    // Between targets, nothing — unless the point is put down free, on the line where it is.
    expect(resolveAlongPick(index, along, { x: 0.3, y: 0.52 }, RADII, false)).toBeNull();
    const free = resolveAlongPick(index, along, { x: 0.3, y: 0.52 }, RADII, true);
    expect(free).toMatchObject({ provenance: 'free' });
    near(free?.sheet, [0.3, 0.5]);
    // Off the line, nothing at all.
    expect(resolveAlongPick(index, along, { x: 0.3, y: 0.6 }, RADII, true)).toBeNull();
  });

  it('keeps to the paper on the folded form', () => {
    const index = foldPickIndex(bookScene(), null, []);
    const along = foldAlongLine(index, ACROSS, 'folded');
    // The book is the left half: the line runs over it alone.
    expect(along.pieces).toHaveLength(1);
    expect(along.pieces[0]?.[1].x).toBeCloseTo(0.5, 12);
    // Just past the folded edge is the folded edge; well past it, no paper.
    const edge = resolveAlongPick(index, along, { x: 0.52, y: 0.5 }, RADII, false);
    expect(edge?.scene?.x).toBeCloseTo(0.5, 9);
    expect(resolveAlongPick(index, along, { x: 0.8, y: 0.5 }, RADII, true)).toBeNull();
    // The middle of its stretch, named on the layer on top: the right half, mirrored.
    const middle = resolveAlongPick(index, along, { x: 0.25, y: 0.5 }, RADII, false);
    near(middle?.sheet, [0.75, 0.5]);
  });

  it('is a piece on every face it crosses on the crease pattern, a pinch there through both layers', () => {
    const index = foldPickIndex(bookWithMark(), null, []);
    const along = foldAlongLine(index, ACROSS, 'crease-pattern');
    // One piece on each half of the sheet.
    expect(along.pieces).toHaveLength(2);
    // The middle of the folded stretch lies on both layers: (0.25, 0.5) on the left half, (0.75, 0.5) on the right.
    const left = resolveAlongPick(index, along, { x: 0.26, y: 0.49 }, RADII, false);
    expect(left).toMatchObject({ provenance: 'midpoint' });
    near(left?.sheet, [0.25, 0.5]);
    expect(left?.scene?.x).toBeCloseTo(0.25, 9);
    // On the right half the mark crosses there first: it names the point.
    const right = resolveAlongPick(index, along, { x: 0.76, y: 0.51 }, RADII, false);
    expect(right).toMatchObject({ provenance: 'crease-mark-crossing' });
    near(right?.sheet, [0.75, 0.5]);
    // Drawn on the folded form where that layer lies.
    expect(right?.scene?.x).toBeCloseTo(0.25, 9);
  });
});
