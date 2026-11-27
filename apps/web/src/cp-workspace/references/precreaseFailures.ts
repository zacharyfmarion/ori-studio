/**
 * The precrease bridge's own reason a call rejects when the bridge did not
 * start, shared by the worker that throws it (`workers/precreaseWorker.ts`)
 * and the References code that reads it (`referencesLoadFailure.ts`). A leaf,
 * with no imports, so the worker carries nothing of the page's.
 */

/** A call's rejection when the bridge's wasm did not load or compile: nothing ran. */
export const PRECREASE_UNAVAILABLE = 'precrease_unavailable';

/** Whether `error` is a call's rejection because the bridge did not start. */
export function isPrecreaseUnavailable(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === PRECREASE_UNAVAILABLE;
}
