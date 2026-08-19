import { useEffect } from 'react';
import {
  releaseSimulatorClient,
  retainSimulatorClient,
} from '../store/workspaceStore/simulatorRuntime';
import { drainSimulatorProbes, reportSimulatorPerf } from './simulatorPerfProbe';
import { readString, storageKey } from '../lib/storage';

/**
 * The `oristudio:sim-perf` readout: one poller for the whole page.
 *
 * Deliberately not per-runtime, for two reasons that both came out of using it.
 *
 * **It has to cover every kind of surface.** The worker's counters are global —
 * one shared GL context, one shared drawing buffer — but the readout used to
 * live inside `useSimulatorRuntime`, so a page showing only 3D folded figures
 * produced an empty log while doing exactly the work under investigation. The
 * counters were never the problem; who was reading them was.
 *
 * **One reader, or the numbers lie.** `getPerfStats` and
 * {@link drainSimulatorProbes} both read *and reset*. With a poller per window,
 * four windows drained the same counters on a stagger, so every line covered a
 * random ~45ms slice that the `windowMs` divisor then scaled into a per-second
 * rate. Per-render averages survived that; every rate was noise. Refcounting to
 * a single interval is what makes `draws/s` and `msg/s` mean what they say.
 *
 * Retains its own worker client rather than borrowing a caller's, so the poller
 * does not depend on which runtime happens to still be mounted. Costs nothing
 * when the flag is off: the effect returns before retaining anything, so no
 * worker is started on account of a debug switch.
 */

/** How often a line is emitted. One second, so rates read directly. */
const POLL_INTERVAL_MS = 1000;

let subscribers = 0;
let timer: number | null = null;

function formatLines(
  stats: Awaited<ReturnType<ReturnType<typeof retainSimulatorClient>['getPerfStats']>>
): string[] {
  const perSec = (n: number) => (stats.windowMs ? (n / stats.windowMs) * 1000 : 0).toFixed(0);
  const size = (v: { width: number; height: number }) => `${v.width}x${v.height}`;
  const probes = drainSimulatorProbes();
  // An idle page reports zeros every second, which buries the few seconds of
  // gesture this exists to capture. Drained first, so a skipped second still
  // clears its counters rather than folding them into the next one.
  if (!stats.renders && !stats.ticks && !stats.cameraCalls && !probes.measure.count) return [];
  return [
    `[sim] ${stats.backend}${stats.gpuRender ? '+gpuRender' : '+cpuRender'} | ` +
      `${stats.liveSessions} sessions, ${stats.liveMeshes} meshes | ` +
      `solve ${stats.solveAvgMs.toFixed(1)}ms avg / ${stats.solveMaxMs.toFixed(1)} max, ` +
      `${perSec(stats.ticks)} ticks/s, ${perSec(stats.stepsTotal)} steps/s | ` +
      `render ${stats.renderAvgMs.toFixed(2)}ms avg / ${stats.renderMaxMs.toFixed(2)} max, ` +
      `${perSec(stats.renders)} draws/s | ` +
      `camera ${perSec(stats.cameraCalls)} msg/s, ` +
      `main-dispatch ${probes.cameraDispatch.avgMs.toFixed(2)}ms | ` +
      `tick round-trip ${probes.tickRoundTrip.avgMs.toFixed(1)}ms`,
    // Second line: where a render's time went, and the sizes that explain it.
    // Split out because the first line's totals cannot distinguish "the draw is
    // slow" from "the snapshot is slow", and those have opposite fixes. `req` is
    // what the window asked for, `canvas` the shared buffer, `crop` what was
    // taken out of it. A per-render cost that tracks `canvas` while `crop`
    // changes underneath it is the buffer being charged for, not the drawing —
    // which is the shape the WebKit orbit lag turned out to have.
    `[sim] render split: resize ${stats.resizeAvgMs.toFixed(2)}ms, ` +
      `draw ${stats.drawAvgMs.toFixed(2)}ms, ` +
      `snapshot ${stats.snapshotAvgMs.toFixed(2)}ms avg / ${stats.snapshotMaxMs.toFixed(2)} max | ` +
      `req ${size(stats.request)}, canvas ${size(stats.canvas)}, ` +
      `buffer ${size(stats.buffer)}, crop ${size(stats.crop)} | ` +
      `main-thread: measure ${probes.measure.avgMs.toFixed(2)}ms avg / ` +
      `${probes.measure.maxMs.toFixed(2)} max (${perSec(probes.measure.count)}/s), ` +
      `present ${probes.present.avgMs.toFixed(2)}ms avg / ` +
      `${probes.present.maxMs.toFixed(2)} max (${perSec(probes.present.count)}/s) | ` +
      `dpr ${window.devicePixelRatio}`,
  ];
}

/**
 * Emit the readout while this component is mounted, if the flag is set.
 *
 * Safe to call from every simulator-bearing runtime: the interval is shared, so
 * N callers still produce one line per second.
 */
export function useSimulatorPerfLog(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (readString(storageKey('sim-perf')) !== '1') return;
    subscribers += 1;
    if (timer === null) {
      const client = retainSimulatorClient();
      const id = window.setInterval(() => {
        void client
          .getPerfStats()
          .then((stats) => {
            const lines = formatLines(stats);
            if (lines.length) reportSimulatorPerf(lines);
          })
          .catch(() => undefined);
      }, POLL_INTERVAL_MS);
      timer = id;
    }
    return () => {
      subscribers -= 1;
      if (subscribers > 0 || timer === null) return;
      window.clearInterval(timer);
      timer = null;
      releaseSimulatorClient();
    };
  }, []);
}
