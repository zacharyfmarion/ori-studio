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
 *
 * **A worker's crash is reported here, once.** The browser reports an
 * exception a worker did not catch twice: as an `ErrorEvent` at the `Worker`
 * object, and then, unless a listener there cancels it, again in the page, as
 * an uncaught error at `window` (the HTML spec's "report an exception";
 * Chromium and WebKit both do it). That second copy has no worker's name and
 * no stack, and it reached Sentry's global handler as "Uncaught [object
 * Event]" and the app's own as a "Something went wrong in the background"
 * toast, on top of the owner's message (ORI-STUDIO-1S). So
 * {@link attachWorkerDiagnostics} cancels it and files the report itself, a
 * {@link WorkerCrash}, as an error boundary would. A worker that never loaded
 * gets a plain `error` event, which the browser reports nowhere else, so that
 * one is left to its owner.
 */

import { trackAnalyticsError } from '../analytics';
import { reportError } from '../monitoring';

export type WorkerName =
  | 'treemaker'
  | 'oristudio-cp'
  | 'oristudio-bp'
  | 'oristudio-bp-optimizer'
  | 'simulator'
  | 'cp-detect'
  /** One exact solve, spawned per run and terminated to cancel it. */
  | 'cp-exact-solve'
  /** One ReferenceFinder database per worker; see store/workspaceStore/referenceFinderRuntime.ts. */
  | 'reference-finder'
  /** The precrease planner bridge; see store/workspaceStore/precreaseRuntime.ts. */
  | 'precrease'
  /** The Fold engine's bridge; see store/workspaceStore/foldSequenceRuntime.ts. */
  | 'fold-sequence'
  /** A Layer order engine: the dialog's session and its count, or a host's; see layer-order/engine/layerOrderRuntime.ts. */
  | 'layer-order'
  /** One diagram PDF, spawned per export and terminated after it; see diagram/export/browserPdfWriter.ts. */
  | 'diagram-pdf'
  | 'cp-task'
  | 'defox-import';

export interface WorkerFailure {
  worker: WorkerName;
  /** `error` is a dead worker; `messageerror` is a message it could not deserialize. */
  kind: 'error' | 'messageerror';
  message: string;
  /**
   * The worker never ran: its `error` is a plain event, not an `ErrorEvent`.
   * The HTML spec fires one at a worker whose script, or a module it imports,
   * could not be fetched or parsed (offline, a deploy that removed it), and an
   * `ErrorEvent` for an exception thrown while it runs. Always said by
   * {@link attachWorkerDiagnostics}; a failure an owner makes up itself (a
   * build that failed inside a live worker) leaves it out.
   */
  loadFailed?: boolean;
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
 * The schemes the app's own scripts load from: the web's, and the desktop
 * shell's `tauri://` (macOS and Linux; Windows serves it over http).
 */
const APP_SCRIPT_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'tauri:']);

/**
 * Where in the worker it threw, as a stack line, or null. Only for a script
 * loaded from one of {@link APP_SCRIPT_SCHEMES}, and without its query or
 * hash: a `blob:` or `data:` URL can carry a whole payload, and is not a
 * script of ours anyway.
 */
function workerErrorFrame(event: ErrorEvent): string | null {
  let url: URL;
  try {
    url = new URL(event.filename);
  } catch {
    return null;
  }
  if (!APP_SCRIPT_SCHEMES.has(url.protocol)) return null;
  url.search = '';
  url.hash = '';
  return event.lineno > 0 ? `${url.href}:${event.lineno}:${event.colno}` : url.href;
}

/**
 * A worker that threw and did not catch it, as {@link attachWorkerDiagnostics}
 * reports it: named for the worker, with one stack frame at the place it
 * threw. The page never gets the worker's own stack (the event's `error` is
 * null), only that place. It is the frame Sentry's global handler took from
 * the page's copy, so a crash still groups by where it threw.
 */
export class WorkerCrash extends Error {
  readonly worker: WorkerName;

  constructor(worker: WorkerName, event: ErrorEvent) {
    super(`${worker}: ${describeWorkerEvent(event)}`);
    this.name = 'WorkerCrash';
    this.worker = worker;
    const frame = workerErrorFrame(event);
    this.stack = frame ? `${this.name}: ${this.message}\n    at ${frame}` : `${this.name}: ${this.message}`;
  }
}

export interface WorkerDiagnosticsOptions {
  /**
   * The owner files its own Sentry report for every crash it is told about,
   * as the Fold and Layer order engines do (`FoldEngineCrash`,
   * `LayerOrderEngineCrash`), so no {@link WorkerCrash} is filed beside it.
   * Only for a report the observer itself makes: one that a caller further
   * along may or may not make is not one.
   */
  reportsCrashes?: boolean;
}

/**
 * Report a crash the page will no longer report: to Sentry unless the owner
 * did, and always as PostHog's `app error`, the pair an error boundary sends.
 */
function reportCrash(worker: WorkerName, event: ErrorEvent, ownerReported: boolean): void {
  try {
    const crash = new WorkerCrash(worker, event);
    const surface = `worker:${worker}`;
    // `reportError` never throws, so counting it below cannot cost the report.
    if (!ownerReported) reportError(crash, { surface });
    trackAnalyticsError({ error: crash, sourceComponent: surface, domain: 'runtime' });
  } catch {
    // Reporting must never stop the owner and the user hearing of the failure.
  }
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
 *
 * An owner that tells the user itself answers `'handled'`, and the sink is
 * not told: the Layer order engine's worker the browser failed to load
 * (offline) is the dialog's lost state or a host's toast, never "The worker
 * stopped unexpectedly." as well.
 *
 * A crash (an `ErrorEvent`: the worker threw) is cancelled, so the page does
 * not report it a second time, and reported here instead, whatever the owner
 * answers: telling the user is not reporting the defect. An owner that reports
 * its crashes itself says so ({@link WorkerDiagnosticsOptions.reportsCrashes}).
 */
export function attachWorkerDiagnostics(
  worker: Worker,
  name: WorkerName,
  observe?: (failure: WorkerFailure) => void | 'handled',
  options: WorkerDiagnosticsOptions = {}
): () => void {
  const report = (kind: WorkerFailure['kind']) => (event: Event) => {
    const crashed = kind === 'error' && event instanceof ErrorEvent;
    if (crashed) event.preventDefault();
    const failure: WorkerFailure = {
      worker: name,
      kind,
      message: describeWorkerEvent(event),
      loadFailed: kind === 'error' && !crashed,
    };
    console.error(`[ori-studio] worker "${name}" ${kind}`, event);
    let handled = false;
    let observed = false;
    try {
      handled = observe?.(failure) === 'handled';
      observed = true;
    } catch {
      // An owner that throws while dropping its client must not stop the user
      // from being told the worker died.
    }
    // An owner that threw may not have got as far as its own report.
    if (crashed) reportCrash(name, event, observed && options.reportsCrashes === true);
    if (handled) return;
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
