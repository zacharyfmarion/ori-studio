import type { CpSelectHit } from '../CreasePatternWebglCanvas';

/**
 * Whether a press that landed on a layer above the crease pattern belongs to the
 * crease-pattern surface instead of to that layer, and on what grounds.
 *
 * Two different questions live here, which is why the answer is not a boolean:
 *
 * - **A pan press is nobody's.** The middle button, Meta and the hand tool all
 *   move the camera, and upstream makes that unclaimable by design (`Canvas.java`'s
 *   handler `Feature` enum has no BUTTON_2, so every tool declines it). A pan
 *   that stops working over part of the canvas is a pan that is broken, so every
 *   layer above the surface has to hand one back — a body, a resize handle, a
 *   region's chip bar, all of them.
 * - **A crease press outranks only what you can see the pattern through.** A
 *   reference image is drawn under the creases so you can trace over it, and a
 *   text box's bounds are mostly empty; either way the overlay body sits above
 *   the canvas and takes the press first, so without this a crease crossing one
 *   would be unselectable. An opaque object — a folded figure, an inline
 *   simulation — occludes the pattern and has no crease to yield to, and the
 *   resize and rotate handles are deliberate chrome drawn on top, so neither
 *   yields on these grounds.
 *
 * Pure, and separate from the canvas, for the reason `cpPointerReleaseRoute` is:
 * precedence spread across the guards of several branches is precedence nobody
 * can check. Everything it needs is a snapshot.
 *
 * Note what it does **not** take: coordinates and a radius. It takes the hit the
 * canvas' own `hitTest` finds. Recomputing proximity here would give the surface
 * a second, drifting notion of "on a crease", and the gap between the two would
 * be a ring around every crease where this declines and the canvas picks nothing
 * either — clicks inside an image that do nothing at all.
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
  /**
   * What the canvas' own hit test finds under the pointer, if anything.
   *
   * A thunk rather than a value because the pan verdict never reads it: pan
   * outranks everything, so hit-testing first would spend the query — ~2 µs on a
   * 5k-crease pattern at fit zoom, ~500 µs at 50k creases and 0.1× zoom — on the
   * one answer that cannot use it. Held modifiers make that the common case: with
   * Meta down, every press and every coalesced hover probe takes this path.
   */
  hit: () => CpSelectHit | null;
}

/**
 * Why the surface takes a press, or `null` when it does not.
 *
 * `'pan'` is a claim no layer may refuse. `'crease'` is a claim only a layer you
 * can see the pattern through yields to — the caller decides, since only it
 * knows what it is drawing.
 */
export type CpSurfaceClaim = 'pan' | 'crease' | null;

/**
 * The rule, in full.
 *
 * - **Middle button**, **Meta**, or the **hand tool** — `'pan'`, whatever is
 *   underneath. Nothing is lost by making this absolute: the overlay's own
 *   middle/Meta behaviour was only to select.
 * - Otherwise, **anything pickable under the pointer** — a crease, a point or a
 *   circle — is `'crease'`. This applies to the secondary button as much as the
 *   primary: right-clicking a crease over an image erases that crease.
 *
 * Everything else is `null`, and stays the layer's own: a press on empty space
 * inside an image's box selects and drags the image, and a *right* press there
 * still opens the image's own context menu. That last one is why the secondary
 * button asks the crease question instead of claiming outright — an
 * unconditional claim would take the image's context menu away with nothing put
 * in its place.
 *
 * Two consequences worth being deliberate about. A marquee cannot be *started*
 * on empty space inside an image (start it outside and drag in), and neither can
 * a right-drag box erase — both because that press has to remain the image's, or
 * an image over a sparse pattern could not be moved at all.
 *
 * One corner: Meta with the *secondary* button answers `'pan'`, and the canvas
 * then erases with it, because its own `onPointerDown` settles the button before
 * it looks at the modifier. The verdict is still right — the press is the
 * surface's and no layer may keep it — and the alternative, asking the crease
 * question for a Meta right-press, would put an object's context menu back in
 * front of a modifier the user is holding to reach the canvas.
 *
 * @remarks **Once per press, or at most once per animation frame — never once
 * per pointer sample.** See {@link SurfacePressInput.hit} for what the query
 * costs. A high-rate pointer reports several times per frame, which is why the
 * overlay's hover probe coalesces onto `requestAnimationFrame`.
 */
export function surfacePressClaim(input: SurfacePressInput): CpSurfaceClaim {
  if (input.button === 1 || input.metaKey || input.panToolActive) return 'pan';
  return input.hit() !== null ? 'crease' : null;
}
