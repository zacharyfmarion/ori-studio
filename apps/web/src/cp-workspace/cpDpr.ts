/**
 * The device-pixel-ratio policy every CP surface renders under.
 *
 * A cap is a *tradeoff*, not a free win: on a genuine dpr-3 panel the uncapped
 * path would render one drawing-buffer pixel per physical pixel and thin
 * creases would be measurably crisper. What buys the cap is fill cost and VRAM
 * — a 1400x900 CSS pane is 11.3 Mpx (45 MB RGBA) at dpr 3 against 5.0 Mpx
 * (20 MB) at 2, before the MSAA and preserved drawing buffer of
 * `CP_GL_ATTRIBUTES` multiply on top — and nothing is drawn at a different CSS
 * size either way, because `cpSizingScales` scales every stroke, marker and dot
 * by the same ratio.
 *
 * It lives here rather than in one of the canvases because two surfaces share
 * the CP renderer (the editor and the References view), and a second surface
 * quietly taking the opposite side of a decision the first already made is how
 * they drift.
 */

/** Cap DPR at 2 — matches the perf budget and avoids 3x/4x fill on hidpi. */
export const CP_MAX_DPR = 2;

/** Device pixels per CSS pixel for a CP canvas, capped. 1 with no `window`. */
export function cpDpr(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(window.devicePixelRatio || 1, CP_MAX_DPR);
}
