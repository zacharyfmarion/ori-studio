import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { IDockviewPanelProps } from 'dockview';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withPanelErrorBoundary } from './withPanelErrorBoundary';
import { useWorkspaceStore } from '../../store/workspaceStore';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const panelProps = {} as IDockviewPanelProps;

function Healthy() {
  return <p>healthy panel</p>;
}

function Broken(): never {
  throw new Error('panel exploded');
}

describe('withPanelErrorBoundary', () => {
  // The whole point of the per-panel tier: before boundaries existed, this
  // rendered a blank window instead of one broken pane.
  it('contains a panel crash to that panel', () => {
    const BrokenPanel = withPanelErrorBoundary(Broken, 'crease-pattern');
    const HealthyPanel = withPanelErrorBoundary(Healthy, 'inspector');

    act(() =>
      root.render(
        <>
          <BrokenPanel {...panelProps} />
          <HealthyPanel {...panelProps} />
        </>,
      ),
    );

    expect(container.textContent).toContain('This panel stopped working');
    expect(container.textContent).toContain('healthy panel');
  });

  it('names the panel in the report, so a copied trace says which pane died', () => {
    const BrokenPanel = withPanelErrorBoundary(Broken, 'crease-pattern');
    act(() => root.render(<BrokenPanel {...panelProps} />));

    const report = container.querySelector('.error-fallback__report-text')?.textContent ?? '';
    expect(report).toContain('panel:crease-pattern');
  });

  it('recovers by itself when a new document is loaded', () => {
    let failing = true;
    function Subject() {
      if (failing) throw new Error('bad document');
      return <p>rendered the new document</p>;
    }
    const Panel = withPanelErrorBoundary(Subject, 'crease-pattern');

    act(() => root.render(<Panel {...panelProps} />));
    expect(container.textContent).toContain('This panel stopped working');

    failing = false;
    // What a genuine open/new/import advances — not an edit or an undo.
    act(() => {
      useWorkspaceStore.setState({ projectLoadId: useWorkspaceStore.getState().projectLoadId + 1 });
    });

    expect(container.textContent).toContain('rendered the new document');
  });
});
