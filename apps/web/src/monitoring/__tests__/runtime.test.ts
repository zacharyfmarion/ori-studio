import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { peekStableId } from '../../analytics/stableId';
import {
  EngineError,
  isMonitoringConsented,
  reportError,
  setMonitoringClient,
  setMonitoringEnabled,
} from '../runtime';
import type { SentryClientLike } from '../types';

function makeFakeClient() {
  const clearBreadcrumbs = vi.fn();
  const client = {
    init: vi.fn(),
    captureException: vi.fn((_exception: unknown, _hint?: Record<string, unknown>) => 'event-id'),
    setUser: vi.fn(),
    getCurrentScope: vi.fn(() => ({ clearBreadcrumbs })),
  } satisfies SentryClientLike;
  return { client, clearBreadcrumbs };
}

beforeEach(() => {
  localStorage.clear();
  setMonitoringClient(null);
  setMonitoringEnabled(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reportError', () => {
  it('sends nothing while opted out', () => {
    const { client } = makeFakeClient();
    setMonitoringClient(client);
    setMonitoringEnabled(false);

    reportError(new Error('boom'), { surface: 'panel:crease-pattern' });
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it('sends nothing when monitoring never initialized', () => {
    const { client } = makeFakeClient();
    setMonitoringEnabled(true);

    reportError(new Error('boom'));
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it('captures with the surface tag and component stack once consented', () => {
    const { client } = makeFakeClient();
    setMonitoringClient(client);
    setMonitoringEnabled(true);

    const error = new Error('boom');
    reportError(error, {
      surface: 'panel:crease-pattern',
      componentStack: '\n at CreasePatternPanel',
      handled: true,
    });

    expect(client.captureException).toHaveBeenCalledTimes(1);
    const [captured, hint] = client.captureException.mock.calls[0]!;
    expect(captured).toBe(error);
    expect(hint).toMatchObject({
      mechanism: { handled: true },
      captureContext: {
        tags: { surface: 'panel:crease-pattern' },
        contexts: { react: { component_stack: '\n at CreasePatternPanel' } },
      },
    });
  });

  it('never lets a failing reporter mask the error it was reporting', () => {
    const { client } = makeFakeClient();
    client.captureException.mockImplementation(() => {
      throw new Error('sentry is down');
    });
    setMonitoringClient(client);
    setMonitoringEnabled(true);

    expect(() => reportError(new Error('boom'))).not.toThrow();
  });

  // A bridge rejects with `{ code, message }`, and handed that object Sentry
  // reports "Object captured as exception with keys: code, message" with the
  // object itself in `extra` — which `scrubEvent` drops. That is what
  // ORI-STUDIO-D and -E were: two blind reports of the References workspace.
  it('reports a bridge envelope as an error named by its code', () => {
    const { client } = makeFakeClient();
    setMonitoringClient(client);
    setMonitoringEnabled(true);

    reportError(
      { code: 'point_cap', message: 'point cap of 600000 points reached' },
      { surface: 'references:plan' }
    );

    const [captured, hint] = client.captureException.mock.calls[0]!;
    expect(captured).toBeInstanceOf(EngineError);
    expect(captured).toMatchObject({
      name: 'EngineError',
      code: 'point_cap',
      message: 'point_cap: point cap of 600000 points reached',
    });
    expect(hint).toMatchObject({
      captureContext: {
        tags: { error_code: 'point_cap', surface: 'references:plan' },
        // Two codes at one call site are two issues, not one.
        fingerprint: ['{{ default }}', 'point_cap'],
      },
    });
  });

  it('leaves errors, and objects that only look like envelopes, as they are', () => {
    const { client } = makeFakeClient();
    setMonitoringClient(client);
    setMonitoringEnabled(true);

    const error = Object.assign(new Error('boom'), { code: 'real_error' });
    // A code that is not a literal from a bridge is not a bounded tag value.
    const unbounded = { code: 'Bird base.osf', message: 'nope' };
    const nonString = { code: 42, message: 'nope' };
    for (const value of [error, unbounded, nonString]) reportError(value);

    expect(client.captureException).toHaveBeenCalledTimes(3);
    for (const [captured, hint] of client.captureException.mock.calls) {
      expect(captured).not.toBeInstanceOf(EngineError);
      expect((hint as { captureContext: { tags: Record<string, string> } }).captureContext.tags)
        .not.toHaveProperty('error_code');
      expect(hint).not.toHaveProperty('captureContext.fingerprint');
    }
    expect(client.captureException.mock.calls[0]![0]).toBe(error);
  });
});

describe('setMonitoringEnabled', () => {
  it('identifies with the shared anonymous id on opt-in', () => {
    const { client } = makeFakeClient();
    setMonitoringClient(client);
    setMonitoringEnabled(true);

    expect(isMonitoringConsented()).toBe(true);
    const id = peekStableId();
    expect(id).toBeTruthy();
    expect(client.setUser).toHaveBeenCalledWith({ id });
  });

  it('clears identity and the breadcrumb buffer on opt-out', () => {
    const { client, clearBreadcrumbs } = makeFakeClient();
    setMonitoringClient(client);
    setMonitoringEnabled(true);
    setMonitoringEnabled(false);

    expect(isMonitoringConsented()).toBe(false);
    expect(client.setUser).toHaveBeenLastCalledWith(null);
    // Otherwise activity from before the opt-out rides along on the next event
    // after the user opts back in.
    expect(clearBreadcrumbs).toHaveBeenCalledTimes(1);
  });

  it('tracks consent even before a client exists, so the gate is never stale', () => {
    setMonitoringEnabled(true);
    expect(isMonitoringConsented()).toBe(true);
  });
});
