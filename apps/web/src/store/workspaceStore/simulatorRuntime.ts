import type { Remote } from 'comlink';
import { createSharedWorkerClient } from '../../lib/sharedWorkerClient';
import type { SimulatorWorkerApi } from '../../workers/simulatorWorker';
import { attachWorkerDiagnostics } from '../../lib/workerDiagnostics';

export type SimulatorClient = Remote<SimulatorWorkerApi>;

// Owns the simulator worker singleton, following the same shape as the other
// *Runtime modules in this directory.
//
// Unlike the CP and BP runtimes there is no desktop native path: the simulator
// is a TypeScript port and runs identically in the browser and in the Tauri
// webview, so one worker serves both.
//
// Lifetime is reference-counted rather than left to the page. The worker holds a
// whole triangulated model plus solver state -- tens of megabytes on a large
// crease pattern -- and, more sharply, a WebGL2 context out of a budget of four
// per worker. The previous teardown function was never called from anywhere in
// the app, so both stayed resident for the life of the tab.
//
// A count rather than a single owner, because the simulator has more than one
// consumer: the Simulate panel, and inline simulation windows in the Edit
// workspace. Last one out turns the lights off.

const shared = createSharedWorkerClient<SimulatorWorkerApi>(() => {
  const worker = new Worker(new URL('../../workers/simulatorWorker.ts', import.meta.url), { type: 'module' });
  attachWorkerDiagnostics(worker, 'simulator');
  return worker;
});

/**
 * Take a reference to the simulator worker, starting it if needed. Every caller
 * must pair this with {@link releaseSimulatorClient}.
 */
export function retainSimulatorClient(): SimulatorClient {
  return shared.retain();
}

/**
 * Drop a reference. When the last one goes the worker is terminated outright:
 * there is no useful idle state for it to sit in, and a retained session holds
 * both the memory and the GL context indefinitely.
 */
export function releaseSimulatorClient(): void {
  shared.release();
}

/**
 * The running worker, or null when nothing holds a reference. For callers that
 * want to read the *live* simulation — the folded-form exporters — and for which
 * "no simulator is open" is a normal answer rather than a reason to start one.
 */
export function peekSimulatorClient(): SimulatorClient | null {
  return shared.peek();
}

/** Live reference count, for tests and diagnostics. */
export function simulatorClientRefCount(): number {
  return shared.count();
}
