import type { FC } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { DesignPanel } from './DesignPanel';
import { BpEditorPanel } from './BpEditorPanel';
import { InspectorPanel } from './InspectorPanel';
import { CreasePatternPanel } from './CreasePatternPanel';
import { CpViewControlsPanel } from './CpViewControlsPanel';
import { SimulatorPanel } from './SimulatorPanel';
import { SimulatorViewControlsPanel } from './SimulatorViewControlsPanel';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { ConditionsPanel } from './ConditionsPanel';
import { SequencePanel } from './SequencePanel';
import { LessonPanel } from './LessonPanel';
import { withPanelErrorBoundary } from '../errors/withPanelErrorBoundary';

const panels: Record<string, FC<IDockviewPanelProps>> = {
  design: DesignPanel,
  'bp-editor': BpEditorPanel,
  inspector: InspectorPanel,
  'crease-pattern': CreasePatternPanel,
  'cp-view-controls': CpViewControlsPanel,
  simulator: SimulatorPanel,
  'simulator-view-controls': SimulatorViewControlsPanel,
  diagnostics: DiagnosticsPanel,
  sequence: SequencePanel,
  conditions: ConditionsPanel,
  lesson: LessonPanel,
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
