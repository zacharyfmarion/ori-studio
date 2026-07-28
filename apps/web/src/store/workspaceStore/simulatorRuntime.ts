import { wrap, type Remote } from 'comlink';
import type { SimulatorWorkerApi } from '../../workers/simulatorWorker';
import { attachWorkerDiagnostics } from '../../lib/workerDiagnostics';

export type SimulatorClient = Remote<SimulatorWorkerApi>;

// Owns the simulator worker singleton, following the same shape as the other
// *Runtime modules in this directory.
//
// Unlike the CP and BP runtimes there is no desktop native path: the simulator
// is a TypeScript port and runs identically in the browser and in the Tauri
// webview, so one worker serves both.

let worker: Worker | null = null;
let client: SimulatorClient | null = null;

export function getSimulatorClient(): SimulatorClient {
  if (client) return client;
  worker = new Worker(new URL('../../workers/simulatorWorker.ts', import.meta.url), {
    type: 'module',
  });
  attachWorkerDiagnostics(worker, 'simulator');
  client = wrap<SimulatorWorkerApi>(worker);
  return client;
}

/**
 * Tear the worker down entirely. The simulator holds a whole triangulated model
 * plus solver state, which for a large crease pattern is tens of megabytes, so
 * a panel that is closed should not keep it resident.
 */
export function releaseSimulatorWorker(): void {
  client = null;
  worker?.terminate();
  worker = null;
}
