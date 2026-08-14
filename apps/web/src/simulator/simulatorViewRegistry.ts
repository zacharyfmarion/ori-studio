/**
 * The mounted simulation's viewpoint verbs, as methods rather than as state.
 *
 * Same shape and same reason as `cpCameraRegistry`: setting which way is up is
 * something that *happens* on a press, and modelling a happening as state means
 * React de-duplicates it — pressing the same button twice would be one event.
 *
 * It exists for the **inline simulation windows**. Their toolbar is a floating
 * component rendered by the crease-pattern panel, while the viewport handle
 * lives inside the per-window component in `InlineSimulationLayer` — so there is
 * no prop path between them, exactly the split the crease-pattern camera solved
 * the same way.
 *
 * The Simulate workspace does not use it: its button sits in the same panel that
 * owns the ref, so it calls the handle directly.
 */
export interface SimulatorViewHandle {
  /**
   * Take the direction now pointing up on screen as the model's up.
   *
   * There is no matching clear: the way back is the viewport's own `resetView`,
   * which drops the orientation with the angles on this surface.
   */
  setUpright(): void;
}

let current: SimulatorViewHandle | null = null;

/**
 * Publish the mounted simulation's viewpoint verbs, and return the unregister.
 *
 * The identity check matters for the same reason it does for the camera: the
 * viewport remounts when the render path switches between GPU and CPU, and a
 * teardown must not clear a newer registration if the two overlap.
 */
export function registerSimulatorView(handle: SimulatorViewHandle): () => void {
  current = handle;
  return () => {
    if (current === handle) {
      current = null;
    }
  };
}

/**
 * The mounted simulation's viewpoint verbs, or null when nothing is simulating.
 *
 * A caller finding none does nothing, which is the right outcome when the
 * Simulate workspace has no model loaded.
 */
export function simulatorView(): SimulatorViewHandle | null {
  return current;
}
