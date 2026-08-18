/**
 * Observe an element's size, reporting at most once per animation frame.
 *
 * The deferral is the point, not an optimisation. A callback that resizes
 * anything — and a floating element's placement callback does, because clamping
 * its width to the space available *is* a resize — must not do so from inside a
 * `ResizeObserver` callback. Notifications produced during delivery cannot be
 * delivered in the same pass, and the browser reports the leftovers by firing an
 * `error` at the window: "ResizeObserver loop completed with undelivered
 * notifications". That is a spec notice rather than a fault, but it reaches this
 * app's global handler and becomes a background-error toast in the user's face.
 *
 * Coalescing follows for free: a splitter dragged across a hundred pixels
 * delivers a long burst of observations and produces one reposition per frame.
 */
export function observeResizeDeferred(element: Element, onResize: () => void): () => void {
  let frame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      onResize();
    });
  });
  observer.observe(element);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
  };
}
