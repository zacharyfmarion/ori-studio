/**
 * Whether a failure is the network failing the browser rather than our code
 * failing: a fetch that never happened, or a download cut off partway.
 *
 * The one list of how browsers word it, for every surface that fetches what it
 * needs the first time it is needed and treats not getting it as an expected
 * condition, shown and counted, never reported to Sentry: the detector's
 * worker and wasm (`cp-workspace/images/cpDetectLoadFailure.ts`), the precrease
 * planner's wasm in References (`cp-workspace/references/referencesLoadFailure.ts`)
 * and Layer order's engine (`layer-order/engine/layerOrderLoadFailure.ts`). A
 * lazy chunk that did not load has wordings of its own, `isChunkLoadError` in
 * `importOrReload.ts`.
 *
 * - **A fetch the network refused**: Chromium's "Failed to fetch", Firefox's
 *   "NetworkError when attempting to fetch resource.", WebKit's "Load failed",
 *   "The network connection was lost." and "The Internet connection appears to
 *   be offline.".
 * - **A download cut off partway**: "Response body loading was aborted", which
 *   WebKit's streaming wasm compile wraps as "WebAssembly compilation aborted:
 *   Network error: …" (ORI-STUDIO-15). Either half says it.
 *
 * Unanchored, on purpose: the SDK that reports errors appends the host to a
 * failed fetch's message ("Failed to fetch (oristudio.dev)"), and a worker's
 * failure can arrive inside a sentence of its own.
 */
const NETWORK_FAILURE =
  /Failed to fetch|NetworkError when attempting to fetch|Load failed|network connection was lost|Internet connection appears to be offline|Response body loading was aborted|WebAssembly compilation aborted/i;

/** Whether `message` is a browser's words for a network failure (see the module docs). */
export function isNetworkFailureMessage(message: string): boolean {
  return NETWORK_FAILURE.test(message);
}

/**
 * Whether `failure` says it is a network failure: an `Error`, or the
 * `{ code, message }` envelope a worker rejects with, whose message is a
 * browser's words for one. Anything without a message is not.
 */
export function isNetworkFailure(failure: unknown): boolean {
  if (!failure || typeof failure !== 'object') return false;
  const message = (failure as { message?: unknown }).message;
  return typeof message === 'string' && isNetworkFailureMessage(message);
}

/** Whether the browser says it is offline, for a load failure's analytics: `yes` or `no`. */
export function offlineFlag(): 'yes' | 'no' {
  return typeof navigator !== 'undefined' && navigator.onLine === false ? 'yes' : 'no';
}
