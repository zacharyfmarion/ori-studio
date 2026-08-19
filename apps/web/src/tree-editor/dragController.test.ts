import { describe, expect, it } from 'vitest';
import { startTreeDrag } from './dragController';
import { reflectPointAcrossSymmetryAxis } from '../lib/symmetryGeometry';
import type { Point } from '../lib/geometry';

/**
 * What the drag shows while it is happening.
 *
 * The rule that decides where vertices go is tested in `dragRule.test.ts`; this
 * is about the half the controller owns — that the preview shows everything the
 * commit will do. A mirrored partner used to be added only by the commit, so it
 * sat still through the whole gesture and jumped into place on release.
 */

/** Vertical mirror through the origin. */
const AXIS = { loc: { x: 0, y: 0 }, angle: 90 };

//   0 (root, on the mirror) --- 1 (right)      2 (left, 1's partner)
const VERTICES = new Map<number, Point>([
  [0, { x: 0, y: 0 }],
  [1, { x: 2, y: 0 }],
  [2, { x: -2, y: 0 }],
]);

const CONTINUOUS = {
  current: 2,
  min: 0.1,
  max: null,
  step: null,
  quantize: (distance: number) => distance,
};

function drag(options: Partial<Parameters<typeof startTreeDrag>[0]> = {}) {
  return startTreeDrag({
    // No scene to write: `collectTreeSceneTargets` finds nothing and the DOM
    // pass is a no-op, which leaves the session's own updates as the subject.
    root: document.createDocumentFragment(),
    vertexId: 1,
    parentId: 0,
    vertices: VERTICES,
    subtreeIds: [1],
    length: CONTINUOUS,
    clientStart: { x: 0, y: 0 },
    // Client pixels are tree units here, so the assertions can name positions.
    toTreePoint: (client) => client,
    toSvgPoint: (loc) => loc,
    chromePx: (px) => px,
    // Synchronous, so a sample is applied by the time `move` returns.
    schedule: (callback) => {
      callback();
      return 0;
    },
    unschedule: () => {},
    ...options,
  });
}

describe('startTreeDrag — the mirrored partner moves with the gesture', () => {
  const reflect = (updates: ReadonlyMap<number, Point>) => {
    const out = new Map<number, Point>();
    const loc = updates.get(1);
    if (loc) out.set(2, reflectPointAcrossSymmetryAxis(loc, AXIS));
    return out;
  };

  it('carries the partner in the same sample, not on release', () => {
    const session = drag({ reflect, reflectedIds: [2] });
    session.move({ x: 0, y: 3 });

    const dragged = session.updates.get(1);
    const partner = session.updates.get(2);
    expect(dragged).toBeDefined();
    // The whole point: the partner is already in this sample's updates.
    expect(partner).toBeDefined();
    expect(partner!.x).toBeCloseTo(-dragged!.x, 12);
    expect(partner!.y).toBeCloseTo(dragged!.y, 12);
  });

  it('keeps the partner mirrored across every sample of the gesture', () => {
    const session = drag({ reflect, reflectedIds: [2] });
    for (const at of [
      { x: 1, y: 1 },
      { x: 3, y: -2 },
      { x: 0.5, y: 4 },
    ]) {
      session.move(at);
      const dragged = session.updates.get(1)!;
      const partner = session.updates.get(2)!;
      expect(partner.x).toBeCloseTo(-dragged.x, 12);
      expect(partner.y).toBeCloseTo(dragged.y, 12);
    }
  });

  it('moves only the subtree when nothing is paired', () => {
    const session = drag();
    session.move({ x: 0, y: 3 });
    expect(session.updates.get(1)).toBeDefined();
    expect(session.updates.has(2)).toBe(false);
  });
});

describe('startTreeDrag — a vertex pinned to the mirror', () => {
  it('slides along the line rather than following the cursor off it', () => {
    // Vertex 1 pinned, dragged well to the right of the mirror.
    const session = drag({ pinToAxis: AXIS, vertices: VERTICES });
    session.move({ x: 9, y: 3 });
    const moved = session.updates.get(1);
    expect(moved).toBeDefined();
    expect(moved!.x).toBeCloseTo(0, 12);
    expect(moved!.y).toBeCloseTo(3, 12);
  });
});
