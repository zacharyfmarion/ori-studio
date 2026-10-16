import { attachWorkerDiagnostics } from '../lib/workerDiagnostics';
import * as Comlink from 'comlink';
import { invoke } from '@tauri-apps/api/core';
import { createOristudioCpNativeClient } from '../engine/oristudioCpNativeClient';
import { isDesktopRuntime } from '../platform/runtime';
import type { OristudioCpWorkerApi } from '../workers/oristudioCpWorker';

export type CpClient = OristudioCpWorkerApi | Comlink.Remote<OristudioCpWorkerApi>;

/** An independently owned instance of the existing CP engine, never Edit's singleton. */
export interface CpTaskSession {
  client: CpClient;
  /** Every fold in this session uses this id; a cancelled session is disposed, never reused. */
  runId: number;
  run<T>(work: () => Promise<T>, signal: AbortSignal, timeoutMs?: number): Promise<T>;
  close(): Promise<void>;
}

export async function createCpTaskSession(signal?: AbortSignal): Promise<CpTaskSession> {
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
  let fail: (error: Error) => void = () => undefined;
  const failure = new Promise<never>((_, reject) => {
    fail = reject;
  });
  void failure.catch(() => undefined);
  let client: CpClient;
  let stop: () => void | Promise<void>;
  let dispose: () => Promise<void>;
  const runId = 1;
  if (isDesktopRuntime()) {
    const sessionId = await invoke<number>('cp_create_session');
    client = createOristudioCpNativeClient(sessionId);
    stop = () => invoke<void>('cp_fold_cancel', { sessionId, runId });
    dispose = () => invoke('cp_close_session', { sessionId });
  } else {
    const worker = new Worker(new URL('../workers/oristudioCpWorker.ts', import.meta.url), {
      type: 'module',
    });
    const detach = attachWorkerDiagnostics(worker, 'cp-task', (info) => fail(new Error(info.message)));
    client = Comlink.wrap<OristudioCpWorkerApi>(worker);
    const shared =
      typeof SharedArrayBuffer === 'function' && globalThis.crossOriginIsolated
        ? new SharedArrayBuffer(16)
        : null;
    if (shared) {
      const abort = () => fail(new DOMException('Import cancelled', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => fail(new Error('CP engine startup timed out')), 30_000);
      try {
        await Promise.race([client.setCancelBuffer(shared), failure]);
      } catch (error) {
        detach();
        worker.terminate();
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    }
    stop = () => {
      if (shared) Atomics.store(new Int32Array(shared), 0, runId);
    };
    // Termination is safe here: all handles belong to this disposable session.
    dispose = async () => {
      detach();
      worker.terminate();
    };
  }
  let closed = false;
  let closing: Promise<void> | null = null;
  const close = async () => {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      try {
        await stop();
      } finally {
        await dispose();
      }
    })();
    return closing;
  };
  if (signal?.aborted) {
    await close();
    throw new DOMException('Import cancelled', 'AbortError');
  }
  return {
    client,
    runId,
    close,
    async run<T>(work: () => Promise<T>, signal: AbortSignal, timeoutMs = 30_000): Promise<T> {
      if (closed || signal.aborted) throw new DOMException('Import cancelled', 'AbortError');
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort: () => void = () => undefined;
      const interrupted = new Promise<never>((_, reject) => {
        abort = () => {
          void close().catch(() => undefined);
          reject(new DOMException('Import cancelled', 'AbortError'));
        };
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => {
          void close().catch(() => undefined);
          reject(new Error('Preparation exceeded its time limit'));
        }, timeoutMs);
      });
      try {
        return await Promise.race([work(), interrupted, failure]);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    },
  };
}
