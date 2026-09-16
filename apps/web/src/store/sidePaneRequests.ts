/**
 * "Open on this side pane", for a pointer that keeps the side panes in the
 * touch drawer rather than the dock.
 *
 * `activatePanel` can only activate a panel the dock holds; under a coarse
 * pointer the View and Properties panes are not docked, so a menu entry or an
 * overflow row that names one used to do nothing. This tiny emitter is the
 * seam: the layout store publishes the id, the drawer (mounted on every
 * workspace's pill lane) opens on it.
 *
 * Latched rather than fire-and-forget on the drawer's side: a request raised
 * from another workspace switches the workspace and publishes in one
 * synchronous call stack, and an un-latched open would be closed by the
 * drawer's own workspace-switch effect in the same commit.
 */
type Listener = (paneId: string) => void;

const listeners = new Set<Listener>();

export function requestSidePane(paneId: string): void {
  for (const listener of [...listeners]) listener(paneId);
}

export function subscribeSidePaneRequests(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
