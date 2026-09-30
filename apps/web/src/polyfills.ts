/**
 * Runtime built-ins the app calls that its oldest supported engine may not have.
 *
 * The build targets ES2022 *syntax* (`vite.config.ts`), and esbuild lowers syntax only: a
 * method the engine never shipped stays a `TypeError` at the call site. The desktop shell
 * runs on whatever WebKit the user's macOS carries (`minimumSystemVersion` is 10.15), and a
 * Safari from before 15.4 parses every construct in the bundle and still has no
 * `Array.prototype.at`. On that machine the app started fine, and every ⌘Z threw
 * `s.at is not a function` inside `undo` — ORI-STUDIO-C: one user, three days, 21 undos
 * pressed and not one of them went through.
 *
 * `AbortSignal.timeout` is the same story one release later: Safari 16 added it, Catalina's
 * WebKit stops at 15.6, and there every ExplOri search threw before its request was made —
 * one user, 13 searches, all reported as `unknown`, no stack anywhere because the store's
 * catch swallowed it. PostHog saw the shape; Sentry never saw the error.
 *
 * Imported first from `main.tsx`, ahead of anything that could call these at module scope.
 * The workers do not import it: none of them use these built-ins, and each is its own global.
 */

/**
 * `Array.prototype.at`, per spec: integer-truncated, negative from the end, `undefined`
 * outside the bounds.
 */
export function arrayAt<T>(this: ArrayLike<T>, index: number): T | undefined {
  const length = this.length;
  let k = Math.trunc(Number(index));
  if (Number.isNaN(k)) k = 0;
  if (k < 0) k += length;
  return k < 0 || k >= length ? undefined : this[k];
}

/**
 * `AbortSignal.timeout`, as far as a caller can observe: a signal that is aborted after
 * `milliseconds`, with a `TimeoutError` as its reason on an engine that keeps one.
 */
export function abortSignalTimeout(milliseconds: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(
    () => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')),
    milliseconds
  );
  return controller.signal;
}

type PolyfillTarget = {
  Array: { prototype: object };
  AbortSignal?: object;
};

/** Install what is missing, and only what is missing. Idempotent. */
export function installPolyfills(target: PolyfillTarget = globalThis): void {
  // `defineProperty` rather than assignment, so each polyfill is non-enumerable like the
  // built-in it stands in for — a `for…in` over an array must not see it.
  const proto = target.Array.prototype as { at?: unknown };
  if (typeof proto.at !== 'function') {
    Object.defineProperty(proto, 'at', {
      value: arrayAt,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  const abortSignal = target.AbortSignal as { timeout?: unknown } | undefined;
  if (abortSignal && typeof abortSignal.timeout !== 'function') {
    Object.defineProperty(abortSignal, 'timeout', {
      value: abortSignalTimeout,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
}

installPolyfills();
