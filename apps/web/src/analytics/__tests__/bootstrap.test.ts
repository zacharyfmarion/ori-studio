import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fingerprintError,
  inferErrorDomain,
  initializePostHog,
  type PostHogClientLike,
} from '../bootstrap';
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

const KEY_ENV = {
  VITE_PUBLIC_POSTHOG_KEY: 'phc_test',
  VITE_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com',
  DEV: false,
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('initializePostHog', () => {
  it('does nothing and returns false when the key/host are absent (the firewall)', () => {
    const client = makeFakeClient();
    const ready = initializePostHog(client, { analyticsEnabled: true }, { DEV: false });
    expect(ready).toBe(false);
    expect(client.init).not.toHaveBeenCalled();
    expect(client.capture).not.toHaveBeenCalled();
  });

  it('initializes with the hardened, privacy-preserving config when keys are present', () => {
    const client = makeFakeClient();
    const ready = initializePostHog(client, { analyticsEnabled: true }, KEY_ENV);
    expect(ready).toBe(true);
    expect(client.init).toHaveBeenCalledTimes(1);
    const [token, config] = client.init.mock.calls[0];
    expect(token).toBe('phc_test');
    expect(config).toMatchObject({
      api_host: 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
      mask_all_text: true,
      mask_all_element_attributes: true,
      disable_session_recording: true,
      disable_surveys: true,
      autocapture: true,
    });
  });

  it('opts in and identifies with a persisted stable id when enabled', () => {
    const client = makeFakeClient();
    initializePostHog(client, { analyticsEnabled: true }, KEY_ENV);
    expect(client.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
    expect(client.identify).toHaveBeenCalledTimes(1);
    const id = client.identify.mock.calls[0][0];
    expect(id).toBeTruthy();
    expect(peekStableId()).toBe(id);
    expect(client.opt_out_capturing).not.toHaveBeenCalled();
  });

  it('opts out and never identifies when disabled', () => {
    const client = makeFakeClient();
    initializePostHog(client, { analyticsEnabled: false }, KEY_ENV);
    expect(client.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(client.opt_in_capturing).not.toHaveBeenCalled();
    expect(client.identify).not.toHaveBeenCalled();
  });

  it('registers only non-identifying super properties', () => {
    const client = makeFakeClient();
    initializePostHog(client, { analyticsEnabled: true }, KEY_ENV);
    const props = client.register.mock.calls[0][0];
    expect(props).toMatchObject({ analytics_enabled: true, runtime_surface: 'web' });
    expect(props.app_version).toBeTypeOf('string');
  });
});

describe('fingerprintError', () => {
  it('strips volatile bits so the same failure shape dedupes', () => {
    const a = fingerprintError(new Error('Failed at 12 for "foo.osf"'));
    const b = fingerprintError(new Error('Failed at 99 for "bar.osf"'));
    expect(a).toBe(b);
  });

  it('never includes a raw path or filename', () => {
    const fp = fingerprintError(new Error('cannot read /Users/x/secret.osf'));
    expect(fp).not.toContain('secret.osf');
    expect(fp).not.toContain('/Users/x');
  });
});

describe('inferErrorDomain', () => {
  it('classifies known sources and defaults to runtime', () => {
    expect(inferErrorDomain('CreaseExportDialog')).toBe('file_io');
    expect(inferErrorDomain('SomeCanvasRenderer')).toBe('render');
    expect(inferErrorDomain('SettingsModal')).toBe('settings');
    expect(inferErrorDomain(undefined)).toBe('runtime');
  });
});
