import type { FC } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { ErrorBoundary } from './ErrorBoundary';
import { useWorkspaceStore } from '../../store/workspaceStore';

/**
 * Wraps a Dockview panel in a pane-sized error boundary.
 *
 * Applied once, across the whole `panelComponents` registry, rather than at
 * each panel's own definition — the registry is the single place every dock
 * panel passes through, so a panel added later is protected without anyone
 * remembering to do it. It also keeps the boundary out of the panels
 * themselves, which per AGENTS.md are composition sites: a boundary is chrome
 * *around* a panel, not behavior inside one.
 */

/** Prefix that marks a component as wrapped; asserted by the registry test. */
export const PANEL_BOUNDARY_DISPLAY_PREFIX = 'WithErrorBoundary';

/**
 * Reset the boundary whenever a genuinely new document is loaded, so a panel
 * that died on bad input comes back by itself when good input arrives instead
 * of stranding the user on a fallback in a now-healthy app.
 *
 * Both ids advance only on a real load (open/new/import/generate), never on
 * edits or undo/redo — see the `loadSerial` note in `oristudioCpRuntime.ts`.
 */
function useDocumentResetKeys(): readonly unknown[] {
  const cpLoadSerial = useWorkspaceStore((state) => state.oristudioCpDocument?.loadSerial ?? null);
  const projectLoadId = useWorkspaceStore((state) => state.projectLoadId);
  return [cpLoadSerial, projectLoadId];
}

export function withPanelErrorBoundary(
  Panel: FC<IDockviewPanelProps>,
  panelId: string
): FC<IDockviewPanelProps> {
  function PanelWithErrorBoundary(props: IDockviewPanelProps) {
    const resetKeys = useDocumentResetKeys();
    return (
      <ErrorBoundary surface={`panel:${panelId}`} variant="pane" resetKeys={resetKeys}>
        <Panel {...props} />
      </ErrorBoundary>
    );
  }

  PanelWithErrorBoundary.displayName = `${PANEL_BOUNDARY_DISPLAY_PREFIX}(${
    Panel.displayName ?? Panel.name ?? panelId
  })`;

  return PanelWithErrorBoundary;
}
