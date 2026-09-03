import type { FC } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { DesignPanel } from './DesignPanel';
import { DesignPaneLayout } from './DesignPaneLayout';
import { BpEditorPanel } from './BpEditorPanel';
import { ExploriTreePanel } from './ExploriTreePanel';
import { ExploriResultsPanel } from './ExploriResultsPanel';
import { InspectorPanel } from './InspectorPanel';
import { CreasePatternPanel } from './CreasePatternPanel';
import { CpViewControlsPanel } from './CpViewControlsPanel';
import { SimulatorPanel } from './SimulatorPanel';
import { SimulatorViewControlsPanel } from './SimulatorViewControlsPanel';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { ConditionsPanel } from './ConditionsPanel';
import { withPanelErrorBoundary } from '../errors/withPanelErrorBoundary';

const panels: Record<string, FC<IDockviewPanelProps>> = {
  // The Design workspace's single dock panel: a tab strip's worth of designs,
  // each with its own panes. `design` below is one of *those* panes.
  'design-workspace': DesignPaneLayout,
  design: DesignPanel,
  'bp-editor': BpEditorPanel,
  'explori-tree': ExploriTreePanel,
  'explori-results': ExploriResultsPanel,
  inspector: InspectorPanel,
  'crease-pattern': CreasePatternPanel,
  'cp-view-controls': CpViewControlsPanel,
  simulator: SimulatorPanel,
  'simulator-view-controls': SimulatorViewControlsPanel,
  diagnostics: DiagnosticsPanel,
  conditions: ConditionsPanel,
};

/**
 * Every dock panel, each wrapped in its own error boundary. Wrapping happens
 * here rather than in the panels so a panel added to `panels` above cannot
 * forget it — a crash in one pane costs that pane and leaves the rest of the
 * workspace interactive.
 */
export const panelComponents: Record<string, FC<IDockviewPanelProps>> = Object.fromEntries(
  Object.entries(panels).map(([id, Panel]) => [id, withPanelErrorBoundary(Panel, id)])
);
