import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  readUpdateEnvironment: vi.fn(),
  checkForUpdate: vi.fn(),
}));
vi.mock('../platform/updateService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/updateService')>();
  return {
    ...actual,
    readUpdateEnvironment: service.readUpdateEnvironment,
    checkForUpdate: service.checkForUpdate,
  };
});

const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../analytics')>();
  return { ...actual, track: analytics.track };
});

const monitoring = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../monitoring', () => ({ reportError: monitoring.reportError }));

const { UpdateCheckError } = await import('../platform/updateService');
const { useUpdateStore } = await import('../store/updateStore');
const { classifyUpdateError, compareVersions, runUpdateCheck } = await import('./updateController');

describe('compareVersions', () => {
  it('orders by numeric component, not lexically', () => {
    // The case that makes a string compare wrong: "0.10.0" < "0.9.0" as text.
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.9.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
  });

  it('treats equal versions as equal', () => {
    expect(compareVersions('0.3.0', '0.3.0')).toBe(0);
  });

  it('treats a missing component as zero', () => {
    expect(compareVersions('0.3', '0.3.0')).toBe(0);
    expect(compareVersions('0.3.1', '0.3')).toBeGreaterThan(0);
  });

  it('does not throw on a shape it does not recognize', () => {
    // It gates a security decision (refusing a stale manifest), so an
    // unparseable version must degrade rather than crash the check.
    expect(() => compareVersions('nightly', '0.3.0')).not.toThrow();
    expect(compareVersions('nightly', '0.3.0')).toBeLessThan(0);
  });
});

describe('classifyUpdateError', () => {
  it('takes the kind the shell already named', () => {
    // The check runs in the shell, which reads the cause off the Rust error
    // chain. Its message is the same for every transport failure — see below —
    // so the kind is the only thing worth reading.
    const message =
      'error sending request for url (https://github.com/x/latest.json): client error (Connect): invalid peer certificate: UnknownIssuer';
    expect(classifyUpdateError(new UpdateCheckError('tls', message))).toBe('tls');
    expect(classifyUpdateError(new UpdateCheckError('proxy', message))).toBe('proxy');
    expect(classifyUpdateError(new UpdateCheckError('dns', message))).toBe('dns');
  });

  it("reads the plugin's transport message as network, never unknown", () => {
    // What reqwest 0.13 says for a DNS miss, a refused connection, a rejected
    // certificate and a failed proxy tunnel alike, and what the plugin's
    // download and install commands still hand over as a bare string. Before
    // this it matched none of the keywords, and every Windows check failure
    // for a month was filed under `unknown`.
    expect(
      classifyUpdateError(
        'error sending request for url (https://github.com/zacharyfmarion/ori-studio/releases/latest/download/latest.json)'
      )
    ).toBe('network');
    expect(classifyUpdateError(new Error('error following redirect for url (https://x/)'))).toBe(
      'network'
    );
  });

  it('identifies a signature failure', () => {
    // The one reason that is alerted on: it means the payload did not verify
    // against the key compiled into this binary, which if it is a key mismatch
    // is fleet-wide.
    expect(classifyUpdateError(new Error('Signature verification failed'))).toBe('signature');
    expect(classifyUpdateError(new Error('minisign: bad signature'))).toBe('signature');
    // base64's own decode errors: the only base64 the plugin decodes is the signature.
    expect(classifyUpdateError('Invalid symbol 43, offset 5.')).toBe('signature');
  });

  it("identifies the plugin's manifest-side failures", () => {
    expect(
      classifyUpdateError(
        'None of the fallback platforms `["windows-x86_64-nsis", "windows-x86_64"]` were found in the response `platforms` object'
      )
    ).toBe('no_platform_entry');
    expect(
      classifyUpdateError(
        'the platform `windows-x86_64` was not found in the response `platforms` object'
      )
    ).toBe('no_platform_entry');
    // Contains "fetch", so it must win over the transport keywords.
    expect(classifyUpdateError('Could not fetch a valid release JSON from the remote')).toBe(
      'http_status'
    );
    expect(classifyUpdateError('`Download request failed with status: 404 Not Found`')).toBe(
      'http_status'
    );
    expect(classifyUpdateError('error decoding response body')).toBe('parse');
    expect(classifyUpdateError('missing field `platforms`')).toBe('parse');
    expect(classifyUpdateError('invalid value for `pub_date`: unexpected trailing characters')).toBe(
      'parse'
    );
  });

  it('identifies transport failures, which are expected and silent', () => {
    expect(classifyUpdateError(new Error('network error'))).toBe('network');
    expect(classifyUpdateError(new Error('failed to fetch'))).toBe('network');
    expect(classifyUpdateError(new Error('connect ETIMEDOUT'))).toBe('network');
    expect(classifyUpdateError(new Error('operation timed out'))).toBe('timeout');
  });

  it('falls back to unknown rather than guessing', () => {
    expect(classifyUpdateError(new Error('something else entirely'))).toBe('unknown');
    expect(classifyUpdateError('a bare string')).toBe('unknown');
  });
});

