import type { FC } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { DesignPanel } from './DesignPanel';
import { InspectorPanel } from './InspectorPanel';
import { CreasePatternPanel } from './CreasePatternPanel';
import { CpViewControlsPanel } from './CpViewControlsPanel';
import { SimulatorPanel } from './SimulatorPanel';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { ConditionsPanel } from './ConditionsPanel';
import { SequencePanel } from './SequencePanel';

export const panelComponents: Record<string, FC<IDockviewPanelProps>> = {
  design: DesignPanel,
  inspector: InspectorPanel,
  'crease-pattern': CreasePatternPanel,
  'cp-view-controls': CpViewControlsPanel,
  simulator: SimulatorPanel,
  diagnostics: DiagnosticsPanel,
  sequence: SequencePanel,
  conditions: ConditionsPanel,
};
