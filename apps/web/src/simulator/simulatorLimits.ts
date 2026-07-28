/**
 * Limits shared by the simulator worker and the UI that drives it.
 *
 * Deliberately import-free. The worker bundle takes this too, and anything it
 * pulled in would be dragged across the worker boundary with it — which is what
 * previously argued for keeping a second copy of the number beside the worker
 * instead. A leaf module costs nothing and leaves one definition.
 */

/**
 * How many simulations can be live at once.
 *
 * Two things enforce this and they are the same limit, which is why it is one
 * number: the UI refuses to open more inline simulation windows, and the worker
 * keeps at most this many models resident. Splitting them is a silent failure —
 * a residency cap below the window cap means open windows evict each other's
 * models and come back stale, which reads as a bug rather than a limit.
 *
 * What scales with it: worker memory (a prepared model and solver state per
 * simulation) and one draw per simulation per camera frame. Render-target churn
 * no longer does — the shared canvas is sized once for the largest window.
 *
 * Raised from 6 to 20 to find where that actually starts to hurt.
 */
export const MAX_CONCURRENT_SIMULATIONS = 20;
