import { wrap, type Remote } from 'comlink';
import type { InspectorUploadWorkerApi } from './uploadWorker';

export type InspectorUploadClient = Remote<InspectorUploadWorkerApi>;

let worker: Worker | null = null;
let client: InspectorUploadClient | null = null;

export function getInspectorUploadClient(): InspectorUploadClient {
  if (client) return client;
  worker = new Worker(new URL('./uploadWorker.ts', import.meta.url), {
    type: 'module',
  });
  client = wrap<InspectorUploadWorkerApi>(worker);
  return client;
}

export function releaseInspectorUploadClient(): void {
  worker?.terminate();
  worker = null;
  client = null;
}

export function inspectorUploadError(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return error instanceof Error ? error.message : String(error);
}
