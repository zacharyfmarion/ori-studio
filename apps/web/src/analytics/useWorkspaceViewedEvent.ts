import { useEffect } from 'react';
import type { WorkspaceScreen } from './events';
import { track } from './runtime';

/**
 * Emit `workspace viewed` when this screen mounts or changes.
 *
 * Lives in the view component (the route element that renders a workspace) — the
 * idiomatic home for a "viewed" event — rather than in a store subscription.
 *
 * Design used to report a `variant` here, naming the method it was showing. It no
 * longer can: the workspace holds tabs, and one of them being circle-packed while
 * another is box-pleat means there is no single method to report. What designs
 * are open is reported by the `design tab *` events instead, which describe the
 * thing that actually varies.
 */
export function useWorkspaceViewedEvent(workspace: WorkspaceScreen): void {
  useEffect(() => {
    track('workspace viewed', { workspace });
  }, [workspace]);
}
