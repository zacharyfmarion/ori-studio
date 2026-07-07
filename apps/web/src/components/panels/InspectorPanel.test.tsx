import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createSampleProject } from '../../lib/sampleProject';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { InspectorPanel } from './InspectorPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = null;
  container?.remove();
  container = null;
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

function renderInspector(state: Partial<ReturnType<typeof useWorkspaceStore.getState>>) {
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      project: createSampleProject(),
      ...state,
    },
    true
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<InspectorPanel />);
  });
  return container;
}

describe('InspectorPanel', () => {
  it('shows selected tree node details', () => {
    const element = renderInspector({
      documentMode: 'tree',
      selection: { kind: 'node', id: 2 },
    });

    expect(element.textContent).toContain('Node 2');
    expect(element.textContent).toContain('Leaf');
    expect(element.textContent).toContain('Make Root');
    expect(element.textContent).not.toContain('CP Selection');
    expect(element.textContent).not.toContain('Imported CP');
  });

  it('keeps the tree summary design-focused', () => {
    const element = renderInspector({
      documentMode: 'crease-pattern',
      selection: { kind: 'tree' },
    });

    expect(element.textContent).toContain('Tree');
    expect(element.textContent).toContain('Nodes');
    expect(element.textContent).not.toContain('Native state');
    expect(element.textContent).not.toContain('Check CAMV');
  });
});
