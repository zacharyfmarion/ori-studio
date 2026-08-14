/**
 * The mounted simulation's viewpoint verbs, as methods rather than as state.
 *
 * Same shape and same reason as `cpCameraRegistry`: setting which way is up is
 * something that *happens* on a press, and modelling a happening as state means
 * React de-duplicates it — pressing the same button twice would be one event.
 *
 * It exists because the control lives in `SimulatorViewControlsPanel`, which is
 * a store-driven options pane with no props and no path to the viewport, while
 * the handle lives in `SimulatorPanel`. The registry is the one thing both can
 * reach, exactly as the crease-pattern camera solved the same split.
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
