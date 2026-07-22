import { describe, expect, it } from 'vitest';
import { DRAG_START_THRESHOLD_PX, hasPassedDragThreshold } from './pointerGesture';

describe('hasPassedDragThreshold', () => {
  const origin = { x: 100, y: 100 };

  it('treats a still pointer, and a small wobble, as a click', () => {
    expect(hasPassedDragThreshold(origin, origin)).toBe(false);
    expect(hasPassedDragThreshold(origin, { x: 102, y: 102 })).toBe(false);
  });

  it('counts the threshold itself as a drag', () => {
    expect(hasPassedDragThreshold(origin, { x: 100 + DRAG_START_THRESHOLD_PX, y: 100 })).toBe(true);
  });

  it('measures distance, not per-axis travel', () => {
    // 3-4-5: neither axis alone reaches 5, the distance does.
    expect(hasPassedDragThreshold(origin, { x: 103, y: 104 }, 5)).toBe(true);
    expect(hasPassedDragThreshold(origin, { x: 103, y: 103 }, 5)).toBe(false);
  });

  it('is direction-agnostic', () => {
    for (const to of [
      { x: 110, y: 100 },
      { x: 90, y: 100 },
      { x: 100, y: 110 },
      { x: 100, y: 90 },
    ]) {
      expect(hasPassedDragThreshold(origin, to)).toBe(true);
    }
  });
});
