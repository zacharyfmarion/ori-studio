import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPointerDown, runAfterPointerGesture, trackPointerGestures } from '../lib/pointerGesture';

/**
 * The camera must never move under a gesture the user is already making.
 *
 * A pane that mounts at zero size (an inactive Dockview tab) stays unfitted
 * until something gives it a size — and that something is often the user's own
 * first click on it. The reflow that follows fires the ResizeObserver, the fit
 * runs mid-drag, and the drag is left running against a camera that moved
 * beneath it. It happens exactly once per pane, which is why the first drag
 * fails and every later one works.
 */
describe('viewport fit deferral', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    trackPointerGestures();
  });
  afterEach(() => {
    window.dispatchEvent(new Event('blur'));
    vi.unstubAllGlobals();
  });

  it('reports a pointer as down for the length of a gesture', () => {
    expect(isPointerDown()).toBe(false);
    window.dispatchEvent(new Event('pointerdown'));
    expect(isPointerDown()).toBe(true);
    window.dispatchEvent(new Event('pointerup'));
    expect(isPointerDown()).toBe(false);
  });

  it('holds a fit until the gesture the user started has ended', () => {
    const centerView = vi.fn();
    // The guard the hook applies, in isolation from React.
    const attemptFit = () => {
      if (isPointerDown()) {
        runAfterPointerGesture(attemptFit);
        return false;
      }
      centerView();
      return true;
    };

    window.dispatchEvent(new Event('pointerdown'));
    expect(attemptFit()).toBe(false);
    expect(centerView).not.toHaveBeenCalled();

    // Moves during the drag must not sneak a fit in either.
    expect(attemptFit()).toBe(false);
    expect(centerView).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('pointerup'));
    expect(centerView).toHaveBeenCalled();
  });
});
