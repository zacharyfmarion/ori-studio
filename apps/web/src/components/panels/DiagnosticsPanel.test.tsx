import { singleTreemakerDesignTab } from '../../store/workspaceStore/designTabs';
import type { TreemakerDesignState } from '../../store/workspaceStore/designContent';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createSampleProject } from '../../lib/sampleProject';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { DiagnosticsPanel } from './DiagnosticsPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

function renderDiagnosticsPanel(
  state: Partial<ReturnType<typeof useWorkspaceStore.getState>> = {},
  design: Partial<TreemakerDesignState> = {},
) {
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      ...singleTreemakerDesignTab({ project: createSampleProject(), ...design }),
      engineReady: true,
      status: 'optimized',
      ...state,
    },
    true,
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<DiagnosticsPanel />);
  });
  return container;
}

describe('DiagnosticsPanel', () => {
  it('summarizes design engine, optimization, conditions, and CP readiness', () => {
    const view = renderDiagnosticsPanel(
      {},
      {
        lastOptimization: {
          kind: 'scale',
          converged: true,
          old_scale: 0.1,
          new_scale: 0.2,
          is_feasible: true,
          message: 'Scale optimization complete',
        },
      },
    );

    expect(view.textContent).toContain('Nodes');
    expect(view.textContent).toContain('Edges');
    expect(view.textContent).toContain('Engine ready');
    expect(view.textContent).toContain('Scale optimization complete');
    expect(view.textContent).toContain('All conditions feasible');
    expect(view.textContent).toContain('6 creases, 3 facets');
  });

  it('reports infeasible design conditions without CP diagnostic entries', () => {
    const project = createSampleProject();
    project.conditions = [
      {
        id: 42,
        isFeasible: false,
        kind: { type: 'node_on_edge', node: 2 },
      },
    ];

    const view = renderDiagnosticsPanel({}, { project });

    expect(view.textContent).toContain('1 infeasible condition: 42');
    expect(view.querySelector('.diagnostic-list__item')).toBeNull();
    expect(view.textContent).not.toContain('CAMV');
  });
});
