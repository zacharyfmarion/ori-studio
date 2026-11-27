/**
 * When a detector call failed because the detector did not load: the browser
 * did not get its code to it, which is the connection failing, not the
 * detector. Every surface that calls the detector asks this one question: the
 * likelihood gate on an added image, a region solve measuring its image, and
 * the Detect dialog. Each says so where the user acted, or keeps quiet for
 * work nobody asked for; none reports it to Sentry. A later call tries again.
 *
 * It shows two ways:
 * - **the worker never ran**: its script, or a module it imports, did not load
 *   (`isCpDetectClientUnloaded`, ORI-STUDIO-1E). The runtime drops that worker,
 *   so the next call starts a fresh one;
 * - **a download it needs did not arrive**: the worker ran and its wasm was
 *   refused or cut off (ORI-STUDIO-15, "WebAssembly compilation aborted:
 *   Network error: Response body loading was aborted"), in the words of
 *   `lib/networkFailure.ts`. The worker forgets a start that failed, so the
 *   next call fetches the wasm again. The dialog's model registry and model
 *   download fail the same way when the network refuses them.
 */
import { track } from '../../analytics';
import { ANALYTICS_EVENTS, type CpDetectLoadFailureSurface } from '../../analytics/events';
import { isNetworkFailure, offlineFlag } from '../../lib/networkFailure';
import { isCpDetectClientUnloaded } from '../../store/workspaceStore/cpDetectRuntime';

/** Whether `error`, from a detector call, is the detector not loading (see the module docs). */
export function isCpDetectLoadFailure(error: unknown): boolean {
  return isCpDetectClientUnloaded(error) || isNetworkFailure(error);
}

/** Count a load failure that a surface handled instead of reporting it. */
export function trackCpDetectLoadFailed(surface: CpDetectLoadFailureSurface): void {
  track(ANALYTICS_EVENTS.cpDetectLoadFailed, { surface, offline: offlineFlag() });
}
