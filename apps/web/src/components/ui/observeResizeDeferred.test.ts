import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeResizeDeferred } from './observeResizeDeferred';

/**
 * The contract that keeps a resize-driven reposition out of the resize callback.
 *
 * Regression cover for a real bug: the boundary observer called its update
 * inline, that update wrote the floating pill's `max-width`, and dragging a pane
 * splitter therefore resized an observed element during delivery. The browser
 * reported the leftovers as "ResizeObserver loop completed with undelivered
 * notifications", which this app turns into a background-error toast.
 *
 * jsdom models neither layout nor the loop detection, so the observable
 * contract is the one asserted here: nothing runs inline, and a burst collapses
 * to a single call.
 */

let callbacks: ResizeObserverCallback[] = [];
/** Pending frames by handle, so the `cancelAnimationFrame` stub really cancels. */
let frames = new Map<number, FrameRequestCallback>();
let nextHandle = 1;
let observed: Element[] = [];
let disconnected = 0;

class CapturingResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    callbacks.push(callback);
  }
  observe(target: Element): void {
    observed.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    disconnected += 1;
  }
}

/** Deliver a resize notification to every observer created so far. */
function fireResize(): void {
  for (const callback of callbacks) {
    callback([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
  }
}

/** Run the frames that are pending, as the browser would before the next paint. */
function runFrames(): void {
  const pending = [...frames.values()];
  frames.clear();
  for (const frame of pending) frame(0);
}

beforeEach(() => {
  callbacks = [];
  frames = new Map();
  nextHandle = 1;
  observed = [];
  disconnected = 0;
  vi.stubGlobal('ResizeObserver', CapturingResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => {
    const handle = nextHandle++;
    frames.set(handle, frame);
    return handle;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    frames.delete(handle);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('observeResizeDeferred', () => {
  it('observes the element it is given', () => {
    const element = document.createElement('div');
    observeResizeDeferred(element, vi.fn());

    expect(observed).toEqual([element]);
  });

  it('does not call back inline, only on the next frame', () => {
    const onResize = vi.fn();
    observeResizeDeferred(document.createElement('div'), onResize);

    fireResize();
    // The whole point: resizing anything here would be resizing during
    // delivery, which is what the browser complains about.
    expect(onResize).not.toHaveBeenCalled();

    runFrames();
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst of resizes into one call', () => {
    const onResize = vi.fn();
    observeResizeDeferred(document.createElement('div'), onResize);

    // A splitter dragged across a pane delivers a long burst; one reposition
    // per frame is enough, and repositioning per observation is what fed the
    // loop in the first place.
    fireResize();
    fireResize();
    fireResize();
    runFrames();

    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it('calls back again on a later frame', () => {
    const onResize = vi.fn();
    observeResizeDeferred(document.createElement('div'), onResize);

    fireResize();
    runFrames();
    fireResize();
    runFrames();

    expect(onResize).toHaveBeenCalledTimes(2);
  });

  it('disconnects and drops a pending frame on cleanup', () => {
    const onResize = vi.fn();
    const stop = observeResizeDeferred(document.createElement('div'), onResize);

    fireResize();
    stop();
    runFrames();

    expect(disconnected).toBe(1);
    // Nothing may fire after teardown: repositioning an unmounted toolbar is
    // exactly the stale-closure class of bug this guards.
    expect(onResize).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
});
