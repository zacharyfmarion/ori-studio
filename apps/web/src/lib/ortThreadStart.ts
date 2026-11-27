/**
 * ONNX Runtime's threads failing to start, as an error instead of a hang.
 *
 * The threaded runtime starts each of its threads as a nested worker when it
 * first loads, and waits for all of them before anything else can run. A
 * thread whose worker cannot be loaded gets a plain `Event` (not an
 * `ErrorEvent`, so no message), and the runtime's handler for it rethrows that
 * event: `throw` in the pthread `onerror` of its Emscripten glue. In the worker
 * hosting the runtime that was an uncaught "[object Event]", and the session
 * being built never came back. Seen on Windows desktop (ORI-STUDIO-1S); why the
 * thread could not load there is not known.
 */
import type { WasmErrorEnvelope } from '../engine/types';

export const ORT_THREADS_UNAVAILABLE_CODE = 'cp_detect_threads_unavailable';

export const ORT_THREADS_UNAVAILABLE: WasmErrorEnvelope = {
  code: ORT_THREADS_UNAVAILABLE_CODE,
  message: 'The detector could not start its background threads.',
};

type WorkerConstructor = abstract new (...args: never[]) => object;

/**
 * Is `thrown` the event a worker gets when its script could not be loaded?
 * An `ErrorEvent` is a thread that ran and threw, which is a crash, not this.
 */
export function isWorkerLoadFailure(
  thrown: unknown,
  WorkerType: WorkerConstructor | undefined = globalThis.Worker
): boolean {
  if (typeof Event === 'undefined' || !(thrown instanceof Event)) return false;
  if (typeof ErrorEvent !== 'undefined' && thrown instanceof ErrorEvent) return false;
  return thrown.type === 'error' && WorkerType !== undefined && thrown.target instanceof WorkerType;
}

/**
 * Watch `scope`, the worker hosting the runtime, for a thread that could not
 * be loaded. The promise rejects with {@link ORT_THREADS_UNAVAILABLE} the first
 * time one fails, so whatever waits on the runtime's start can race it.
 *
 * The uncaught event is cancelled, because this is where it is handled: the page
 * hears about it as that rejection, not as a crash of the whole worker (which
 * the browser would also report again in the page as "Uncaught [object Event]").
 */
export function watchOrtThreadStart(
  scope: EventTarget,
  WorkerType: WorkerConstructor | undefined = globalThis.Worker
): Promise<never> {
  let fail: (failure: WasmErrorEnvelope) => void = () => {};
  const failure = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  // A failure nothing is waiting on yet is not an unhandled rejection; a race
  // started later still sees it.
  failure.catch(() => {});
  scope.addEventListener('error', (event) => {
    if (!(event instanceof ErrorEvent) || !isWorkerLoadFailure(event.error, WorkerType)) return;
    event.preventDefault();
    fail(ORT_THREADS_UNAVAILABLE);
  });
  return failure;
}

/** Is `error` the rejection {@link watchOrtThreadStart} raises? */
export function isOrtThreadStartFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === ORT_THREADS_UNAVAILABLE_CODE
  );
}
