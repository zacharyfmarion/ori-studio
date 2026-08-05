import { useEffect } from 'react';
import type { DesignVariant, WorkspaceScreen } from './events';
import { track } from './runtime';

/**
 * Emit `workspace viewed` when this screen mounts or its identity changes.
 *
 * Lives in the view component (the route element that renders a workspace) — the
 * idiomatic home for a "viewed" event — rather than in a store subscription.
 * Keyed on the workspace and, for Design, its variant, so navigating between
 * screens (or Design variants) fires exactly once per view. No-op when analytics
 * is off.
 */
export function useWorkspaceViewedEvent(workspace: WorkspaceScreen, variant?: DesignVariant): void {
  useEffect(() => {
    track('workspace viewed', { workspace, variant });
  }, [workspace, variant]);
}
