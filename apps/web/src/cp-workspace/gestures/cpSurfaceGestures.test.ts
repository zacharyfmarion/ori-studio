import { afterEach, describe, expect, it, vi } from 'vitest';
import { cpSurfaceGestures } from './cpSurfaceGestures';
import type { CpGesturePointer } from './cpTouchArbiter';

const finger = (id: number, x: number, y: number): CpGesturePointer => ({
  pointerId: id,
  pointerType: 'touch',
  clientX: x,
  clientY: y,
});

const pen = (id: number, x: number, y: number): CpGesturePointer => ({
  ...finger(id, x, y),
  pointerType: 'pen',
});

/** Every detach this case registered, so module state cannot leak between them. */
const detaches: (() => void)[] = [];
const register = (detach: () => void) => {
  detaches.push(detach);
  return detach;
};

afterEach(() => {
  for (const detach of detaches.splice(0)) detach();
  cpSurfaceGestures.reset();
});

describe('abort fan-out', () => {
  it('rolls back the overlay when a finger lands on the canvas beside it', () => {
    // The wire that makes a shared arbiter usable: the canvas is the only layer
    // that sees this press, and the overlay is the only one that can undo what
    // it interrupts.
    const overlayAbort = vi.fn();
    register(cpSurfaceGestures.onAbort('overlay', overlayAbort));

    cpSurfaceGestures.down(finger(1, 100, 100), 'overlay');
    expect(overlayAbort).not.toHaveBeenCalled();

    cpSurfaceGestures.down(finger(2, 300, 100), 'canvas');
    expect(overlayAbort).toHaveBeenCalledTimes(1);
  });

  it('rolls back before the verdict returns', () => {
    // The caller acts on the verdict in the same handler, so a rollback deferred
    // past the return would race the press it is rolling back — the overlay
    // would clear a `dragRef` the canvas had already replaced.
    const order: string[] = [];
    register(cpSurfaceGestures.onAbort('overlay', () => order.push('abort')));

    cpSurfaceGestures.down(finger(1, 100, 100), 'overlay');
    cpSurfaceGestures.down(finger(2, 300, 100), 'canvas');
    order.push('returned');

    expect(order).toEqual(['abort', 'returned']);
  });

  it('rolls back the canvas when the fingers arrive the other way round', () => {
    const canvasAbort = vi.fn();
    register(cpSurfaceGestures.onAbort('canvas', canvasAbort));

    cpSurfaceGestures.down(finger(1, 100, 100), 'canvas');
    cpSurfaceGestures.down(finger(2, 300, 100), 'overlay');
    expect(canvasAbort).toHaveBeenCalledTimes(1);
  });

  it('leaves the layer that did not lose a press alone', () => {
    const canvasAbort = vi.fn();
    const overlayAbort = vi.fn();
    register(cpSurfaceGestures.onAbort('canvas', canvasAbort));
    register(cpSurfaceGestures.onAbort('overlay', overlayAbort));

    cpSurfaceGestures.down(finger(1, 100, 100), 'overlay');
    cpSurfaceGestures.down(finger(2, 300, 100), 'canvas');

    expect(overlayAbort).toHaveBeenCalledTimes(1);
    expect(canvasAbort).not.toHaveBeenCalled();
  });

  it('says nothing when a third finger joins a gesture already in flight', () => {
    const overlayAbort = vi.fn();
    register(cpSurfaceGestures.onAbort('overlay', overlayAbort));

    cpSurfaceGestures.down(finger(1, 100, 100), 'overlay');
    cpSurfaceGestures.down(finger(2, 300, 100), 'canvas');
    cpSurfaceGestures.down(finger(3, 200, 300), 'canvas');

    expect(overlayAbort).toHaveBeenCalledTimes(1);
  });

  it('stops calling a detached handler', () => {
    const overlayAbort = vi.fn();
    cpSurfaceGestures.onAbort('overlay', overlayAbort)();

    cpSurfaceGestures.down(finger(1, 100, 100), 'overlay');
    cpSurfaceGestures.down(finger(2, 300, 100), 'canvas');

    expect(overlayAbort).not.toHaveBeenCalled();
  });

  it('survives a handler that detaches itself while rolling back', () => {
    // `CanvasObjectOverlay` re-registers whenever `onUpdate` changes identity,
    // and its rollback calls `onUpdate` — so a detach mid-iteration is a real
    // sequence, not a hypothetical one.
    const calls: string[] = [];
    let detachSelf = () => {};
    detachSelf = cpSurfaceGestures.onAbort('overlay', () => {
      calls.push('first');
      detachSelf();
    });
    register(cpSurfaceGestures.onAbort('overlay', () => calls.push('second')));

    cpSurfaceGestures.down(finger(1, 100, 100), 'overlay');
    expect(() => cpSurfaceGestures.down(finger(2, 300, 100), 'canvas')).not.toThrow();
    expect(calls).toEqual(['first', 'second']);
  });

  it('rolls back a window drag a Pencil preempts', () => {
    const overlayAbort = vi.fn();
    register(cpSurfaceGestures.onAbort('overlay', overlayAbort));

    cpSurfaceGestures.down(finger(1, 100, 100), 'overlay');
    cpSurfaceGestures.down(pen(2, 200, 200), 'canvas');

    expect(overlayAbort).toHaveBeenCalledTimes(1);
  });
});