describe('runUpdateCheck', () => {
  const chain =
    'error sending request for url (https://example.invalid/latest.json): client error (Connect): invalid peer certificate: UnknownIssuer';

  beforeEach(() => {
    useUpdateStore.setState({
      status: 'idle',
      version: null,
      installKind: null,
      lastCheck: null,
      delivery: 'automatic',
      highestSeenVersion: null,
    });
    service.readUpdateEnvironment.mockReset();
    service.checkForUpdate.mockReset();
    analytics.track.mockClear();
    monitoring.reportError.mockClear();
  });

  it("reports the kind the shell named, with this build's install kind", async () => {
    service.readUpdateEnvironment.mockResolvedValue({
      installKind: 'nsis',
      selfUpdateSupported: true,
    });
    service.checkForUpdate.mockRejectedValue(new UpdateCheckError('tls', chain));

    await expect(runUpdateCheck('automatic')).resolves.toBe('failed');

    expect(analytics.track).toHaveBeenCalledWith('app update checked', {
      result: 'error',
      trigger: 'automatic',
    });
    // `install_kind` comes from the environment the check read, not from store
    // state that only an offered update sets — which is why it was empty on
    // every check failure before.
    expect(analytics.track).toHaveBeenCalledWith('app update failed', {
      stage: 'check',
      reason: 'tls',
      install_kind: 'nsis',
      trigger: 'automatic',
    });
    expect(useUpdateStore.getState().lastCheck).toMatchObject({ ok: false });
    // A transport failure is one machine's network: expected, and not a crash.
    expect(monitoring.reportError).not.toHaveBeenCalled();
  });

  it('never puts the message in the event', async () => {
    service.readUpdateEnvironment.mockResolvedValue({ installKind: 'app', selfUpdateSupported: true });
    service.checkForUpdate.mockRejectedValue(new UpdateCheckError('connect', chain));

    await runUpdateCheck('automatic');

    const failed = analytics.track.mock.calls.filter(([name]) => name === 'app update failed');
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed[0]?.[1])).not.toContain('example.invalid');
  });

  it('sends a manifest-class failure to Sentry, since it is the release and not the machine', async () => {
    service.readUpdateEnvironment.mockResolvedValue({ installKind: 'app', selfUpdateSupported: true });
    const failure = new UpdateCheckError('parse', 'missing field `platforms`');
    service.checkForUpdate.mockRejectedValue(failure);

    await expect(runUpdateCheck('manual')).resolves.toBe('failed');

    expect(analytics.track).toHaveBeenCalledWith('app update failed', {
      stage: 'check',
      reason: 'parse',
      install_kind: 'app',
      trigger: 'manual',
    });
    expect(monitoring.reportError).toHaveBeenCalledWith(failure, {
      surface: 'updater:check',
      tags: { reason: 'parse' },
    });
  });

  it('still reports when the environment itself could not be read', async () => {
    service.readUpdateEnvironment.mockRejectedValue(new Error('update_environment is not allowed'));

    await expect(runUpdateCheck('manual')).resolves.toBe('failed');

    expect(analytics.track).toHaveBeenCalledWith('app update failed', {
      stage: 'check',
      reason: 'unknown',
      install_kind: null,
      trigger: 'manual',
    });
  });

  it('counts a check that found nothing', async () => {
    service.readUpdateEnvironment.mockResolvedValue({ installKind: 'app', selfUpdateSupported: true });
    service.checkForUpdate.mockResolvedValue(null);

    await expect(runUpdateCheck('automatic')).resolves.toBe('none');

    expect(analytics.track).toHaveBeenCalledWith('app update checked', {
      result: 'none',
      trigger: 'automatic',
    });
    expect(useUpdateStore.getState().lastCheck).toMatchObject({ ok: true });
  });
});
