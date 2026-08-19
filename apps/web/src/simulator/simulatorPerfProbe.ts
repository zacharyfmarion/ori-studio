/**
 * Main-thread counters for the `oristudio:sim-perf` readout.
 *
 * The worker's own `getPerfStats` covers everything past the `setCamera`
 * message. This covers what happens before and after it on this thread, which is
 * where the existing readout was blind in two specific places:
 *
 *   - **Measure.** `SimulatorViewport.deviceSize()` calls
 *     `getBoundingClientRect()` on a canvas inside a transformed overlay tree,
 *     once per orbit frame. That is a forced layout, and it happens *before*
 *     `setCamera`'s own timer starts — so a slow one was invisible.
 *   - **Present.** `transferFromImageBitmap` is where a frame actually reaches
 *     the screen. If a browser cannot take the bitmap as a GPU handle it copies
 *     it here, and the readout attributed none of that to anything.
 *
 * Exactly the trap `implementation-plans/inline-simulation-performance.md`
 * recorded for `renderGpu`, whose timer used to start after the resize it was
 * supposed to catch. Counters are a few adds and stay on; only the logger reads.
 */

interface Counter {
  count: number;
  totalMs: number;
  maxMs: number;
}

function emptyCounter(): Counter {
  return { count: 0, totalMs: 0, maxMs: 0 };
}

const counters = {
  /** `getBoundingClientRect()` in `deviceSize()` — a forced layout per frame. */
  measure: emptyCounter(),
  /** `transferFromImageBitmap` — the frame reaching the canvas. */
  present: emptyCounter(),
  /**
   * The synchronous main-thread cost of dispatching a camera message (comlink
   * proxy + structured clone). If orbit lag lives on this thread, it is here.
   */
  cameraDispatch: emptyCounter(),
  /** Dispatch → worker tick → reply, which separates a slow tick from a rare one. */
  tickRoundTrip: emptyCounter(),
};

export type SimulatorProbeName = keyof typeof counters;

/** Record one occurrence. `durationMs` is wall time on this thread. */
export function recordSimulatorProbe(name: SimulatorProbeName, durationMs: number): void {
  const counter = counters[name];
  counter.count += 1;
  counter.totalMs += durationMs;
  if (durationMs > counter.maxMs) counter.maxMs = durationMs;
}

export interface SimulatorProbeSnapshot {
  count: number;
  avgMs: number;
  maxMs: number;
}

/**
 * Which engine a sample came from, so runs from three of them can share a file.
 *
 * Read from the Tauri global rather than the user agent for the one distinction
 * the user agent cannot make: a WKWebView and Safari report nearly the same
 * string, and telling those two apart is the entire point of the comparison.
 */
function engineTag(): string {
  const tauri =
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const engine = /\bChrome\//.test(ua)
    ? 'chromium'
    : /\bAppleWebKit\//.test(ua)
      ? 'webkit'
      : 'other';
  return tauri ? `${engine}-tauri` : engine;
}

let sessionAnnounced = false;

/**
 * Append a readout to the dev server's `artifacts/sim-perf/sim-perf.log`, as
 * well as the console.
 *
 * The desktop shell is the build whose numbers matter and the one whose
 * inspector will not hand console text back, so the console alone cannot
 * complete this investigation. Same-origin in dev, and the desktop CSP already
 * allows `http://localhost:*` under `connect-src`.
 *
 * Fire-and-forget and failure-swallowing on purpose: with no dev server behind
 * it — a production build, or `vite preview` — this 404s, and a debug sink must
 * not turn that into a visible error.
 */
export function reportSimulatorPerf(lines: readonly string[]): void {
  for (const line of lines) console.log(line);
  if (typeof fetch !== 'function') return;
  const header = sessionAnnounced
    ? ''
    : `\n=== ${engineTag()} | dpr ${typeof window === 'undefined' ? '?' : window.devicePixelRatio} | ` +
      `${typeof navigator === 'undefined' ? '' : navigator.userAgent}\n`;
  sessionAnnounced = true;
  const stamp = new Date().toISOString().slice(11, 23);
  const body = `${header}${lines.map((line) => `[${stamp}] [${engineTag()}] ${line}`).join('\n')}\n`;
  void fetch('/__sim-perf', { method: 'POST', body, keepalive: true }).catch(() => undefined);
}

/** Read every counter and reset, so each log line covers one window. */
export function drainSimulatorProbes(): Record<SimulatorProbeName, SimulatorProbeSnapshot> {
  const snapshot = {} as Record<SimulatorProbeName, SimulatorProbeSnapshot>;
  for (const name of Object.keys(counters) as SimulatorProbeName[]) {
    const counter = counters[name];
    snapshot[name] = {
      count: counter.count,
      avgMs: counter.count ? counter.totalMs / counter.count : 0,
      maxMs: counter.maxMs,
    };
    counters[name] = emptyCounter();
  }
  return snapshot;
}
