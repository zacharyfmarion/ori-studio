import type { CpSelectHit } from '../CreasePatternWebglCanvas';

/**
 * Whether a press that landed on a canvas object drawn *below* the creases
 * belongs to the crease-pattern surface instead of to that object.
 *
 * The question only arises for a canvas object you can see the pattern through:
 * a reference image, drawn under the pattern so you can trace over it, or a text
 * box, whose bounds are mostly empty. Either way the overlay body sits above the
 * canvas and takes the press first. Without this the surface under one is
 * unreachable — no crease could be selected, erased or box-selected anywhere it
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
 * @remarks **Once per press, or at most once per animation frame — never once
 * per pointer sample.** `hit` comes from a `LineHitIndex.query`, measured at
 * ~2 µs on a 5k-crease pattern at fit zoom and ~500 µs in the worst case that
 * can occur (50k creases at 0.1× zoom). That is comfortable per frame and not
 * per sample, since a high-rate pointer reports several times per frame — which
 * is why the overlay's hover probe coalesces onto `requestAnimationFrame`.
 */
export function surfaceClaimsPress(input: SurfacePressInput): boolean {
  if (input.button === 1 || input.metaKey || input.panToolActive) return true;
  return input.hit !== null;
}
