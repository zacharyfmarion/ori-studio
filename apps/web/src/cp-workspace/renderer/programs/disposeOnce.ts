/**
 * Wrap a program's teardown so calling it a second time does nothing.
 *
 * regl asserts on a double destroy — `(regl) buffer must not be deleted already`
 * — and that assertion escapes as a thrown error, so a second dispose does not
 * merely waste work: it takes the crease-pattern panel down to its error
 * boundary. One such crash reached production.
 *
 * The renderer keeps its own `disposed` flag, which covers the path it owns.
 * This covers each program on its own, for a teardown reached any other way —
 * a boundary reset that remounts the canvas, a lost WebGL context, a panel
 * unmounted mid-dispose. Making the invariant local is the point: no caller has
 * to know how many times dispose has already run.
 */
export function disposeOnce(destroy: () => void): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    destroy();
  };
}
