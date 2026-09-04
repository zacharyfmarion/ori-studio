import { describe, expect, it } from 'vitest';
import {
  boxContainsModelPoint,
  overlayCssDeltaToModel,
} from '../annotations/annotationTransform';
import { viewAlignedBoxCorners } from '../tools/viewAlignedBox';
import { cpSuppressionBoxFromCommitPoints } from './suppressionBox';

/**
 * A camera turned by `angle`. `ViewTransform` and `CpOverlayView` are the same
 * `{origin, ex, ey}` affine in two spaces (device px / CSS px), so one object
 * serves both sides of the conversion — which is the point: the corners the tool
 * builds through the first and the rotation the box stores through the second
 * have to describe one rectangle.
 */
function cameraAt(angle: number, scale = 4) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    origin: [17, 23] as const,
    ex: [scale * cos, scale * sin] as const,
    ey: [-scale * sin, scale * cos] as const,
  };
}

describe('cpSuppressionBoxFromCommitPoints', () => {
  it('returns the model-aligned box for a two-point (no view) commit', () => {
    const box = cpSuppressionBoxFromCommitPoints(
      [
        { x: 10, y: 4 },
        { x: 30, y: 24 },
      ],
      null
    );
    expect(box).toEqual({ center: { x: 20, y: 14 }, width: 20, height: 20, rotation: 0 });
  });

  it('reads the diagonal in either direction', () => {
    const forward = cpSuppressionBoxFromCommitPoints(
      [
        { x: 0, y: 0 },
        { x: 8, y: 6 },
      ],
      null
    );
    const reverse = cpSuppressionBoxFromCommitPoints(
      [
        { x: 8, y: 6 },
        { x: 0, y: 0 },
      ],
      null
    );
    expect(reverse).toEqual(forward);
  });

  it('measures width along the screen-horizontal edge and height along the vertical one', () => {
    // Unrotated: the four corners reduce to the model-aligned rect, so both
    // commit shapes must produce the same box.
    const corners = viewAlignedBoxCorners({ x: 0, y: 0 }, { x: 30, y: 10 }, null);
    const box = cpSuppressionBoxFromCommitPoints(corners, null);
    expect(box).toEqual({ center: { x: 15, y: 5 }, width: 30, height: 10, rotation: 0 });
  });

  it('stores the view rotation and covers exactly the dragged rectangle', () => {
    const angle = Math.PI / 6;
    const view = cameraAt(angle);
    const corners = viewAlignedBoxCorners({ x: -20, y: -5 }, { x: 40, y: 35 }, view);
    const box = cpSuppressionBoxFromCommitPoints(corners, view);
    expect(box).not.toBeNull();
    if (!box) return;
    // `uprightRotationForView` is −θ: a box is anchored to the paper, so it
    // carries the camera's rotation backwards to look square on screen.
    expect(box.rotation).toBeCloseTo(-angle, 12);
    // Every committed corner lies on the stored box's boundary — grow it by a
    // hair and all four are inside, shrink it and they are all outside. That is
    // the box *being* the rectangle drawn, not merely containing it.
    const grown = { ...box, width: box.width + 1e-6, height: box.height + 1e-6 };
    const shrunk = { ...box, width: box.width - 1e-3, height: box.height - 1e-3 };
    for (const corner of corners) {
      expect(boxContainsModelPoint(grown, corner)).toBe(true);
      expect(boxContainsModelPoint(shrunk, corner)).toBe(false);
    }
  });

  it('is unaffected by which diagonal corner the drag started from', () => {
    const view = cameraAt(0.7);
    const a = { x: 3, y: 11 };
    const b = { x: 27, y: -4 };
    const forward = cpSuppressionBoxFromCommitPoints(viewAlignedBoxCorners(a, b, view), view);
    const reverse = cpSuppressionBoxFromCommitPoints(viewAlignedBoxCorners(b, a, view), view);
    expect(forward).not.toBeNull();
    expect(reverse?.center.x).toBeCloseTo(forward?.center.x ?? NaN, 10);
    expect(reverse?.center.y).toBeCloseTo(forward?.center.y ?? NaN, 10);
    expect(reverse?.width).toBeCloseTo(forward?.width ?? NaN, 10);
    expect(reverse?.height).toBeCloseTo(forward?.height ?? NaN, 10);
  });

  it('rejects a commit with no area, in both shapes', () => {
    // A perfectly horizontal drag: `dragBoxTool` still commits it (only a
    // zero-*length* gesture is dropped), so the rejection has to happen here.
    expect(
      cpSuppressionBoxFromCommitPoints(
        [
          { x: 0, y: 5 },
          { x: 20, y: 5 },
        ],
        null
      )
    ).toBeNull();
    // Degenerate is a *screen*-space question once a view is involved: a drag
    // that is flat in model space spans a real rectangle under a rotated camera,
    // and only one that is flat on screen collapses. So the flat drag has to be
    // built along the model direction of screen +x.
    const view = cameraAt(0.3);
    const alongScreenX = overlayCssDeltaToModel(view, { x: 1, y: 0 });
    expect(alongScreenX).not.toBeNull();
    if (!alongScreenX) return;
    const from = { x: 4, y: 9 };
    const to = { x: from.x + 30 * alongScreenX.x, y: from.y + 30 * alongScreenX.y };
    const flat = viewAlignedBoxCorners(from, to, view);
    expect(cpSuppressionBoxFromCommitPoints(flat, view)).toBeNull();
  });

  it('keeps a model-flat drag that is not screen-flat', () => {
    // The other half of the same point: rotate the camera and a horizontal drag
    // is a genuine box, so rejecting on the model delta would throw it away.
    const view = cameraAt(0.3);
    const corners = viewAlignedBoxCorners({ x: 0, y: 5 }, { x: 20, y: 5 }, view);
    const box = cpSuppressionBoxFromCommitPoints(corners, view);
    expect(box).not.toBeNull();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
  });

  it('rejects a commit with too few points', () => {
    expect(cpSuppressionBoxFromCommitPoints([], null)).toBeNull();
    expect(cpSuppressionBoxFromCommitPoints([{ x: 1, y: 1 }], null)).toBeNull();
  });
});
