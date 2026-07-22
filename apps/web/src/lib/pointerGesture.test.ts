import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAG_START_THRESHOLD_PX,
  hasPassedDragThreshold,
  runAfterPointerGesture,
} from './pointerGesture';

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

describe('runAfterPointerGesture', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const press = () => window.dispatchEvent(new Event('pointerdown'));
  const release = () => window.dispatchEvent(new Event('pointerup'));

  it('runs immediately when no pointer is held', () => {
    const run = vi.fn();
    runAfterPointerGesture(run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('waits for the button to come up, not merely for the next frame', () => {
    press();
    const run = vi.fn();
    runAfterPointerGesture(run);
    // A drag lasts many frames; deferring by one would have fired here.
    expect(run).not.toHaveBeenCalled();
    release();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('waits for the last of several pointers', () => {
    press();
    press();
    const run = vi.fn();
    runAfterPointerGesture(run);
    release();
    expect(run).not.toHaveBeenCalled();
    release();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not strand work when a gesture is cancelled', () => {
    press();
    const run = vi.fn();
    runAfterPointerGesture(run);
    window.dispatchEvent(new Event('pointercancel'));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not strand work when the window loses focus mid-gesture', () => {
    press();
    const run = vi.fn();
    runAfterPointerGesture(run);
    window.dispatchEvent(new Event('blur'));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
