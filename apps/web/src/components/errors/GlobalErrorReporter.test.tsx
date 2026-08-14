import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { trackAnalyticsError } = vi.hoisted(() => ({ trackAnalyticsError: vi.fn() }));
vi.mock('../../analytics', () => ({ trackAnalyticsError }));

import { GlobalErrorReporter } from './GlobalErrorReporter';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  trackAnalyticsError.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<GlobalErrorReporter />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/** The window `error` event an uncaught throw from a timer or rAF produces. */
function dispatchWindowError(error: unknown): void {
  const event = new Event('error') as Event & { error?: unknown };
  event.error = error;
  act(() => {
    window.dispatchEvent(event);
  });
}

/** The `unhandledrejection` event an unawaited promise produces. */
function dispatchRejection(reason: unknown): void {
  const event = new Event('unhandledrejection') as Event & { reason?: unknown };
  event.reason = reason;
  act(() => {
    window.dispatchEvent(event);
  });
}

describe('GlobalErrorReporter', () => {
  it('reports an uncaught window error to analytics as unhandled', () => {
    dispatchWindowError(new Error('boom'));

    expect(trackAnalyticsError).toHaveBeenCalledTimes(1);
    expect(trackAnalyticsError.mock.calls[0][0]).toMatchObject({
      sourceComponent: 'global:error',
      handled: false,
    });
  });

  it('reports an unhandled promise rejection, tagged by kind', () => {
    dispatchRejection(new Error('nope'));

    expect(trackAnalyticsError).toHaveBeenCalledTimes(1);
    expect(trackAnalyticsError.mock.calls[0][0]).toMatchObject({
      sourceComponent: 'global:unhandledrejection',
      handled: false,
    });
  });

  // Uses the rejection path rather than `error`: jsdom escalates an unhandled
  // window `error` event into a test-run failure, which is precisely the state
  // this test creates on purpose.
  it('stops reporting once unmounted, so a torn-down app goes quiet', () => {
    act(() => root.unmount());
    dispatchRejection(new Error('after unmount'));
    expect(trackAnalyticsError).not.toHaveBeenCalled();

    // afterEach unmounts again; make that a no-op rather than a double unmount.
    root = createRoot(document.createElement('div'));
  });
});
