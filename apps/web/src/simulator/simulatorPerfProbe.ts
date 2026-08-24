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

import { readString, storageKey } from '../lib/storage';

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
  /**
   * Dispatch → worker draw → reply, for a camera message.
   *
   * The companion to {@link counters.cameraDispatch}, and the one that matters:
   * dispatch is fire-and-forget and therefore always near zero, so on its own it
   * says only that the *send* was cheap. This covers the wait, which under a
   * backed-up worker queue is the wait behind every message ahead of it.
   */
  cameraRoundTrip: emptyCounter(),
  /** Dispatch → worker tick → reply, which separates a slow tick from a rare one. */
  tickRoundTrip: emptyCounter(),
  /**
   * `reproject3dFigureAt` — the CPU projection an *unwindowed* folded figure
   * rebuilds per pointermove (earcut over every cell ring, plus a BSP build).
   *
   * On the main thread, and on no worker counter at all, so a figure turning
   * slowly for this reason looks identical in the readout to one that is not
   * turning at all. Which figures take this path is decided by
   * `canWindowFolded3dFigure`, so the same drag on two figures can have entirely
   * different costs — and only this tells them apart.
   */
  reproject: emptyCounter(),
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

/* ------------------------------------------------------------------ *
 * Orbit gestures: is the worker keeping up, or falling behind?
 * ------------------------------------------------------------------ */

/**
 * One drag, summarised on release.
 *
 * The per-second readout above cannot answer the question this exists for.
 * Every camera message is dispatched fire-and-forget — `setCamera` has no
 * in-flight guard, where the tick loop does — so a pointer moving faster than
 * the worker can draw does not slow down; it *queues*. Each individual render
 * stays as fast as it ever was, every average in the readout stays healthy, and
 * the model drifts further behind the cursor for as long as the drag lasts.
 *
 * That is invisible to a cost-per-render number by construction, and it is the
 * exact shape the user reports as "rotating is slow": the lag is the backlog,
 * not the frame. So this measures the backlog directly —
 *
 *   - `moves` vs `msgs` — whether anything coalesces pointer input. Equal means
 *     nothing does, which is today's behaviour and worth having on the record.
 *   - `peak` in-flight — how deep the queue got mid-gesture.
 *   - `atRelease` and `drain` — the decisive pair. Frames still owed when the
 *     pointer came up, and how long after release the last one landed. A drag
 *     that keeps painting for half a second after you let go is a queue; a drag
 *     that is uniformly slow but stops dead on release is a per-frame cost.
 *
 * Latency is dispatch → reply for the messages sent during the gesture, which
 * under a backlog is dominated by the messages ahead of each one.
 */
interface OrbitGesture {
  surface: string;
  startedAt: number;
  moves: number;
  msgs: number;
  replies: number;
  latencyTotalMs: number;
  latencyMaxMs: number;
  peakInFlight: number;
  releasedAt: number | null;
  inFlightAtRelease: number;
  lastReplyAt: number;
  /**
   * Main-thread reprojection during this drag; see the `reproject` counter.
   *
   * Accumulated here as well as there because an unwindowed folded figure mounts
   * no simulator runtime, and the per-second poller lives inside one — so for
   * the single surface whose cost is entirely this, the poller never runs and
   * the shared counter is never read. The gesture line is pushed on release
   * regardless, which makes it the only place the number can reliably appear.
   */
  reprojects: number;
  reprojectTotalMs: number;
  reprojectMaxMs: number;
}

/**
 * Camera messages sent and not yet answered — process-wide, not per surface.
 *
 * One worker, one message queue, one GL context, one drawing buffer: a folded
 * figure re-rendering is genuinely ahead of an orbit message in the same line.
 * Counting per surface would hide exactly the case where several surfaces
 * together are what saturates it.
 */
let cameraInFlight = 0;
let gesture: OrbitGesture | null = null;
/** Emit even if a reply is never accounted for, so a lost message cannot eat the line. */
let drainTimer: ReturnType<typeof setTimeout> | null = null;
const DRAIN_TIMEOUT_MS = 3000;

/**
 * Whether the readout is switched on.
 *
 * The counters cost a few adds and stay on unconditionally; this gates the
 * logging only, so an ordinary session neither writes a line nor posts to a dev
 * server that may not be there.
 *
 * Read fresh rather than cached, because the only caller is
 * {@link beginOrbitGesture} — once per drag, where a `localStorage` read is
 * nothing next to the gesture it is about to record. That makes the switch take
 * effect on the very next drag instead of on the next reload, which matters
 * more than it sounds: reloading the desktop shell to arm an instrument is a
 * bad trade when the instrument exists to catch something that a reload might
 * itself perturb.
 */
export function simulatorPerfEnabled(): boolean {
  return readString(storageKey('sim-perf')) === '1';
}

