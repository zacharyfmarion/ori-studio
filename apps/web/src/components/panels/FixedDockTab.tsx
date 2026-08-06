import { DockviewDefaultTab, type IDockviewPanelHeaderProps } from 'dockview';

/**
 * A dock tab with no close button.
 *
 * Panes here are the surfaces a workspace or a design kind declares, not
 * documents the user opened — closing one would leave a gap nothing reopens.
 */
export function FixedDockTab(props: IDockviewPanelHeaderProps) {
  return <DockviewDefaultTab {...props} hideClose />;
}
