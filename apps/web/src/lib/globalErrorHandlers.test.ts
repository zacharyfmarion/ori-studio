import { describe, expect, it, vi } from 'vitest';
import { globalErrorKey, installGlobalErrorHandlers } from './globalErrorHandlers';

/**
 * A minimal EventTarget stand-in. jsdom's ErrorEvent/PromiseRejectionEvent
 * constructors do not reliably carry `error`/`reason`, so tests dispatch plain
 * objects shaped like the events instead.
 */
function harness() {
  const listeners = new Map<string, EventListener[]>();
  const target = {
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((entry) => entry !== listener),
      );
    },
    dispatch(type: string, event: unknown) {
      for (const listener of listeners.get(type) ?? []) listener(event as Event);
    },
    count(type: string) {
      return (listeners.get(type) ?? []).length;
    },
  };
  return target;
}

function errorEvent(error: unknown) {
  return { type: 'error', error, message: 'ignored' };
}

function rejectionEvent(reason: unknown) {
  return { type: 'unhandledrejection', reason };
}

describe('globalErrorKey', () => {
  it('separates identical messages thrown from different call sites', () => {
    const a = new Error('same');
    a.stack = 'Error: same\n    at alpha ()';
    const b = new Error('same');
    b.stack = 'Error: same\n    at beta ()';
    expect(globalErrorKey('error', a)).not.toBe(globalErrorKey('error', b));
  });
});

describe('installGlobalErrorHandlers', () => {
  it('reports window errors and unhandled rejections', () => {
    const target = harness();
    const onError = vi.fn();
    installGlobalErrorHandlers({ onError, target: target as unknown as EventTarget });

    target.dispatch('error', errorEvent(new Error('sync boom')));
    target.dispatch('unhandledrejection', rejectionEvent(new Error('async boom')));

    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0][0]).toMatchObject({ kind: 'error' });
    expect(onError.mock.calls[1][0]).toMatchObject({ kind: 'unhandledrejection' });
  });

  it('suppresses the same error repeating inside the dedupe window', () => {
    const target = harness();
    const onError = vi.fn();
    let now = 0;
    installGlobalErrorHandlers({
      onError,
      target: target as unknown as EventTarget,
      now: () => now,
      dedupeMs: 1000,
    });

    const repeat = () => {
      const error = new Error('same');
      error.stack = 'Error: same\n    at loop ()';
      target.dispatch('error', errorEvent(error));
    };

    repeat();
    now = 500;
    repeat();
    expect(onError).toHaveBeenCalledOnce();

    now = 1600;
    repeat();
    expect(onError).toHaveBeenCalledTimes(2);
  });

  // A throw inside a requestAnimationFrame callback fires every frame; without
  // this the "help" would be hundreds of toasts.
  it('caps distinct errors per window', () => {
    const target = harness();
    const onError = vi.fn();
    let now = 0;
    installGlobalErrorHandlers({
      onError,
      target: target as unknown as EventTarget,
      now: () => now,
      limit: 3,
      windowMs: 1000,
    });

    for (let i = 0; i < 10; i += 1) {
      now = i;
      target.dispatch('error', errorEvent(new Error(`distinct ${i}`)));
    }
    expect(onError).toHaveBeenCalledTimes(3);

    // A later window admits reports again.
    now = 5000;
    target.dispatch('error', errorEvent(new Error('after the window')));
    expect(onError).toHaveBeenCalledTimes(4);
  });

  it('does not let a throwing reporter become the next unhandled error', () => {
    const target = harness();
    const onError = vi.fn(() => {
      throw new Error('reporter is broken');
    });
    installGlobalErrorHandlers({ onError, target: target as unknown as EventTarget });

    expect(() => target.dispatch('error', errorEvent(new Error('boom')))).not.toThrow();
  });

  it('removes both listeners when disposed', () => {
    const target = harness();
    const dispose = installGlobalErrorHandlers({
      onError: vi.fn(),
      target: target as unknown as EventTarget,
    });

    expect(target.count('error')).toBe(1);
    expect(target.count('unhandledrejection')).toBe(1);

    dispose();

    expect(target.count('error')).toBe(0);
    expect(target.count('unhandledrejection')).toBe(0);
  });
});
