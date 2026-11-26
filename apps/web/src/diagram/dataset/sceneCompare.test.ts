import { describe, expect, it } from 'vitest';
import type { PaperFaceItem, PaperLineItem, PaperScene } from '@treemaker/origami-simulator';
import { compareScenes, orderFreeDigest, sceneCounts } from './sceneCompare';

const face = (x: number): PaperFaceItem =>
  ({ kind: 'face', face: 0, side: 'front', rings: [[[x, 0], [x + 10, 0], [x + 10, 10]]] }) as PaperFaceItem;
const line = (role: PaperLineItem['role'], x: number): PaperLineItem => ({
  kind: 'line',
  role,
  a: [x, 0],
  b: [x, 10],
  onBoundary: [false, false],
  hidden: false,
});
// A 400 px sheet: stored at a step of 0.01 px.
const scene = (...items: PaperScene['items']): PaperScene => ({
  bounds: { minX: 0, minY: 0, maxX: 400, maxY: 400 },
  sheet: 400,
  items,
});

describe('compareScenes', () => {
  const base = scene(face(0), line('valley', 5), line('aux', 7));

  it('finds the same scene the same', () => {
    expect(compareScenes(base, scene(face(0), line('valley', 5), line('aux', 7)))).toEqual({ kind: 'same' });
  });

  it('calls a point one snap step over rounding, not a change', () => {
    expect(compareScenes(base, scene(face(0), line('valley', 5.01), line('aux', 7)))).toEqual({ kind: 'rounding' });
  });

  it('tells the same items in another order', () => {
    const reordered = scene(face(0), line('aux', 7), line('valley', 5.01));
    expect(compareScenes(base, reordered)).toEqual({ kind: 'order' });
    expect(orderFreeDigest(scene(face(0), line('aux', 7), line('valley', 5)))).toBe(orderFreeDigest(base));
  });

  it('counts items by kind, role and side', () => {
    const added = scene(face(0), line('valley', 5), line('aux', 7), line('aux', 9));
    expect(compareScenes(base, added)).toEqual({
      kind: 'items',
      before: sceneCounts(base),
      after: { 'face:front': 1, 'line:aux': 2, 'line:valley': 1 },
    });
  });

  it('calls a move past a snap step geometry, however the items are ordered', () => {
    expect(compareScenes(base, scene(face(0), line('aux', 7), line('valley', 5.5)))).toEqual({ kind: 'geometry', unmatched: 1 });
  });

  it('holds every field but the coordinates exactly', () => {
    const flagged: PaperLineItem = { ...line('aux', 7), onBoundary: [true, false] };
    expect(compareScenes(base, scene(face(0), line('valley', 5), flagged))).toEqual({ kind: 'geometry', unmatched: 1 });
  });
});
