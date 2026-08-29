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
/**
 * What {@link CpSurfacePressHandle.claimsPress} reads, which is less than a
 * `PointerEvent`. Widened deliberately: `contextmenu` and `dblclick` have to ask
 * the same question about the same point, and both arrive as plain `MouseEvent`s
 * — so narrowing this to `PointerEvent` would force those two call sites to
 * either cast or reimplement the rule.
 */
export interface CpSurfacePressPoint {
  button: number;
  metaKey: boolean;
  clientX: number;
  clientY: number;
}

export interface CpSurfacePressHandle {
  /**
   * Whether this press belongs to the surface rather than to the object whose
   * body it landed on. See `surfaceClaimsPress` for the rule.
   *
   * **Call once per press, or at most once per animation frame — never once per
   * pointer sample.** It runs the canvas' hit test: ~2 µs on a 5k-crease pattern
   * at fit zoom, ~500 µs in the worst case that can occur (50k creases at 0.1×
   * zoom). Fine per press and per frame; a high-rate pointer reports several
   * times per frame, so the overlay's hover probe coalesces onto
   * `requestAnimationFrame` rather than calling this per event.
   */
  claimsPress(point: CpSurfacePressPoint): boolean;
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
  /**
   * The cursor the canvas would show at this point, or null when the press there
   * belongs to the object rather than to the surface.
   *
   * Exists because the obvious alternative does not work: a layer above the
   * canvas cannot read the canvas' *rendered* cursor and mirror it, since the
   * canvas only resolves that while it is receiving the hover — and it is not,
   * precisely because this layer is intercepting the events. Mirroring the
   * rendered style yielded a stale `default` over every crease drawn on top of
   * a reference image.
   *
   * So the answer is computed on demand from the same inputs the canvas' own
   * cursor uses. One hit test, and the claim verdict comes back folded in
   * rather than needing a second call to {@link claimsPress}.
   */
  hoverCursor(point: CpSurfacePressPoint): string | null;
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
