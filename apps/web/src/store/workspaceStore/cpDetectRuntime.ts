import { wrap, type Remote } from 'comlink';
import type { WasmErrorEnvelope } from '../../engine/types';
import type { CpDetectWorkerApi } from '../../workers/cpDetectWorker';

export type CpDetectClient = Remote<CpDetectWorkerApi>;

let worker: Worker | null = null;
let client: CpDetectClient | null = null;

export function cpDetectError(error: unknown): WasmErrorEnvelope {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return error as WasmErrorEnvelope;
  }
  return {
    code: 'cp_detect',
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function getCpDetectClient(): Promise<CpDetectClient> {
  if (client) return client;
  worker = new Worker(new URL('../../workers/cpDetectWorker.ts', import.meta.url), {
    type: 'module',
  });
  client = wrap<CpDetectWorkerApi>(worker);
  return client;
}

export function releaseCpDetectClient(): void {
  worker?.terminate();
  worker = null;
  client = null;
}
