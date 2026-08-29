import type { CpSelectHit } from '../CreasePatternWebglCanvas';

/**
 * Whether a press that landed on a canvas object drawn *below* the creases
 * belongs to the crease-pattern surface instead of to that object.
 *
 * The question only arises for a reference image: it is drawn under the pattern
 * so you can trace over it, while its overlay body sits above the canvas and
 * takes the press first. Without this the surface under an image is unreachable
 * — no crease could be selected, erased or box-selected anywhere the image
 * covered, and pan did not work there either.
 *
 * Pure, and separate from the canvas, for the reason `cpPointerReleaseRoute`
 * is: precedence spread across the guards of several branches is precedence
 * nobody can check. Everything it needs is a snapshot.
 *
 * Note what it does **not** take: coordinates and a radius. It takes the hit the
 * canvas' own `hitTest` already found. Recomputing proximity here would give the
 * surface a second, drifting notion of "on a crease", and the gap between the
 * two would be a ring around every crease where this declines and the canvas
 * picks nothing either — clicks inside an image that do nothing at all.
 */
export interface SurfacePressInput {
  /** `PointerEvent.button`: 0 primary, 1 middle, 2 secondary. */
  button: number;
  /**
   * Upstream's pan modifier verbatim (`Canvas.java:267` maps `isMetaDown()` to
   * the panning button), not the platform accel — Ctrl belongs to crease colour
   * inversion on every platform.
   */
  metaKey: boolean;
  /** The hand tool, for which a plain drag pans. */
  panToolActive: boolean;
  /** What the canvas' own hit test found under the pointer, if anything. */
  hit: CpSelectHit | null;
}

/**
 * True when the press is the surface's to handle.
 *
 * The rule, in full:
 *
 * - **Middle button**, **Meta**, or the **hand tool** — pan, whatever is
 *   underneath. Upstream makes pan unclaimable by design (`Canvas.java`'s
 *   handler `Feature` enum has no BUTTON_2, so every tool declines it), and a
 *   pan that stops working over part of the canvas is a pan that is broken.
 *   Nothing is lost: the overlay's own middle/Meta behaviour was only to select.
 * - **Anything pickable under the pointer** — a crease, a point or a circle.
 *   This is the case the bug was reported for, and it applies to the secondary
 *   button as much as the primary: right-clicking a crease over an image erases
 *   that crease.
 *
 * Everything else is the object's: a press on empty space inside the image's box
 * selects and drags it, and a *right* press there still opens the image's own
 * context menu. That last one is why the secondary button asks the same question
 * as the primary instead of claiming outright — an unconditional claim would
 * take the image's context menu away with nothing put in its place.
 *
 * Two consequences worth being deliberate about. A marquee cannot be *started*
 * on empty space inside an image (start it outside and drag in), and neither can
 * a right-drag box erase — both because that press has to remain the image's, or
 * an image over a sparse pattern could not be moved at all.
 *
 * @remarks **May be called on `pointerdown` and never from a per-frame handler.**
 * `hit` comes from a `LineHitIndex.query`, which falls back to a scan over every
 * segment when the tolerance is large relative to the cell size — i.e. zoomed
 * out on a dense pattern, the normal tracing view. Measured at ~1.85 ms for 50k
 * segments: nothing once per click, a quarter of the frame budget at 60 Hz. The
 * canvas' own `pointermove` deliberately does no hit testing in select mode; do
 * not undo that by wiring this to hover.
 */
export function surfaceClaimsPress(input: SurfacePressInput): boolean {
  if (input.button === 1 || input.metaKey || input.panToolActive) return true;
  return input.hit !== null;
}
