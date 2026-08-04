import { describe, expect, it } from 'vitest';

import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import {
  FRAME_PADDING_CSS,
  toolOptionChromePlacement,
  toolOptionFrame,
} from './toolOptionPlacement';
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

describe('toolOptionChromePlacement', () => {
  const viewport = { width: 1000, height: 800 };
  const chrome = { width: 220, height: 30 };

  it('sits above the frame, aligned to its left edge', () => {
    const at = toolOptionChromePlacement(
      { left: 200, top: 300, width: 400, height: 200 },
      chrome,
      viewport
    );
    expect(at.left).toBe(200);
    expect(at.top).toBeLessThan(300);
  });

  it('drops inside the frame when there is no room above', () => {
    // Not below: below would cover whatever is beneath the frame, while inside
    // overlaps only the region the user is already looking at.
    const frame = { left: 200, top: 4, width: 400, height: 300 };
    const at = toolOptionChromePlacement(frame, chrome, viewport);
    expect(at.top).toBeGreaterThanOrEqual(frame.top);
    expect(at.top).toBeLessThan(frame.top + frame.height);
  });

  it('stays inside the viewport when the frame runs off the right', () => {
    const at = toolOptionChromePlacement(
      { left: 950, top: 300, width: 400, height: 200 },
      chrome,
      viewport
    );
    expect(at.left + chrome.width).toBeLessThanOrEqual(viewport.width);
  });

  it('follows the frame without inheriting its scale', () => {
    // Chrome, not content: text that stayed legible at 10% zoom would fill the
    // viewport at 800%. It tracks the frame's corner and nothing else — the
    // frame's *size* is the camera's business, the controls' size is not.
    const offset: [number, number] = [200, 200];
    const near = toolOptionFrame(view(1, offset), BOUNDS);
    const far = toolOptionFrame(view(4, offset), BOUNDS);
    expect(far.width).toBeGreaterThan(near.width);

    const nearChrome = toolOptionChromePlacement(near, chrome, viewport);
    const farChrome = toolOptionChromePlacement(far, chrome, viewport);
    // Same corner, same offsets, at both scales — nothing about the placement
    // reads the zoom.
    expect(nearChrome.left - near.left).toBe(farChrome.left - far.left);
    expect(nearChrome.top - near.top).toBe(farChrome.top - far.top);
  });
});

describe('boundsOfPoints', () => {
  it('encloses every point', () => {
    expect(
      boundsOfPoints([
        { x: 1, y: 5 },
        { x: -3, y: 2 },
        { x: 4, y: -1 },
      ])
    ).toEqual({ minX: -3, minY: -1, maxX: 4, maxY: 5 });
  });

  it('is null with nothing to enclose, and skips non-finite points', () => {
    expect(boundsOfPoints([])).toBeNull();
    expect(boundsOfPoints([{ x: Number.NaN, y: 0 }])).toBeNull();
  });
});
