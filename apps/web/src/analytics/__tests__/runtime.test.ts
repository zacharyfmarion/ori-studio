import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHogClientLike } from '../bootstrap';
import { createAnalyticsApi } from '../runtime';
import { peekStableId } from '../stableId';

function makeFakeClient() {
  return {
    init: vi.fn(),
    register: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    identify: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn(),
  } satisfies PostHogClientLike;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('createAnalyticsApi', () => {
  it('is a safe no-op when there is no client (analytics disabled/absent)', () => {
    const api = createAnalyticsApi(null);
    expect(() => {
      api.track('crease pattern built');
      api.trackError({ error: new Error('x') });
      api.setAnalyticsEnabled(true);
    }).not.toThrow();
  });

  it('forwards track to capture verbatim', () => {
    const client = makeFakeClient();
    const api = createAnalyticsApi(client);
    api.track('crease pattern built', { node_count_bucket: '<=20' });
    expect(client.capture).toHaveBeenCalledWith('crease pattern built', {
      node_count_bucket: '<=20',
    });
  });

  it('dedupes identical errors within the 30s window and re-emits after it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
    const client = makeFakeClient();
    const api = createAnalyticsApi(client);

    api.trackError({ error: new Error('boom'), operation: 'build cp' });
    api.trackError({ error: new Error('boom'), operation: 'build cp' });
    expect(client.capture).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 31));
    api.trackError({ error: new Error('boom'), operation: 'build cp' });
    expect(client.capture).toHaveBeenCalledTimes(2);
  });

  it('attaches domain, fingerprint, and handled to error events', () => {
    const client = makeFakeClient();
    const api = createAnalyticsApi(client);
    api.trackError({ error: new Error('boom'), sourceComponent: 'CreaseExportDialog' });
    const [name, props] = client.capture.mock.calls[0];
    expect(name).toBe('app error');
    expect(props).toMatchObject({
      error_domain: 'file_io',
      source_component: 'CreaseExportDialog',
      handled: true,
    });
    expect(props.fingerprint).toBeTypeOf('string');
  });

  it('opt-in identifies and can emit the preference-change event', () => {
    const client = makeFakeClient();
    const api = createAnalyticsApi(client);
    api.setAnalyticsEnabled(true, { capturePreferenceChange: true });
    expect(client.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
    expect(client.identify).toHaveBeenCalledTimes(1);
    expect(client.capture).toHaveBeenCalledWith('analytics preference changed', {
      analytics_enabled: true,
      enabled: true,
    });
  });

  it('opt-out emits the event first, then resets and opts out, clearing the id', () => {
    const client = makeFakeClient();
    const api = createAnalyticsApi(client);

    // Opting in first mints and persists a stable id.
    api.setAnalyticsEnabled(true);
    expect(peekStableId()).toBeTruthy();

    const order: string[] = [];
    client.capture.mockImplementation(() => order.push('capture'));
    client.reset.mockImplementation(() => order.push('reset'));
    client.opt_out_capturing.mockImplementation(() => order.push('opt_out'));

    api.setAnalyticsEnabled(false, { capturePreferenceChange: true });
    expect(order).toEqual(['capture', 'reset', 'opt_out']);
    expect(peekStableId()).toBeNull();
  });

  it('does not emit a preference-change event during a silent sync', () => {
    const client = makeFakeClient();
    const api = createAnalyticsApi(client);
    api.setAnalyticsEnabled(true); // no capturePreferenceChange
    expect(client.capture).not.toHaveBeenCalled();
  });
});
