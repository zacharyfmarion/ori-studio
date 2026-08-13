import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The web transport rests on two facts nothing else in this repo exercises: a
 * `SharedArrayBuffer` handed to a worker stays *shared* rather than copied, and a
 * main-thread `Atomics.store` into it is therefore visible to a worker whose
 * event loop is blocked inside a fold. Everything here is written against those.
 *
 * The Comlink hop is stood in for by `structuredClone`, which is the same
 * serialization a `postMessage` performs — a real worker cannot be spawned in
 * jsdom, and a fake client that simply keeps the reference would prove nothing.
 */

const invoke = vi.fn(() => Promise.resolve());
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...(args as [])),
}));

const TAURI_KEY = '__TAURI_INTERNALS__';

function setIsolated(isolated: boolean): void {
  Object.defineProperty(globalThis, 'crossOriginIsolated', {
    value: isolated,
    configurable: true,
  });
}

function setDesktop(desktop: boolean): void {
  const host = globalThis as unknown as Record<string, unknown>;
  if (desktop) host[TAURI_KEY] = {};
  else delete host[TAURI_KEY];
}

/** A fresh module instance, so the memoized buffer and run counter start clean. */
async function loadModule(options: { isolated?: boolean; desktop?: boolean } = {}) {
  vi.resetModules();
  setIsolated(options.isolated ?? true);
  setDesktop(options.desktop ?? false);
  return import('./foldCancellation');
}

/** Records what a connected CP client was handed, after a structured-clone hop. */
function fakeClient() {
  const received: SharedArrayBuffer[] = [];
  return {
    received,
    setCancelBuffer: vi.fn(async (shared: SharedArrayBuffer) => {
      received.push(structuredClone(shared));
    }),
  };
}

afterEach(() => {
  invoke.mockClear();
  setDesktop(false);
});

describe('web transport', () => {
  it('makes a main-thread cancel visible to the worker that was handed the buffer', async () => {
    const { beginFoldRun, cancelFoldRun, installFoldCancellation } = await loadModule();
    const client = fakeClient();
    installFoldCancellation(client);
    await vi.waitFor(() => expect(client.received).toHaveLength(1));

    const runId = beginFoldRun();
    cancelFoldRun(runId);

    // What the kernel reads: slot 0 of the worker's own view of the buffer.
    const workerView = new Int32Array(client.received[0]);
    expect(Atomics.load(workerView, 0)).toBe(runId);
  });

  it('cancels the exact run and nothing else', async () => {
    const { beginFoldRun, cancelFoldRun, installFoldCancellation } = await loadModule();
    const client = fakeClient();
    installFoldCancellation(client);
    await vi.waitFor(() => expect(client.received).toHaveLength(1));

    const first = beginFoldRun();
    const second = beginFoldRun();
    expect(second).not.toBe(first);

    cancelFoldRun(second);
    const workerView = new Int32Array(client.received[0]);
    // A watermark would have taken `first` down with it. The kernel matches
    // exactly, so the slot must name one run, and the later Stop replaces the
    // earlier one rather than accumulating.
    expect(Atomics.load(workerView, 0)).toBe(second);
    cancelFoldRun(first);
    expect(Atomics.load(workerView, 0)).toBe(first);
  });

  it('leaves a respawned worker able to cancel', async () => {
    const { beginFoldRun, cancelFoldRun, installFoldCancellation } = await loadModule();
    const dead = fakeClient();
    installFoldCancellation(dead);
    await vi.waitFor(() => expect(dead.received).toHaveLength(1));

    // What `connectEngine` does after `announceLoss`: a brand-new client with no
    // memory of the old one. Installed anywhere but the connector, this is where
    // cancellation would go quietly dead with the button still enabled.
    const respawned = fakeClient();
    installFoldCancellation(respawned);
    await vi.waitFor(() => expect(respawned.received).toHaveLength(1));

    const runId = beginFoldRun();
    cancelFoldRun(runId);
    expect(Atomics.load(new Int32Array(respawned.received[0]), 0)).toBe(runId);
  });

  it('reports itself unavailable, and stays harmless, without cross-origin isolation', async () => {
    const { cancelFoldRun, foldCancellationAvailable, foldCancellationBuffer, installFoldCancellation } =
      await loadModule({ isolated: false });
    const client = fakeClient();

    // The CP wasm module's memory is unshared, so the engine boots here and
    // folds run normally — only stopping them is out of reach. Degraded, not
    // broken, and the UI can ask which it is.
    expect(foldCancellationAvailable()).toBe(false);
    expect(foldCancellationBuffer()).toBeNull();
    installFoldCancellation(client);
    expect(client.setCancelBuffer).not.toHaveBeenCalled();
    expect(() => cancelFoldRun(1)).not.toThrow();
  });
});

describe('run ids', () => {
  it('never mints one the kernel treats as unbound or unaddressable', async () => {
    const { beginFoldRun, FOLD_RUN_BACKGROUND, FOLD_RUN_NONE } = await loadModule();
    const ids = Array.from({ length: 64 }, () => beginFoldRun());
    for (const id of ids) {
      expect(id).not.toBe(FOLD_RUN_NONE);
      expect(id).not.toBe(FOLD_RUN_BACKGROUND);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('refuses to cancel work the user cannot address', async () => {
    const { cancelFoldRun, FOLD_RUN_BACKGROUND, FOLD_RUN_NONE, installFoldCancellation } =
      await loadModule();
    const client = fakeClient();
    installFoldCancellation(client);
    await vi.waitFor(() => expect(client.received).toHaveLength(1));
    const workerView = new Int32Array(client.received[0]);

    // The 3D rehydrate and the export-dialog fold run as BACKGROUND. Writing
    // either of these into the slot would stop a fold nobody asked to stop.
    cancelFoldRun(FOLD_RUN_BACKGROUND);
    cancelFoldRun(FOLD_RUN_NONE);
    expect(Atomics.load(workerView, 0)).toBe(0);
  });
});

describe('desktop transport', () => {
  it('is available without shared memory, and stops the run by command', async () => {
    const { beginFoldRun, cancelFoldRun, foldCancellationAvailable } = await loadModule({
      isolated: false,
      desktop: true,
    });

    // A packaged Tauri build serves over a custom protocol with no COOP/COEP, so
    // a page-level `SharedArrayBuffer` predicate would ship Stop permanently
    // disabled on the platform where it works best. `npm run dev:desktop` hides
    // that, because its devUrl is vite and vite sets the headers.
    expect(foldCancellationAvailable()).toBe(true);

    const runId = beginFoldRun();
    cancelFoldRun(runId);
    expect(invoke).toHaveBeenCalledWith('cp_fold_cancel', { runId });
  });

  it('installs no buffer, because the native client has no worker to share with', async () => {
    const { installFoldCancellation } = await loadModule({ desktop: true });
    const client = fakeClient();
    installFoldCancellation(client);
    expect(client.setCancelBuffer).not.toHaveBeenCalled();
  });
});
