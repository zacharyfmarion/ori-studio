/**
 * Right angles on real step pictures (`snapPictures.fixtures.ts`): each one
 * found is square and runs along two of the picture's own lines, and a 3D
 * picture offers none.
 */
import { describe, expect, it } from 'vitest';
import type { PicturePoint } from './annotationModel';
import { NO_ASSETS } from './pictureSnap.fixtures';
import { rightAngleCorner, rightAnglesAt } from './rightAngles';
import { distance, onSegment, pointerGrid, readLongWay, realPicture, square } from './snapPictures.fixtures';

/** The picture's points, each once. */
function verticesOf(points: readonly PicturePoint[]): PicturePoint[] {
  return points.filter((at, index) => points.findIndex((other) => distance(other, at) < 1e-6) === index);
}

describe('right angles on real pictures', () => {
  it('finds box_90’s at its grid vertices, each square and along two of its lines', () => {
    const step = realPicture('box_90 crease pattern');
    const truth = readLongWay(step);
    let found = 0;
    for (const vertex of verticesOf(truth.points)) {
      for (const corner of rightAnglesAt(step, NO_ASSETS, vertex)) {
        found += 1;
        expect(square(...corner.legs)).toBe(true);
        for (const leg of corner.legs) {
          // A short way along each leg is still on a line of the pattern.
          const along: PicturePoint = [vertex[0] + 0.01 * leg[0], vertex[1] + 0.01 * leg[1]];
          expect(truth.segments.some((segment) => onSegment(along, segment))).toBe(true);
        }
      }
    }
    // Counted by hand: the two rim corners no diagonal halves, six where
    // creases meet the rim's sides, and eight at the three vertices inside.
    expect(found).toBe(16);
    // The pointer finds the one at the top-left corner, which no crease leaves.
    expect(rightAngleCorner(step, NO_ASSETS, [0.03, 0.03], 0.06)).toMatchObject({ at: [0, 0] });
  });

  it('finds the crane pattern’s where its creases meet the rim square, and none at its eight-way middle', () => {
    const step = realPicture('crane crease pattern');
    expect(rightAnglesAt(step, NO_ASSETS, [0.5, 0.5])).toEqual([]);
    // The diamond's sides' midpoints, two each.
    for (const at of [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.75, 0.75],
      [0.25, 0.75],
    ] as PicturePoint[]) {
      const corners = rightAnglesAt(step, NO_ASSETS, at);
      expect(corners).toHaveLength(2);
      for (const corner of corners) expect(square(...corner.legs)).toBe(true);
    }
  });

  it('finds the flat folds’ only where their rings and lines turn square', () => {
    for (const name of ['crane flat fold', 'crane flat fold, back', 'crane flat fold, legs']) {
      const step = realPicture(name);
      for (const at of verticesOf(readLongWay(step).points)) {
        for (const corner of rightAnglesAt(step, NO_ASSETS, at)) expect(square(...corner.legs)).toBe(true);
      }
    }
  });

  it('finds none in box_90’s 3D picture, its own lines drawn through a camera', () => {
    const step = realPicture('box_90 3D');
    for (const at of readLongWay(step).points) expect(rightAnglesAt(step, NO_ASSETS, at)).toEqual([]);
    for (const pointer of pointerGrid(0.05)) expect(rightAngleCorner(step, NO_ASSETS, pointer, 0.1)).toBeNull();
  });
});
