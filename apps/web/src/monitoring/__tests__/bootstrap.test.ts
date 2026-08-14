import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { peekStableId } from '../../analytics/stableId';
import { initializeSentry } from '../bootstrap';
import { isMonitoringConsented, setMonitoringEnabled } from '../runtime';
import type { SentryClientLike } from '../types';

function makeFakeClient() {
  return {
    init: vi.fn(),
    captureException: vi.fn((_exception: unknown, _hint?: Record<string, unknown>) => 'event-id'),
    setUser: vi.fn(),
    getCurrentScope: vi.fn(() => ({ clearBreadcrumbs: vi.fn() })),
  } satisfies SentryClientLike;
}

const DSN_ENV = {
  VITE_PUBLIC_SENTRY_DSN: 'https://abc@o1.ingest.us.sentry.io/2',
  DEV: false,
};

/** The options object handed to `Sentry.init`. */
function initConfig(client: ReturnType<typeof makeFakeClient>): Record<string, unknown> {
  return client.init.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  localStorage.clear();
  setMonitoringEnabled(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('initializeSentry', () => {
  it('does nothing and returns false when the DSN is absent (the firewall)', () => {
    const client = makeFakeClient();
    const ready = initializeSentry(client, { monitoringEnabled: true }, { DEV: false });
    expect(ready).toBe(false);
    expect(client.init).not.toHaveBeenCalled();
  });

  it('initializes errors-only, with PII and client reports off', () => {
    const client = makeFakeClient();
    const ready = initializeSentry(client, { monitoringEnabled: true }, DSN_ENV);

    expect(ready).toBe(true);
    expect(initConfig(client)).toMatchObject({
      dsn: DSN_ENV.VITE_PUBLIC_SENTRY_DSN,
      environment: 'production',
      tracesSampleRate: 0,
      sendDefaultPii: false,
      sendClientReports: false,
    });
  });

  it('drops the BrowserSession integration, whose pings bypass beforeSend', () => {
    const client = makeFakeClient();
    initializeSentry(client, { monitoringEnabled: true }, DSN_ENV);

    const filter = initConfig(client).integrations as (
      defaults: Array<{ name: string }>
    ) => Array<{ name: string }>;
    const kept = filter([{ name: 'BrowserSession' }, { name: 'Breadcrumbs' }]);
    expect(kept.map((i) => i.name)).toEqual(['Breadcrumbs']);
  });

  it('tags the release and surface so an issue names the exact build', () => {
    const client = makeFakeClient();
    initializeSentry(client, { monitoringEnabled: true }, DSN_ENV);

    const config = initConfig(client);
    expect(String(config.release)).toMatch(/^ori-studio@/);
    expect(config.initialScope).toMatchObject({
      tags: { runtime_surface: expect.stringMatching(/^(web|desktop)$/) },
    });
  });

  it('attaches the anonymous id at init, not at first render', () => {
    const client = makeFakeClient();
    initializeSentry(client, { monitoringEnabled: true }, DSN_ENV);

    // `setMonitoringEnabled` cannot do this on its own: it needs a live client,
    // and the client is not bound until MonitoringRuntimeProvider mounts. An
    // error thrown during startup would otherwise carry no id to join on.
    expect(initConfig(client).initialScope).toMatchObject({
      user: { id: peekStableId() },
    });
    expect(peekStableId()).toBeTruthy();
  });

  it('mints no id at all while opted out', () => {
    const client = makeFakeClient();
    initializeSentry(client, { monitoringEnabled: false }, DSN_ENV);

    const scope = initConfig(client).initialScope as { user?: unknown };
    expect(scope.user).toBeUndefined();
    // The stronger claim: reading the id creates and persists one, so an
    // opted-out user must not even reach that call.
    expect(peekStableId()).toBeNull();
  });

  it('seeds consent from the passed option, so beforeSend is correct immediately', () => {
    const client = makeFakeClient();
    initializeSentry(client, { monitoringEnabled: false }, DSN_ENV);
    expect(isMonitoringConsented()).toBe(false);

    initializeSentry(client, { monitoringEnabled: true }, DSN_ENV);
    expect(isMonitoringConsented()).toBe(true);
  });
});

describe('the beforeSend consent gate', () => {
  function gateOf(client: ReturnType<typeof makeFakeClient>) {
    return initConfig(client).beforeSend as (event: unknown) => unknown;
  }

  it('returns null for every event while opted out', () => {
    const client = makeFakeClient();
    initializeSentry(client, { monitoringEnabled: false }, DSN_ENV);
    expect(gateOf(client)({ exception: { values: [{ value: 'boom' }] } })).toBeNull();
  });

  it('passes a scrubbed event through once consent is on', () => {
    const client = makeFakeClient();
    initializeSentry(client, { monitoringEnabled: true }, DSN_ENV);

    const sent = gateOf(client)({
      exception: { values: [{ value: 'cannot read /Users/someone/secret.osf' }] },
    }) as { exception: { values: Array<{ value: string }> } } | null;

    expect(sent).not.toBeNull();
    expect(sent!.exception.values[0]!.value).not.toContain('someone');
  });

  it('stops sending the moment consent is revoked, without re-initializing', () => {
    const client = makeFakeClient();
    initializeSentry(client, { monitoringEnabled: true }, DSN_ENV);
    const gate = gateOf(client);

    expect(gate({ message: 'boom' })).not.toBeNull();
    setMonitoringEnabled(false);
    expect(gate({ message: 'boom' })).toBeNull();
  });
});
