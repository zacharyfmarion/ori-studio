/**
 * The crease-pattern snap radius *setting*: its unit, its bounds, its defaults,
 * and the clamp every entry point runs. The snapping law that consumes it lives
 * in `cp-workspace/snapRadius.ts`; this module is deliberately free of any
 * CP-workspace import so the storage layer, the settings store and the settings
 * modal can read the bounds without pulling the canvas in behind them.
 *
 * The unit is **Oriedita model units** — the paper is 400 across — so the number
 * means exactly what the same number means in Oriedita's own preference
 * (`mouseRadius`: default 10, slider 2-100, integer step). Matching pixels
 * instead would have made the same number reach less of the drawing here, since
 * we draw that 400-unit paper 588 CSS px wide.
 */

/** Oriedita's `mouseRadius` default, and ours wherever the pointer is precise. */
export const CP_DEFAULT_SNAP_RADIUS = 10;
/** Oriedita's slider bounds, carried over unchanged because the unit is shared. */
export const CP_MIN_SNAP_RADIUS = 2;
export const CP_MAX_SNAP_RADIUS = 100;

/**
 * The default under a coarse pointer.
 *
 * The canvas draws the 400-unit paper 588 CSS px wide, so a model unit is
 * 588/400 = 1.47 CSS px at 100% zoom — and on iPadOS a CSS px is a point. Apple's
 * 44pt minimum touch target is therefore 22pt of radius, or 22/1.47 ≈ 15 model
 * units, against the 10 a mouse gets (14.7pt of radius, a 29pt target — under
 * the bar by a third).
 *
 * 15 and not the value that would put the *tightest* derived radius on the 44pt
 * bar. `cp-workspace/snapRadius.ts` scales vertex picking to 0.6 of this radius,
 * so a 44pt vertex target would need 25 units — and 25 is exactly half the
 * 50-unit spacing of the kernel's default 8-division grid, the radius at which
 * every point on the paper sits inside some grid point's snap disc and placing a
 * free point stops being possible at all. Widening the base instead widens the
 * derived radii with it, keeping the vertex-vs-crease priority the ratios encode:
 * vertex picking goes from an 18pt target to a 26pt one and crease picking from
 * 24pt to 35pt, while the snap disc itself reaches the 44pt bar and still leaves
 * 20 units of un-snapped paper between two adjacent grid points.
 */
export const CP_COARSE_POINTER_SNAP_RADIUS = 15;

/**
 * `(pointer: coarse)` — the *primary* pointer cannot point precisely.
 *
 * Asked live rather than sampled at boot: attaching a Magic Keyboard or a
 * trackpad flips an iPad to `fine` in an already-open tab, and detaching it flips
 * back, so this is a property of the current session and not of the device.
 */
export const CP_COARSE_POINTER_QUERY = '(pointer: coarse)';

/**
 * `window`, when it can answer media queries. jsdom without a stub, and any
 * non-browser host, get `null` and are treated as a precise pointer — the same
 * fallback `mobileSurface.ts` takes, and the conservative one here since it
 * leaves upstream's default in place.
 */
function mediaHost(): Window | null {
  if (typeof window === 'undefined') return null;
  if (typeof window.matchMedia !== 'function') return null;
  return window;
}

/** Whether this session's primary pointer is a fingertip rather than a cursor. */
export function hasCoarsePointer(): boolean {
  return mediaHost()?.matchMedia(CP_COARSE_POINTER_QUERY).matches ?? false;
}

/**
 * Watch for the pointer type changing under a live session. Returns the
 * unsubscribe, and a no-op one on a host that cannot answer the query.
 */
export function subscribeCoarsePointer(onChange: () => void): () => void {
  const query = mediaHost()?.matchMedia(CP_COARSE_POINTER_QUERY);
  if (!query) return () => {};
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** The radius to use when nobody has chosen one. */
export function defaultCpSnapRadius(coarsePointer: boolean): number {
  return coarsePointer ? CP_COARSE_POINTER_SNAP_RADIUS : CP_DEFAULT_SNAP_RADIUS;
}

/**
 * Clamp a radius to the slider's bounds, rounding to its integer step.
 *
 * Non-finite input degrades to the default rather than to the minimum (the shape
 * `clampOristudioCpLineWidth` uses): the callers here are a hand-editable
 * storage key and a free-text field, where an unreadable value means "no
 * answer", not "the tightest possible answer" — and the tightest answer is the
 * one that makes vertices hard to hit.
 */
export function clampCpSnapRadius(value: number): number {
  if (!Number.isFinite(value)) return CP_DEFAULT_SNAP_RADIUS;
  return Math.min(CP_MAX_SNAP_RADIUS, Math.max(CP_MIN_SNAP_RADIUS, Math.round(value)));
}

/**
 * Resolve the radius in force: a choice someone made, or the default for this
 * pointer when they made none.
 *
 * `null` is "no choice", which is the whole distinction that lets the coarse
 * default move. A number is a choice and wins on any pointer — someone who set
 * 10 on a desktop keeps 10 when the same profile opens on an iPad, because the
 * value reaching here came from a key only the settings field ever writes.
 * Non-finite is not a choice either: a hand-edited key answers nothing, and
 * answering it with the fine default on a touch screen would be a second,
 * quieter law about which default applies.
 */
export function resolveCpSnapRadius(stored: number | null, coarsePointer: boolean): number {
  if (stored === null || !Number.isFinite(stored)) return defaultCpSnapRadius(coarsePointer);
  return clampCpSnapRadius(stored);
}
