// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '../../store/localeStore';
import type { PostHogClientLike } from '../bootstrap';
import { AnalyticsRuntimeProvider, createAnalyticsApi, trackCountedUse } from '../runtime';
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

  it('sends a counted use’s first use at once and its count on a flush', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 25, 9, 0, 0));
    const client = makeFakeClient();
    const api = createAnalyticsApi(client);

    api.trackCountedUse('command invoked', { command_id: 'edit.undo', command_group: 'edit' });
    api.trackCountedUse('command invoked', { command_id: 'edit.undo', command_group: 'edit' });
    expect(client.capture.mock.calls).toEqual([
      ['command invoked', { command_id: 'edit.undo', command_group: 'edit', counting: 'first_in_window' }],
    ]);

    api.flushCountedUses({ beacon: true });
    expect(client.capture).toHaveBeenLastCalledWith(
      'command uses counted',
      { command_id: 'edit.undo', command_group: 'edit', use_count_bucket: '<=5' },
      { timestamp: new Date(2026, 10, 25, 9, 0, 0), transport: 'sendBeacon' }
    );
  });

  it('does not send uses counted before an opt-out', () => {
    vi.useFakeTimers();
    const client = makeFakeClient();
    const api = createAnalyticsApi(client);
    api.trackCountedUse('cp tool used', { operation: 'DrawCreaseFree', group: 'draw' });
    api.trackCountedUse('cp tool used', { operation: 'DrawCreaseFree', group: 'draw' });

    api.setAnalyticsEnabled(false);
    api.flushCountedUses();

    expect(client.capture.mock.calls.map(([eventName]) => eventName)).toEqual(['cp tool used']);
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

  // One failure mode can break several surfaces at once — a DOM teardown bug
  // fingerprints identically whether it hits the dock or a dialog. Keying the
  // window on the fingerprint alone collapsed those into one event, which hid
  // that it was happening in more than one place.
  it('dedupes per surface, so the same error on two surfaces is two events', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
    const client = makeFakeClient();
    const api = createAnalyticsApi(client);

    api.trackError({ error: new Error('boom'), sourceComponent: 'shell:dockview' });
    api.trackError({ error: new Error('boom'), sourceComponent: 'overlay:settings' });
    expect(client.capture).toHaveBeenCalledTimes(2);

    // Still deduped within a surface.
    api.trackError({ error: new Error('boom'), sourceComponent: 'shell:dockview' });
    expect(client.capture).toHaveBeenCalledTimes(2);

    const surfaces = client.capture.mock.calls.map(([, props]) => props.source_component);
    expect(surfaces).toEqual(['shell:dockview', 'overlay:settings']);
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

describe('AnalyticsRuntimeProvider locale sync', () => {
  function localeProps(client: ReturnType<typeof makeFakeClient>) {
    return client.register.mock.calls
      .map(([props]) => props)
      .filter((props) => 'locale' in props)
      .map((props) => ({ locale: props.locale, locale_source: props.locale_source }));
  }

  let container: HTMLElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useLocaleStore.setState({ locale: 'en', preference: 'system' });
  });

  // Without this the super property would be frozen at whatever the language
  // was when the app launched, and someone who switches mid-session would keep
  // reporting the old one for the rest of their visit.
  it('re-registers the language when the user switches it mid-session', () => {
    const client = makeFakeClient();
    act(() => {
      root.render(createElement(AnalyticsRuntimeProvider, { client, children: null }));
    });
    act(() => {
      useLocaleStore.setState({ locale: 'ja', preference: 'ja' });
    });

    expect(localeProps(client).at(-1)).toEqual({ locale: 'ja', locale_source: 'pinned' });
  });

  it('is inert when analytics never initialized', () => {
    expect(() => {
      act(() => {
        root.render(createElement(AnalyticsRuntimeProvider, { client: null, children: null }));
      });
      act(() => {
        useLocaleStore.setState({ locale: 'de', preference: 'de' });
      });
    }).not.toThrow();
  });
});

describe('AnalyticsRuntimeProvider counting window', () => {
  let container: HTMLElement;
  let root: ReturnType<typeof createRoot>;
  let client: ReturnType<typeof makeFakeClient>;

  const countsSent = () =>
    client.capture.mock.calls.filter(([eventName]) => eventName === 'cp tool uses counted');

  function setVisibility(state: DocumentVisibilityState) {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    client = makeFakeClient();
    act(() => {
      root.render(createElement(AnalyticsRuntimeProvider, { client, children: null }));
    });
    trackCountedUse('cp tool used', { operation: 'DrawCreaseFree', group: 'draw' });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('closes the window by beacon when the page is hidden', () => {
    setVisibility('visible');
    expect(countsSent()).toHaveLength(0);

    setVisibility('hidden');

    expect(countsSent()).toHaveLength(1);
    expect(countsSent()[0][2]).toEqual(expect.objectContaining({ transport: 'sendBeacon' }));
  });

  it('closes the window by beacon when the page is torn down', () => {
    window.dispatchEvent(new Event('pagehide'));

    expect(countsSent()).toHaveLength(1);
    expect(countsSent()[0][2]).toEqual(expect.objectContaining({ transport: 'sendBeacon' }));
  });
});
