import { useEffect } from 'react';
import { runUpdateCheck } from '../lib/updateController';
import { surfaceSupports } from '../platform/capabilities';
import { useUpdateStore } from '../store/updateStore';

/** Long enough that a cold start is done contending for the network. */
const FIRST_CHECK_DELAY_MS = 60_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Module-level so StrictMode's dev double-mount cannot start two schedules.
 * Same reasoning as `analytics/useAppOpenedEvent.ts`.
 */
let scheduleStarted = false;

/** Test-only: reset the once-guard so each case starts fresh. */
export function resetUpdateScheduleForTest(): void {
  scheduleStarted = false;
}

/**
 * Drives the background update check.
 *
 * Two things worth knowing about the timing. The first check is delayed rather
 * than run on mount, because a cold start is already contending for the network
 * with four wasm bridges and the simulator bundle, and nothing here is urgent.
 *
 * And the interval is **wall-clock guarded** rather than a bare `setInterval`.
 * A laptop that sleeps for two days does not fire twelve missed timers on wake;
 * depending on the platform it fires one, late, or none. Checking elapsed time
 * on both the tick and on regaining visibility means a machine that has been
 * closed all weekend checks when it opens, which is exactly when someone is
 * about to start working in a stale build.
 */
export function useUpdateCheck(): void {
  useEffect(() => {
    if (!surfaceSupports('selfUpdate')) return;
    if (scheduleStarted) return;
    scheduleStarted = true;

    let disposed = false;

    const checkIfDue = () => {
      if (disposed) return;
      const { lastCheck, delivery } = useUpdateStore.getState();
      if (delivery === 'off') return;
      // Failures count against the interval as much as successes do. They did
      // not, once, and a server that was down was retried on every tick and
      // every visibility change for as long as it stayed down.
      if (lastCheck !== null && Date.now() - lastCheck.at < CHECK_INTERVAL_MS) return;
      // Silent by design: the controller records the failure and resolves.
      void runUpdateCheck('automatic');
    };

    const firstCheck = window.setTimeout(checkIfDue, FIRST_CHECK_DELAY_MS);
    const interval = window.setInterval(checkIfDue, CHECK_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkIfDue();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      window.clearTimeout(firstCheck);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      scheduleStarted = false;
    };
  }, []);
}
