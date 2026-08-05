import { describe, expect, it } from 'vitest';
import { boxCornerEdges, viewAlignedBoxCorners } from './viewAlignedBox';
import { projectModelPoint, userCameraToView } from '../renderer/camera';
import type { ViewTransform, Viewport } from '../renderer/types';

const vp: Viewport = { width: 800, height: 600, dpr: 1 };
const viewAt = (rotation: number): ViewTransform =>
  userCameraToView({ centerX: 0, centerY: 0, zoom: 2, rotation }, vp);

/** Device-space corners of a quad, for asserting screen-alignment. */
const onScreen = (view: ViewTransform, corners: readonly { x: number; y: number }[]) =>
  corners.map((corner) => projectModelPoint(view, corner.x, corner.y));

describe('viewAlignedBoxCorners', () => {
  it('is model-axis-aligned with no view, in perimeter order', () => {
    expect(viewAlignedBoxCorners({ x: 0, y: 0 }, { x: 10, y: 4 }, null)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 4 },
      { x: 10, y: 4 },
      { x: 10, y: 0 },
    ]);
  });

  it('matches the model-aligned box under an unrotated view', () => {
    // The regression guard: at rotation 0 the new path must produce exactly what
    // the old one did, so nothing changes for the overwhelmingly common case.
    const corners = viewAlignedBoxCorners({ x: 0, y: 0 }, { x: 10, y: 4 }, viewAt(0));
    const expected = viewAlignedBoxCorners({ x: 0, y: 0 }, { x: 10, y: 4 }, null);
    corners.forEach((corner, i) => {
      expect(corner.x).toBeCloseTo(expected[i].x);
      expect(corner.y).toBeCloseTo(expected[i].y);
    });
  });

  it('is upright on screen at every rotation', () => {
    // The whole point: whatever the view angle, the box the user sees is a
    // screen-axis-aligned rectangle through the two drag corners.
    for (const rotation of [0, Math.PI / 8, Math.PI / 4, Math.PI / 2, -Math.PI / 3, 2.4]) {
      const view = viewAt(rotation);
      const a = { x: -30, y: 12 };
      const b = { x: 45, y: -20 };
      const [p0, p1, p2, p3] = onScreen(view, viewAlignedBoxCorners(a, b, view));
      // Edges 0-1 and 2-3 are vertical on screen; 1-2 and 3-0 are horizontal.
      expect(p0.x).toBeCloseTo(p1.x);
      expect(p2.x).toBeCloseTo(p3.x);
      expect(p1.y).toBeCloseTo(p2.y);
      expect(p3.y).toBeCloseTo(p0.y);
      // And it still spans the drag: corners 0 and 2 are the pressed diagonal.
      const da = projectModelPoint(view, a.x, a.y);
      const db = projectModelPoint(view, b.x, b.y);
      expect(p0.x).toBeCloseTo(da.x);
      expect(p0.y).toBeCloseTo(da.y);
      expect(p2.x).toBeCloseTo(db.x);
      expect(p2.y).toBeCloseTo(db.y);
    }
  });

  it('is a rotated quadrilateral in model space when the view is turned', () => {
    // The counterpart of the above, and the thing the old model-aligned box
    // could not express: at 45 degrees the model-space box is a diamond.
    const view = viewAt(Math.PI / 4);
    const corners = viewAlignedBoxCorners({ x: 0, y: 0 }, { x: 10, y: 0 }, view);
    const edge = { x: corners[1].x - corners[0].x, y: corners[1].y - corners[0].y };
    expect(Math.abs(edge.x)).toBeGreaterThan(1e-6);
    expect(Math.abs(edge.y)).toBeGreaterThan(1e-6);
    expect(Math.abs(edge.x)).toBeCloseTo(Math.abs(edge.y));
  });

  it('keeps perimeter order under a mirrored view', () => {
    // A flip reverses winding but must not reorder the corners into a bowtie:
    // consecutive entries still share an edge.
    const mirrored: ViewTransform = { origin: [0, 0], ex: [-2, 0], ey: [0, 2] };
    const [p0, p1, p2, p3] = onScreen(
      mirrored,
      viewAlignedBoxCorners({ x: 1, y: 2 }, { x: 9, y: 7 }, mirrored)
    );
    expect(p0.x).toBeCloseTo(p1.x);
    expect(p1.y).toBeCloseTo(p2.y);
    expect(p2.x).toBeCloseTo(p3.x);
    expect(p3.y).toBeCloseTo(p0.y);
  });

  it('handles a flat drag as four collinear corners rather than failing', () => {
    // A straight drag holds one screen axis exactly. The box is degenerate, and
    // must stay a well-formed four-corner list — the kernel still selects along it.
    const corners = viewAlignedBoxCorners({ x: 3, y: 1 }, { x: 3, y: 9 }, viewAt(0));
    expect(corners).toHaveLength(4);
    corners.forEach((corner) => expect(corner.x).toBeCloseTo(3));
  });

  it('falls back to the model-aligned box for a degenerate view', () => {
    const degenerate: ViewTransform = { origin: [0, 0], ex: [0, 0], ey: [0, 0] };
    expect(viewAlignedBoxCorners({ x: 0, y: 0 }, { x: 2, y: 3 }, degenerate)).toEqual(
      viewAlignedBoxCorners({ x: 0, y: 0 }, { x: 2, y: 3 }, null)
    );
  });
});

describe('boxCornerEdges', () => {
  it('walks the perimeter and closes the loop', () => {
    const corners = viewAlignedBoxCorners({ x: 0, y: 0 }, { x: 10, y: 4 }, null);
    expect(boxCornerEdges(corners)).toEqual([
      { a: { x: 0, y: 0 }, b: { x: 0, y: 4 } },
      { a: { x: 0, y: 4 }, b: { x: 10, y: 4 } },
      { a: { x: 10, y: 4 }, b: { x: 10, y: 0 } },
      { a: { x: 10, y: 0 }, b: { x: 0, y: 0 } },
    ]);
  });
});