/** Start attributing camera traffic to a drag on `surface`. */
export function beginOrbitGesture(surface: string): void {
  if (!simulatorPerfEnabled()) return;
  // An unreleased previous gesture (pointer capture lost, surface unmounted
  // mid-drag) is reported rather than silently replaced — a dropped line is
  // indistinguishable from a gesture that produced no traffic.
  if (gesture) finishOrbitGesture();
  gesture = {
    surface,
    startedAt: performance.now(),
    moves: 0,
    msgs: 0,
    replies: 0,
    latencyTotalMs: 0,
    latencyMaxMs: 0,
    peakInFlight: cameraInFlight,
    releasedAt: null,
    inFlightAtRelease: 0,
    lastReplyAt: 0,
    reprojects: 0,
    reprojectTotalMs: 0,
    reprojectMaxMs: 0,
  };
}

/** One pointermove accepted by the orbit handler, whether or not it dispatched. */
export function recordOrbitMove(): void {
  if (gesture && gesture.releasedAt === null) gesture.moves += 1;
}

/**
 * One `reproject3dFigureAt`, in milliseconds. Feeds both the shared counter (for
 * the per-second line, when some runtime is mounted to poll it) and the gesture.
 */
export function recordOrbitReproject(durationMs: number): void {
  recordSimulatorProbe('reproject', durationMs);
  if (!gesture) return;
  gesture.reprojects += 1;
  gesture.reprojectTotalMs += durationMs;
  if (durationMs > gesture.reprojectMaxMs) gesture.reprojectMaxMs = durationMs;
}

/**
 * A camera message has been sent. Returns the timestamp to hand back to
 * {@link endCameraMessage}, so the pairing cannot drift.
 */
export function beginCameraMessage(): number {
  cameraInFlight += 1;
  if (gesture && gesture.releasedAt === null) {
    gesture.msgs += 1;
    if (cameraInFlight > gesture.peakInFlight) gesture.peakInFlight = cameraInFlight;
  }
  return performance.now();
}

/** Its reply arrived (or failed). Pass the value {@link beginCameraMessage} returned. */
export function endCameraMessage(startedAt: number): void {
  cameraInFlight = Math.max(0, cameraInFlight - 1);
  const elapsed = performance.now() - startedAt;
  recordSimulatorProbe('cameraRoundTrip', elapsed);
  if (gesture) {
    gesture.replies += 1;
    gesture.latencyTotalMs += elapsed;
    if (elapsed > gesture.latencyMaxMs) gesture.latencyMaxMs = elapsed;
    gesture.lastReplyAt = performance.now();
    // The drain is over when the backlog this gesture built has cleared.
    if (gesture.releasedAt !== null && cameraInFlight === 0) finishOrbitGesture();
  }
}

/** The pointer came up. The line is emitted once the backlog has drained. */
export function endOrbitGesture(): void {
  if (!gesture || gesture.releasedAt !== null) return;
  gesture.releasedAt = performance.now();
  gesture.inFlightAtRelease = cameraInFlight;
  if (cameraInFlight === 0) {
    finishOrbitGesture();
    return;
  }
  drainTimer = setTimeout(finishOrbitGesture, DRAIN_TIMEOUT_MS);
}

function finishOrbitGesture(): void {
  const done = gesture;
  gesture = null;
  if (drainTimer !== null) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }
  if (!done) return;
  const line = formatOrbitGesture(done, performance.now());
  if (line) reportSimulatorPerf([line]);
}

/**
 * Exported for its test: the arithmetic is the whole content of the line, and
 * driving it through real pointer events would test the browser instead.
 */
export function formatOrbitGesture(g: OrbitGesture, now: number): string | null {
  // A click that never moved is not a gesture and should not push a line into a
  // log whose value is that a drag stands out in it.
  if (!g.moves && !g.msgs) return null;
  const released = g.releasedAt ?? now;
  const heldMs = released - g.startedAt;
  const drainMs = Math.max(0, (g.lastReplyAt || released) - released);
  const perSec = heldMs > 0 ? (g.moves / heldMs) * 1000 : 0;
  const avgLatency = g.replies ? g.latencyTotalMs / g.replies : 0;
  const reproject = g.reprojects
    ? ` | reproject ${(g.reprojectTotalMs / g.reprojects).toFixed(1)}ms avg / ` +
      `${g.reprojectMaxMs.toFixed(1)} max x${g.reprojects}`
    : '';
  return (
    `[sim] orbit ${g.surface}: ${heldMs.toFixed(0)}ms held, ` +
    `${g.moves} moves (${perSec.toFixed(0)}/s) -> ${g.msgs} msgs, ${g.replies} replies | ` +
    `latency ${avgLatency.toFixed(1)}ms avg / ${g.latencyMaxMs.toFixed(1)} max | ` +
    `in-flight peak ${g.peakInFlight}, ${g.inFlightAtRelease} at release, ` +
    `drain ${drainMs.toFixed(0)}ms` +
    reproject
  );
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
