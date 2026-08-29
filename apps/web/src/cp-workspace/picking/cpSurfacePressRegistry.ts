/**
 * The mounted crease-pattern canvas' press pipeline, reachable from a layer that
 * has no DOM path to it.
 *
 * The CP viewport stacks the WebGL canvas and the canvas-object overlay as
 * *siblings*, the overlay on top. So a press inside a reference image's box is
 * delivered to the overlay's body polygon and, under every propagation rule
 * there is, can never reach the canvas' own `pointerdown` listener — which is
 * where all crease picking lives. The overlay needs two things from the canvas
 * it cannot see: whether the surface wants a given press, and a way to hand it
 * over when it does.
 *
 * Same shape and same rationale as
 * {@link ../renderer/cpCameraRegistry.registerCpCamera}, including the identity
 * check on unregister: a canvas tearing down must not clear a newer canvas'
 * registration if the two overlap. Threading this as a prop would mean an
 * imperative handle up out of the canvas and back down through the panel, which
 * is exactly the accumulation the panel guidance in `AGENTS.md` exists to
 * prevent.
 *
 * A caller finding nothing registered does nothing, which is the right outcome
 * when no crease pattern is open or WebGL was unavailable: the overlay then
 * behaves as it did before this existed.
 */
export interface CpSurfacePressHandle {
  /**
   * Whether this press belongs to the surface rather than to the object whose
   * body it landed on. See `surfaceClaimsPress` for the rule.
   *
   * **Call on `pointerdown` only.** It runs the canvas' hit test, which is
   * sub-microsecond at a working zoom but degrades to a scan over every segment
   * when zoomed out on a dense pattern (~1.85 ms at 50k creases). Once per press
   * that is free; per frame it is a quarter of the budget.
   */
  claimsPress(event: PointerEvent): boolean;
  /**
   * Run the canvas' own press pipeline for an event delivered to another layer.
   *
   * Takes the **native** event, not a synthesised copy: the pipeline calls
   * `preventDefault()` on it, and ends by taking pointer capture for the real
   * pointer id — which is what redirects the rest of the gesture (`pointermove`,
   * `pointerup`) to the canvas, overriding the implicit capture the browser
   * gives the polygon on a touch or pen press.
   */
  press(event: PointerEvent): void;
}

let current: CpSurfacePressHandle | null = null;

/** Publish the mounted canvas' press pipeline, and return the unregister. */
export function registerCpSurfacePress(handle: CpSurfacePressHandle): () => void {
  current = handle;
  return () => {
    if (current === handle) {
      current = null;
    }
  };
}

/** The mounted canvas' press pipeline, or null when no crease pattern is open. */
export function cpSurfacePress(): CpSurfacePressHandle | null {
  return current;
}
