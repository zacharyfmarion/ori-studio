import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The check crosses into the shell and comes back either as the plugin's own
 * metadata shape or as a classified failure. What is worth pinning is the
 * boundary: the timeout goes across, the plugin's `Update` handle is built from
 * exactly what came back, and only a kind inside the enum is believed.
 */

const core = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: core.invoke }));

const plugin = vi.hoisted(() => ({ constructed: [] as unknown[] }));
vi.mock('@tauri-apps/plugin-updater', () => ({
  Update: class {
    version: string;
    body?: string;
    date?: string;
    download = vi.fn(async () => {});

    constructor(metadata: { version: string; body?: string; date?: string }) {
      plugin.constructed.push(metadata);
      this.version = metadata.version;
      this.body = metadata.body;
      this.date = metadata.date;
    }
  },
}));

const { UPDATE_CHECK_TIMEOUT_MS, UpdateCheckError, checkForUpdate, downloadUpdate } =
  await import('./updateService');

const TAURI_KEY = '__TAURI_INTERNALS__';
const host = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  host[TAURI_KEY] = {};
  core.invoke.mockReset();
  plugin.constructed.length = 0;
});

afterEach(() => {
  delete host[TAURI_KEY];
});

describe('checkForUpdate', () => {
  it('asks the shell, with a time budget, and reports nothing newer as null', async () => {
    core.invoke.mockResolvedValue(null);
    await expect(checkForUpdate()).resolves.toBeNull();
    expect(core.invoke).toHaveBeenCalledWith('update_check', {
      timeoutMs: UPDATE_CHECK_TIMEOUT_MS,
    });
  });

  it("builds the plugin's handle from the shell's metadata, so download stays the plugin's", async () => {
    core.invoke.mockResolvedValue({
      rid: 3,
      currentVersion: '0.5.1',
      version: '0.6.0',
      date: '2026-09-28T12:00:00Z',
      body: null,
      rawJson: {},
    });

    await expect(checkForUpdate()).resolves.toEqual({
      version: '0.6.0',
      notes: undefined,
      publishedAt: '2026-09-28T12:00:00Z',
    });
    expect(plugin.constructed).toEqual([
      {
        rid: 3,
        currentVersion: '0.5.1',
        version: '0.6.0',
        date: '2026-09-28T12:00:00Z',
        body: undefined,
        rawJson: {},
      },
    ]);
    await expect(downloadUpdate('0.6.0')).resolves.toBeUndefined();
  });

  it('carries the kind the shell classified', async () => {
    core.invoke.mockRejectedValue({
      kind: 'proxy',
      message:
        'error sending request for url (https://x/latest.json): client error (Connect): tunnel error: failed to create underlying connection',
    });

    const failure = await checkForUpdate().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UpdateCheckError);
    expect(failure).toMatchObject({ kind: 'proxy' });
    expect((failure as Error).message).toContain('tunnel error');
  });

  it('does not believe a kind from outside the enum', async () => {
    core.invoke.mockRejectedValue({ kind: 'brand_new', message: 'something' });

    const failure = await checkForUpdate().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(UpdateCheckError);
    expect((failure as Error).message).toBe('something');
  });

  it("wraps the plugin's bare-string rejection in an Error", async () => {
    core.invoke.mockRejectedValue('Could not fetch a valid release JSON from the remote');

    const failure = await checkForUpdate().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Could not fetch a valid release JSON from the remote');
  });
});
