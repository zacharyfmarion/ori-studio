import { describe, expect, it } from 'vitest';
import { face, line, SQUARE } from '../../lib/paper/paperScene.fixtures';
import type { DiagramStep } from '../document/diagramDocument';
import { nearestLine } from './nearestLine';
import { annotation, FLAT, NO_ASSETS, sceneStep, uploadStep } from './pictureSnap.fixtures';

/** A line as a sorted pair of points, whichever way it was found. */
const ends = (found: { a: readonly number[]; b: readonly number[] } | null) =>
  found && [found.a, found.b].map((point) => point.map((value) => Number(value.toFixed(9)) + 0)).sort();

describe('nearestLine (15b, Revision 2)', () => {
  // The rim has a point halfway along its top side, where a crease meets it: two pieces of one edge.
  const rim = sceneStep([
    face([[[0, 0], [50, 0], [100, 0], [100, 100], [0, 100]]]),
    line('diagram-valley', [50, 0], [50, 40]),
  ]);

  it('takes the piece under a press, as the Angle Bisector picks it', () => {
    expect(ends(nearestLine(rim, NO_ASSETS, undefined, [0.25, 0.005], 0.02))).toEqual([
      [0, 0],
      [0.5, 0],
    ]);
    expect(nearestLine(rim, NO_ASSETS, undefined, [0.25, 0.1], 0.02)).toBeNull();
  });

  it('takes a crease pattern’s rim whole, run on through the piece where a crease meets it, and no further round a corner', () => {
    const presses: [number, number][] = [
      [0.25, 0.005],
      [0.75, 0.005],
    ];
    for (const at of presses) {
      expect(ends(nearestLine(rim, NO_ASSETS, undefined, at, 0.02, { whole: true }))).toEqual([
        [0, 0],
        [1, 0],
      ]);
    }
    // The crease that meets it is a line of its own.
    expect(ends(nearestLine(rim, NO_ASSETS, undefined, [0.505, 0.2], 0.02, { whole: true }))).toEqual([
      [0.5, 0],
      [0.5, 0.4],
    ]);
  });

  it('takes a flat fold’s covered face’s edge whole, under the flap laid over half of it', () => {
    // The sheet, and a flap folded down over its top half: the flap's left edge
    // lies over the top half of the sheet's, and its bottom edge across the sheet.
    const flat: DiagramStep = sceneStep([face([SQUARE]), face([[[0, 0], [100, 0], [100, 50], [0, 50]]])], FLAT);
    const presses: [number, number][] = [
      [0.002, 0.25],
      [0.002, 0.75],
    ];
    for (const at of presses) {
      expect(ends(nearestLine(flat, NO_ASSETS, undefined, at, 0.02, { whole: true }))).toEqual([
        [0, 0],
        [0, 1],
      ]);
    }
    expect(ends(nearestLine(flat, NO_ASSETS, undefined, [0.5, 0.502], 0.02, { whole: true }))).toEqual([
      [0, 0.5],
      [1, 0.5],
    ]);
  });

  it('takes a line drawn on an upload, which has no lines of its own', () => {
    const { step, assets } = uploadStep();
    const drawn = annotation({ kind: 'mountain-line', from: [0.2, 0.3], to: [0.8, 0.3] });
    const annotated = { ...step, annotations: [drawn] };
    expect(ends(nearestLine(annotated, assets, undefined, [0.5, 0.31], 0.02, { whole: true }))).toEqual([
      [0.2, 0.3],
      [0.8, 0.3],
    ]);
    expect(nearestLine(step, assets, undefined, [0.5, 0.31], 0.02, { whole: true })).toBeNull();
  });
});
