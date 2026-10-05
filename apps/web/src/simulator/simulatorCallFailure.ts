/**
 * How a rejected worker call is treated.
 *
 * - `worker-lost`: the worker failed. The app's worker-failure sink already
 *   told the user and reported it, so saying so again would be noise.
 * - `unexpected`: a bug. Toasted, and reported as handled.
 *
 * A stale call is not a failure at all: it resolves null, and never gets here.
 */
export type SimulatorCallFailure = 'worker-lost' | 'unexpected';

export function classifySimulatorCallFailure(error: unknown): SimulatorCallFailure {
  const code =
    error !== null && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : null;
  return typeof code === 'string' && code.startsWith('worker_') ? 'worker-lost' : 'unexpected';
}

/** Which renderer answered a call, as error reports tag it. */
export function simulatorBackendTag(gpuActive: boolean): string {
  return gpuActive ? 'gpu' : 'canvas-2d';
}
