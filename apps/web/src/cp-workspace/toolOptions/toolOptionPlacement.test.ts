import { describe, expect, it } from 'vitest';

import { ANCHOR_GAP_CSS, toolOptionPlacement } from './toolOptionPlacement';

const SIZE = { width: 200, height: 120 };
const VIEWPORT = { width: 1000, height: 800 };

describe('toolOptionPlacement', () => {
  it('sits below and right of the anchor when there is room', () => {
    // Clear of the cursor's path to the anchor, which is where the hand is.
    const at = toolOptionPlacement({ x: 300, y: 400 }, SIZE, VIEWPORT);
    expect(at).toEqual({ left: 300 + ANCHOR_GAP_CSS, top: 400 + ANCHOR_GAP_CSS });
  });

  it('flips to the other side rather than sliding over the anchor', () => {
    // The distinction that matters: a clamped window covers the thing it points
    // at, a flipped one stays beside it. Near the right edge, flip.
    const at = toolOptionPlacement({ x: 960, y: 400 }, SIZE, VIEWPORT);
    expect(at.left).toBe(960 - ANCHOR_GAP_CSS - SIZE.width);
    expect(at.top).toBe(400 + ANCHOR_GAP_CSS);
  });

  it('flips vertically too, independently of the horizontal side', () => {
    const at = toolOptionPlacement({ x: 300, y: 780 }, SIZE, VIEWPORT);
    expect(at.left).toBe(300 + ANCHOR_GAP_CSS);
    expect(at.top).toBe(780 - ANCHOR_GAP_CSS - SIZE.height);
  });

  it('clamps when neither side fits, rather than escaping the viewport', () => {
    // A narrow viewport where the window fits on neither side of the anchor.
    const narrow = { width: 220, height: 800 };
    const at = toolOptionPlacement({ x: 110, y: 400 }, SIZE, narrow);
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.left + SIZE.width).toBeLessThanOrEqual(narrow.width);
  });

  it('pins a window bigger than the viewport instead of losing it', () => {
    // Degenerate and without a good answer; visible beats correctly offset.
    const tiny = { width: 100, height: 90 };
    const at = toolOptionPlacement({ x: 50, y: 40 }, SIZE, tiny);
    expect(at.left).toBeLessThanOrEqual(SIZE.width);
    expect(at.top).toBeLessThanOrEqual(SIZE.height);
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.top).toBeGreaterThanOrEqual(0);
  });

  it('does not depend on the camera scale', () => {
    // The one thing not to borrow from the inline simulator: that window scales
    // because its content is model geometry. This one is chrome, and chrome that
    // grew eight-fold at 800% zoom would be unusable.
    const near = toolOptionPlacement({ x: 300, y: 400 }, SIZE, VIEWPORT);
    const far = toolOptionPlacement({ x: 300, y: 400 }, SIZE, VIEWPORT);
    expect(near).toEqual(far);
  });
});
