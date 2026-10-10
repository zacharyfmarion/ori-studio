/**
 * Snapping on real step pictures (`snapPictures.fixtures.ts`), each held to
 * the picture read the long way, independently of the index: every target
 * snapped to is the nearest point the picture offers, and nothing within
 * reach is missed.
 */
import { describe, expect, it } from 'vitest';
import type { PicturePoint } from './annotationModel';
import { NO_ASSETS } from './pictureSnap.fixtures';
import { pictureSnapTarget } from './pictureSnap';
import {
  allCrossings,
  distance,
  onSegment,
  pointerGrid,
  readLongWay,
  REAL_PICTURES,
  realPicture,
} from './snapPictures.fixtures';

describe.each(REAL_PICTURES)('snapping on $name', ({ step }) => {
  const truth = readLongWay(step);
  const offered = [...truth.points, ...(truth.crossings ? allCrossings(truth.segments) : [])];
  const RADIUS = 0.04;

  it('lands only on the nearest point the picture offers, and misses none within reach', () => {
    let snapped = 0;
    for (const pointer of pointerGrid(0.013)) {
      const target = pictureSnapTarget(step, NO_ASSETS, pointer, RADIUS);
      const nearest = Math.min(...offered.map((at) => distance(at, pointer)));
      if (nearest > RADIUS + 1e-9) {
        expect(target).toBeNull();
        continue;
      }
      expect(target).not.toBeNull();
      if (!target) continue;
      snapped += 1;
      // A point of the picture's own, or a crossing of two of its segments.
      if (target.kind === 'crossing') {
        expect(truth.segments.filter((segment) => onSegment(target.at, segment)).length).toBeGreaterThanOrEqual(2);
      } else {
        expect(Math.min(...truth.points.map((at) => distance(at, target.at)))).toBeLessThan(1e-4);
      }
      // The nearest, give or take two points the stored picture rounded apart.
      expect(distance(target.at, pointer)).toBeLessThanOrEqual(nearest + 1e-4);
    }
    expect(snapped).toBeGreaterThan(0);
  });
});

describe('snapping on real pictures, by kind', () => {
  it('names the crane pattern’s paper corners, its paper turned to a diamond', () => {
    const step = realPicture('crane crease pattern');
    const tips: PicturePoint[] = [
      [0.5, 0],
      [1, 0.5],
      [0.5, 1],
      [0, 0.5],
    ];
    for (const [x, y] of tips) {
      expect(pictureSnapTarget(step, NO_ASSETS, [x + 0.01, y - 0.005], 0.03)).toMatchObject({ kind: 'corner' });
    }
  });

  it('calls the flat folds’ ring corners vertices: a fold cannot say which were the paper’s', () => {
    const step = realPicture('crane flat fold, back');
    const truth = readLongWay(step);
    for (const at of truth.points) {
      expect(pictureSnapTarget(step, NO_ASSETS, at, 0.01)).toMatchObject({ kind: 'vertex' });
    }
  });

  it('snaps to a References step’s marks where its back draws them', () => {
    // Its marks are at the model's (0, 0) and (1, 1): mirrored and y down, (1, 1) and (0, 0).
    const back = realPicture('crane References step, back');
    expect(pictureSnapTarget(back, NO_ASSETS, [0.98, 0.99], 0.05)).toEqual({ at: [1, 1], kind: 'point' });
    expect(pictureSnapTarget(back, NO_ASSETS, [0.02, 0.01], 0.05)).toMatchObject({ kind: 'point' });
    // The front's marks: (0, 0), (1, 0) and (0, 1), y down.
    const front = realPicture('crane References step');
    expect(pictureSnapTarget(front, NO_ASSETS, [0.02, 0.98], 0.05)).toMatchObject({ at: [0, 1], kind: 'point' });
  });
});