describe('transform sink', () => {
  it('drives the camera from a contact the overlay captured', () => {
    // The whole reason the sample is pushed rather than returned. A pinch
    // anchored by a thumb on the canvas sends every *moving* sample to the
    // overlay; returning it from the canvas' own `move()` would zoom nothing.
    const sink = vi.fn();
    register(cpSurfaceGestures.setTransformSink(sink));

    cpSurfaceGestures.down(finger(1, 100, 100), 'overlay');
    cpSurfaceGestures.down(finger(2, 200, 100), 'canvas');
    cpSurfaceGestures.move(finger(1, 100, 100)); // rebase sample
    sink.mockClear();

    // Only the overlay's finger moves; the one on the canvas rests.
    expect(cpSurfaceGestures.move(finger(1, 0, 100))).toBe('transform');
    expect(sink).toHaveBeenCalledTimes(1);
    const [transform, anchor] = sink.mock.calls[0];
    expect(transform.scale).toBeCloseTo(2, 10);
    expect(anchor).toEqual({ x: 150, y: 100 });
  });

  it('stays quiet for a move that is not a camera sample', () => {
    const sink = vi.fn();
    register(cpSurfaceGestures.setTransformSink(sink));

    cpSurfaceGestures.down(finger(1, 100, 100), 'overlay');
    expect(cpSurfaceGestures.move(finger(1, 140, 100))).toBe('forward');
    expect(sink).not.toHaveBeenCalled();
  });

  it('hands samples to the last claimant only', () => {
    // A canvas rebuilt after a WebGL context loss registers a second time; the
    // first must not keep receiving samples for a camera it no longer draws.
    const stale = vi.fn();
    const live = vi.fn();
    register(cpSurfaceGestures.setTransformSink(stale));
    register(cpSurfaceGestures.setTransformSink(live));

    cpSurfaceGestures.down(finger(1, 100, 100), 'overlay');
    cpSurfaceGestures.down(finger(2, 200, 100), 'canvas');
    cpSurfaceGestures.move(finger(1, 50, 100));

    expect(stale).not.toHaveBeenCalled();
    expect(live).toHaveBeenCalled();
  });

  it('does not unclaim a sink that already replaced it', () => {
    const stale = vi.fn();
    const live = vi.fn();
    const detachStale = cpSurfaceGestures.setTransformSink(stale);
    register(cpSurfaceGestures.setTransformSink(live));
    // The old canvas' effect cleanup runs *after* the new one's setup, which is
    // the ordinary React order for a remount.
    detachStale();

    cpSurfaceGestures.down(finger(1, 100, 100), 'overlay');
    cpSurfaceGestures.down(finger(2, 200, 100), 'canvas');
    cpSurfaceGestures.move(finger(1, 50, 100));

    expect(live).toHaveBeenCalled();
  });
});

describe('reset', () => {
  it('drops contacts from every layer', () => {
    cpSurfaceGestures.down(finger(1, 100, 100), 'overlay');
    cpSurfaceGestures.down(finger(2, 200, 100), 'canvas');
    expect(cpSurfaceGestures.contactCount()).toBe(2);

    cpSurfaceGestures.reset();

    expect(cpSurfaceGestures.contactCount()).toBe(0);
    expect(cpSurfaceGestures.isTransforming()).toBe(false);
    expect(cpSurfaceGestures.down(finger(3, 10, 10), 'canvas')).toBe('forward');
  });
});
