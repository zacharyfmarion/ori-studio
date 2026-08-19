/**
 * Failure reporting for the app's Web Workers.
 *
 * Every engine runs in a worker behind comlink, and comlink's proxy only
 * settles when the worker answers. So a worker that dies — a wasm trap, an OOM,
 * a module that fails to load — leaves every in-flight call pending forever:
 * the surface sits on its spinner and nothing ever says why. None of the six
 * workers listened for `error` or `messageerror` before this.
 *
 * The runtime modules that own the workers deliberately do not import the
 * store, so this uses the same registered-sink indirection as
 * `registerDesignVariantSource` in `layoutStore`: the app registers a sink at
 * startup, and until it does, failures still reach the console.
 */

export type WorkerName =
  | 'treemaker'
  | 'oristudio-cp'
  | 'oristudio-bp'
  | 'oristudio-bp-optimizer'
  | 'simulator'
  | 'cp-detect';

export interface WorkerFailure {
  worker: WorkerName;
  /** `error` is a dead worker; `messageerror` is a message it could not deserialize. */
  kind: 'error' | 'messageerror';
  message: string;
}

/** Stable error code for a worker failure, e.g. `worker_oristudio_cp`. */
export function workerErrorCode(worker: WorkerName): string {
  return `worker_${worker.replace(/-/g, '_')}`;
}

type WorkerFailureSink = (failure: WorkerFailure) => void;

let sink: WorkerFailureSink | null = null;

export function registerWorkerFailureSink(next: WorkerFailureSink | null): void {
  sink = next;
}

function describeWorkerEvent(event: Event): string {
  if (event instanceof ErrorEvent && event.message) return event.message;
  return event.type === 'messageerror'
    ? 'The worker sent a message that could not be deserialized.'
    : 'The worker stopped unexpectedly.';
}

/**
 * Listen for a worker's terminal failures. Returns a disposer; call it when the
 * worker is terminated so a replacement worker's listeners are the only live
 * ones.
 *
 * `observe` is for the module that *owns* the worker, as distinct from the app's
 * single reporting `sink` (registered by `App.tsx` for the error toast). Both
 * run: the sink tells the user, the observer lets the owner drop its dead client
 * so the next call spawns a replacement. Two consumers, one set of listeners —
 * the alternative was a second pair of `error` handlers on every worker.
 */
export function attachWorkerDiagnostics(
  worker: Worker,
  name: WorkerName,
  observe?: (failure: WorkerFailure) => void,
): () => void {
  const report = (kind: WorkerFailure['kind']) => (event: Event) => {
    const failure: WorkerFailure = { worker: name, kind, message: describeWorkerEvent(event) };
    console.error(`[ori-studio] worker "${name}" ${kind}`, event);
    try {
      observe?.(failure);
    } catch {
      // An owner that throws while dropping its client must not stop the user
      // from being told the worker died.
    }
    try {
      sink?.(failure);
    } catch {
      // A failing sink must not mask the worker failure it was reporting.
    }
  };

  const onError = report('error');
  const onMessageError = report('messageerror');

  worker.addEventListener('error', onError);
  worker.addEventListener('messageerror', onMessageError);

  return () => {
    worker.removeEventListener('error', onError);
    worker.removeEventListener('messageerror', onMessageError);
  };
}
