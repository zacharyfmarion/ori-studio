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
 * Two things are derived from this: the UI refuses to open more inline
 * simulation windows, and the worker keeps this many models resident and more
 * — see {@link MAX_LIVE_SIMULATOR_SESSIONS}. Residency must never come out
 * *below* the window cap: that means open windows evict each other's models
 * and come back stale, which reads as a bug rather than a limit.
 *
 * It read that way for real. A leak in the runtime's cancellation path orphaned
 * one session per window, so residency was effectively half of this and every
 * eleventh window killed the first.
 *
 * What scales with it: worker memory (a prepared model and solver state per
 * simulation) and one draw per simulation per camera frame. Render-target churn
 * no longer does — the shared canvas is sized once for the largest window.
 *
 * Raised from 6 to 20 to find where that actually starts to hurt.
 */
export const MAX_CONCURRENT_SIMULATIONS = 20;

/**
 * Simulator views that can be open beside the inline windows: the Simulate
 * workspace's own, and a Diagram step's Pose (D19). Neither is refused at
 * {@link MAX_CONCURRENT_SIMULATIONS} — that cap is for windows — so the
 * worker's residency makes room for them instead.
 */
export const OTHER_SIMULATOR_VIEWS = 2;

/**
 * How many models the worker keeps resident: every window, every other view,
 * and one more for the reload overlap — a runtime replacing its model loads
 * the new session *before* releasing the old, so that its view is never
 * briefly backed by nothing, which means a full house momentarily needs one
 * slot more than there are views. Without the spare, every reload at the cap
 * evicted somebody, and the victim was a view still on screen.
 */
export const MAX_LIVE_SIMULATOR_SESSIONS = MAX_CONCURRENT_SIMULATIONS + OTHER_SIMULATOR_VIEWS + 1;

/**
 * How many 3D folded-figure meshes stay resident in the worker.
 *
 * Read by the worker's mesh registry and by nothing else — deliberately, and it
 * is the one thing that makes a second cap safe here. `MAX_CONCURRENT_SIMULATIONS`
 * needs a cooperating UI guard because evicting a solver session destroys state
 * the user made: the fold they scrubbed to. A mesh is derived entirely from a
 * render model the main thread still holds, so evicting one costs a re-upload
 * and loses nothing, and there is nothing for a second number to be held equal
 * to.
 *
 * What scales with it is memory: three RGBA32F textures at the model's texture
 * dimension, plus two programs and three buffers, per figure. A typical figure
 * packs into a 64–128 texel square (under a megabyte all told); a dense one into
 * 256 (a few megabytes). Set well above the number of figures a document
 * realistically carries so eviction stays a safety valve rather than a working
 * mechanism — a cap that keeps being hit is a cap that is too small.
 */
export const MAX_LIVE_FOLDED_MESHES = 64;
