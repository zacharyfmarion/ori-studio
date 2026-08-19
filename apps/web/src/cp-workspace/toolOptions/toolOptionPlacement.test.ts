import { describe, expect, it } from 'vitest';

import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import { FRAME_PADDING_CSS, toolOptionFrame, toolOptionHeaderOffset } from './toolOptionPlacement';
import { boundsOfPoints } from './toolOptionWindow';

/** Model space scaled by `scale`, with the origin at `origin`. */
function view(scale: number, origin: [number, number] = [0, 0]): CpOverlayView {
  return { origin, ex: [scale, 0], ey: [0, scale] } as CpOverlayView;
}

/** A quarter turn, which is what makes the four-corner projection load-bearing. */
function rotatedView(scale: number): CpOverlayView {
  return { origin: [0, 0], ex: [0, scale], ey: [-scale, 0] } as CpOverlayView;
}

const BOUNDS = { minX: 0, minY: 0, maxX: 100, maxY: 50 };

describe('toolOptionFrame', () => {
  it('encloses the geometry with a constant screen-space margin', () => {
    const frame = toolOptionFrame(view(1), BOUNDS);
    expect(frame.left).toBe(-FRAME_PADDING_CSS);
    expect(frame.top).toBe(-FRAME_PADDING_CSS);
    expect(frame.width).toBe(100 + FRAME_PADDING_CSS * 2);
    expect(frame.height).toBe(50 + FRAME_PADDING_CSS * 2);
  });

  it('scales with the camera, because it surrounds model-space geometry', () => {
    // The opposite of the chrome rule below. A frame that held one screen size
    // would stop surrounding the creases the moment you zoomed, which is the
    // only thing it is for.
    const frame = toolOptionFrame(view(3), BOUNDS);
    expect(frame.width).toBe(300 + FRAME_PADDING_CSS * 2);
    expect(frame.height).toBe(150 + FRAME_PADDING_CSS * 2);
  });

  it('uses all four corners, so a rotated view still frames the geometry', () => {
    // Under a quarter turn a box built from min/max of two corners is the wrong
    // rectangle — it would cut the geometry on one diagonal.
    const frame = toolOptionFrame(rotatedView(1), BOUNDS);
    expect(frame.width).toBe(50 + FRAME_PADDING_CSS * 2);
    expect(frame.height).toBe(100 + FRAME_PADDING_CSS * 2);
  });

  it('holds a minimum size, centred on the geometry', () => {
    // Three short creases at low zoom project to almost nothing; a frame that
    // collapsed onto them would read as a smudge.
    const degenerate = { minX: 10, minY: 10, maxX: 10, maxY: 10 };
    const frame = toolOptionFrame(view(1), degenerate);
    expect(frame.width).toBeGreaterThanOrEqual(48);
    expect(frame.height).toBeGreaterThanOrEqual(48);
    expect(frame.left + frame.width / 2).toBeCloseTo(10, 6);
    expect(frame.top + frame.height / 2).toBeCloseTo(10, 6);
  });
});

describe('toolOptionHeaderOffset', () => {
  const viewport = { width: 1000, height: 800 };
  const HEADER = 30;

  it('sits on top of the frame, attached to its edge', () => {
    // Not floating near it: the offset is exactly the header's own height, so
    // the two share an edge and read as one window.
    const offset = toolOptionHeaderOffset(
      { left: 200, top: 300, width: 400, height: 200 },
      HEADER,
      viewport,
    );
    expect(offset).toBe(-HEADER);
  });

  it('drops just inside the frame when there is no room above', () => {
    // Not below: below would cover whatever is outside the frame, while inside
    // overlaps only the region the user is already looking at. Still attached
    // to the same edge either way.
    const offset = toolOptionHeaderOffset(
      { left: 200, top: 4, width: 400, height: 300 },
      HEADER,
      viewport,
    );
    expect(offset).toBe(0);
  });

  it('does not scale with the camera', () => {
    // Chrome, not content: a header that grew with the zoom would fill the
    // viewport at 800%. Only the frame it is attached to scales.
    const near = toolOptionFrame(view(1, [200, 200]), BOUNDS);
    const far = toolOptionFrame(view(4, [200, 200]), BOUNDS);
    expect(far.width).toBeGreaterThan(near.width);
    expect(toolOptionHeaderOffset(near, HEADER, viewport)).toBe(
      toolOptionHeaderOffset(far, HEADER, viewport),
    );
  });
});

describe('boundsOfPoints', () => {
  it('encloses every point', () => {
    expect(
      boundsOfPoints([
        { x: 1, y: 5 },
        { x: -3, y: 2 },
        { x: 4, y: -1 },
      ]),
    ).toEqual({ minX: -3, minY: -1, maxX: 4, maxY: 5 });
  });

  it('is null with nothing to enclose, and skips non-finite points', () => {
    expect(boundsOfPoints([])).toBeNull();
    expect(boundsOfPoints([{ x: Number.NaN, y: 0 }])).toBeNull();
  });
});
