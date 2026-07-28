import { describeError } from './errorReport';

/**
 * Catches the errors no React boundary can see: throws from timers, `rAF`
 * callbacks, and event handlers, plus promise rejections nobody awaited.
 *
 * Before this, those went to the console and nowhere else — the user saw a
 * feature silently not happen.
 *
 * Presentation-free on purpose: it does the listener wiring, deduping, and rate
 * limiting, and hands each surviving report to `onError`. The toast lives in
 * `components/errors/GlobalErrorReporter.tsx`, which is where i18n and sonner
 * belong.
 *
 * React boundary-caught errors do **not** arrive here — React 19 only re-raises
 * *uncaught* errors through `reportError`, and routes boundary-caught ones to
 * `console.error` — so a contained panel crash does not double-report.
 */

export type GlobalErrorKind = 'error' | 'unhandledrejection';

export interface GlobalErrorEvent {
  kind: GlobalErrorKind;
  error: unknown;
  /** Stable identity used for deduping; also useful as a toast id. */
  key: string;
}

export interface GlobalErrorHandlerOptions {
  onError: (event: GlobalErrorEvent) => void;
  /** Defaults to `window`. Injectable for tests. */
  target?: EventTarget;
  /** Defaults to `Date.now`. Injectable for tests. */
  now?: () => number;
  /** Suppress an identical error seen again within this long. */
  dedupeMs?: number;
  /** At most `limit` reports per `windowMs`. */
  limit?: number;
  windowMs?: number;
}

/**
 * The same error usually recurs because the same broken state is still there;
 * one report per occurrence-burst is what a user can act on.
 */
const DEFAULT_DEDUPE_MS = 5000;
/**
 * A throw inside a rAF loop fires every frame. Three toasts inform; three
 * hundred are their own outage.
 */
const DEFAULT_LIMIT = 3;
const DEFAULT_WINDOW_MS = 10_000;

/** First stack frame, which separates same-message errors from different call sites. */
function firstFrame(error: unknown): string {
  const stack = error instanceof Error ? error.stack : null;
  if (typeof stack !== 'string') return '';
  const lines = stack.split('\n');
  return lines.length > 1 ? lines[1].trim() : '';
}

export function globalErrorKey(kind: GlobalErrorKind, error: unknown): string {
  return `${kind}:${describeError(error)}:${firstFrame(error)}`;
}

export function installGlobalErrorHandlers(options: GlobalErrorHandlerOptions): () => void {
  const {
    onError,
    target = typeof window === 'undefined' ? null : window,
    now = Date.now,
    dedupeMs = DEFAULT_DEDUPE_MS,
    limit = DEFAULT_LIMIT,
    windowMs = DEFAULT_WINDOW_MS,
  } = options;

  if (!target) return () => undefined;

  const lastSeen = new Map<string, number>();
  let recent: number[] = [];

  function shouldReport(key: string): boolean {
    const at = now();

    const previous = lastSeen.get(key);
    if (previous !== undefined && at - previous < dedupeMs) return false;
    lastSeen.set(key, at);

    recent = recent.filter((stamp) => at - stamp < windowMs);
    if (recent.length >= limit) return false;
    recent.push(at);

    return true;
  }

  function report(kind: GlobalErrorKind, error: unknown): void {
    const key = globalErrorKey(kind, error);
    if (!shouldReport(key)) return;
    try {
      onError({ kind, error, key });
    } catch {
      // A failing reporter must not become the next unhandled error.
    }
  }

  // Deliberately no `preventDefault()`: devtools should keep logging these
  // exactly as it did before, so a developer's normal debugging still works.
  const onWindowError = (event: Event) => {
    const errorEvent = event as ErrorEvent;
    report('error', errorEvent.error ?? errorEvent.message ?? event);
  };

  const onRejection = (event: Event) => {
    report('unhandledrejection', (event as PromiseRejectionEvent).reason);
  };

  target.addEventListener('error', onWindowError);
  target.addEventListener('unhandledrejection', onRejection);

  return () => {
    target.removeEventListener('error', onWindowError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
