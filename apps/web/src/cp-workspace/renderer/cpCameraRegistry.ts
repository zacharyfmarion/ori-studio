/**
 * Every way to move the crease-pattern camera, as methods rather than as data.
 *
 * A camera move is something that *happens* — a button press, a keyboard chord, a
 * jump to a diagnostic. Modelling one as state means React de-duplicates it, which
 * is why the version this replaced carried a `nonce` whose only job was to make an
 * effect fire again for a repeated action. Nothing here can be triggered by a
 * re-render, which is the whole point.
 */
export interface CpCameraHandle {
  zoomIn(): void;
  zoomOut(): void;
  /** Fit the document. Reframes without straightening — rotation is cleared only by `rotateReset`. */
  fit(): void;
  /** 100% is one user unit per CSS pixel. */
  setZoomPercent(percent: number): void;
  rotateBy(radians: number): void;
  rotateTo(radians: number): void;
  rotateReset(): void;
  /** Jump to a region of the model — see `frameUserCameraOnBounds` for the rules. */
  frameModelBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }): void;
}

let current: CpCameraHandle | null = null;

/**
 * Publish the mounted canvas's camera, and return the unregister.
 *
 * The store needs this: a check command frames its first issue, and it can be
 * dispatched from the tool rail, from the menu (which never touches the panel),
 * or from the CP-detect import loop. The store action is the only point all three
 * share, so that is where the framing rule lives — and it needs a way to reach a
 * camera it has no props to. Same shape as `registerCpActionShortcutExecutor`,
 * including the identity check: a canvas tearing down must not clear a newer
 * canvas's registration if the two overlap.
 *
 * A caller finding no camera does nothing, which is the correct outcome when no
 * crease pattern is open.
 */
export function registerCpCamera(handle: CpCameraHandle): () => void {
  current = handle;
  return () => {
    if (current === handle) {
      current = null;
    }
  };
}

/** The mounted canvas's camera, or null when no crease pattern is open. */
export function cpCamera(): CpCameraHandle | null {
  return current;
}
