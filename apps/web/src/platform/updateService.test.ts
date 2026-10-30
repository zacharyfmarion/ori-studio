import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Check, download and install each cross into the shell and come back either as
 * a value or as a classified failure. What is worth pinning is the boundary:
 * the timeout goes across, the handles the shell returned are the ones handed
 * back, a staged payload survives a re-offer of its own version, and only a
 * kind inside the enum is believed.
 */

const core = vi.hoisted(() => ({ invoke: vi.fn(), closed: [] as number[] }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: core.invoke,
  Resource: class {
    constructor(readonly rid: number) {}
    async close() {
      core.closed.push(this.rid);
    }
  },
}));

const process = vi.hoisted(() => ({ relaunch: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: process.relaunch }));

const {
  UPDATE_CHECK_TIMEOUT_MS,
  UpdateCheckError,
  checkForUpdate,
  downloadUpdate,
  installUpdateAndRelaunch,
  isUpdateStaged,
  resetUpdateServiceForTest,
} = await import('./updateService');

const offer = (rid: number, version = '0.6.0') => ({
  rid,
  currentVersion: '0.5.1',
  version,
  date: '2026-09-28T12:00:00Z',
  body: null,
  rawJson: {},
});

const TAURI_KEY = '__TAURI_INTERNALS__';
const host = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  host[TAURI_KEY] = {};
  core.invoke.mockReset();
  core.closed.length = 0;
  process.relaunch.mockClear();
  resetUpdateServiceForTest();
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

  it('reports the offer, and downloads and installs it by the handles the shell gave', async () => {
    core.invoke.mockResolvedValueOnce(offer(3));

    await expect(checkForUpdate()).resolves.toEqual({
      version: '0.6.0',
      notes: undefined,
      publishedAt: '2026-09-28T12:00:00Z',
    });
    expect(isUpdateStaged('0.6.0')).toBe(false);

    core.invoke.mockResolvedValueOnce(9);
    await expect(downloadUpdate('0.6.0')).resolves.toBeUndefined();
    expect(core.invoke).toHaveBeenLastCalledWith('update_download', { rid: 3 });
    expect(isUpdateStaged('0.6.0')).toBe(true);

    core.invoke.mockResolvedValueOnce(undefined);
    await installUpdateAndRelaunch('0.6.0');
    expect(core.invoke).toHaveBeenLastCalledWith('update_install', {
      updateRid: 3,
      payloadRid: 9,
    });
    expect(process.relaunch).toHaveBeenCalledOnce();
  });

  it('keeps a staged payload when the same version is offered again', async () => {
    core.invoke.mockResolvedValueOnce(offer(3)).mockResolvedValueOnce(9);
    await checkForUpdate();
    await downloadUpdate('0.6.0');

    core.invoke.mockResolvedValueOnce(offer(4));
    await checkForUpdate();

    expect(isUpdateStaged('0.6.0')).toBe(true);
    // The new offer's handle is the redundant one.
    expect(core.closed).toEqual([4]);
    const calls = core.invoke.mock.calls.length;
    await downloadUpdate('0.6.0');
    expect(core.invoke.mock.calls.length).toBe(calls);
  });

  it('drops the staged payload when a newer version is offered', async () => {
    core.invoke.mockResolvedValueOnce(offer(3)).mockResolvedValueOnce(9);
    await checkForUpdate();
    await downloadUpdate('0.6.0');

    core.invoke.mockResolvedValueOnce(offer(5, '0.6.1'));
    await checkForUpdate();

    expect(isUpdateStaged('0.6.0')).toBe(false);
    expect(isUpdateStaged('0.6.1')).toBe(false);
    expect(core.closed).toEqual([3, 9]);
  });

  it('carries the kind the shell classified for a failed download', async () => {
    core.invoke.mockResolvedValueOnce(offer(3));
    await checkForUpdate();
    core.invoke.mockRejectedValueOnce({
      kind: 'network',
      message: 'the connection closed after 4000 of 42044001 bytes',
    });

    const failure = await downloadUpdate('0.6.0').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UpdateCheckError);
    expect(failure).toMatchObject({ kind: 'network' });
    expect(isUpdateStaged('0.6.0')).toBe(false);
  });

  it('will not install what was never downloaded', async () => {
    core.invoke.mockResolvedValueOnce(offer(3));
    await checkForUpdate();

    await expect(installUpdateAndRelaunch('0.6.0')).rejects.toThrow('no downloaded update');
    expect(process.relaunch).not.toHaveBeenCalled();
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
