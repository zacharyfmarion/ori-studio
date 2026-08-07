import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExploriDesignState } from '../../store/workspaceStore/designContent';
import { singleDesignTab } from '../../store/workspaceStore/designTabs';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ExploriResultsPanel } from './ExploriResultsPanel';

/**
 * The results pane with nothing in it.
 *
 * An empty `results` is two different situations — no search has run, and a
 * search ran and the archive had nothing — and for a while the pane said the
 * first thing in both, telling someone who had just searched to go and search.
 * `searched` is what separates them, so these assert the pane reads it.
 */

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

function renderResultsPanel(design: Partial<ExploriDesignState> = {}): HTMLDivElement {
  const seeded = singleDesignTab('explori', 'Search');
  const tab = seeded.designTabs[0];
  if (tab.kind !== 'explori') throw new Error('expected an explori tab');
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      designTabs: [{ ...tab, explori: { ...tab.explori, ...design } }],
      activeDesignId: tab.id,
    },
    true
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<ExploriResultsPanel />);
  });
  return container;
}

describe('ExploriResultsPanel', () => {
  it('asks for a search when none has run', () => {
    const view = renderResultsPanel({ results: [], searched: false });
    expect(view.textContent).toContain('No results yet');
    expect(view.textContent).toContain('Draw a tree and search the archive');
  });

  it('says the archive had nothing once a search has come back empty', () => {
    const view = renderResultsPanel({ results: [], searched: true });
    expect(view.textContent).toContain('No matching crease patterns');
    expect(view.textContent).not.toContain('No results yet');
  });

  it('shows a busy state while a query is in flight', () => {
    const view = renderResultsPanel({ searching: true });
    const status = view.querySelector('.explori-results__state');
    expect(status?.getAttribute('aria-busy')).toBe('true');
    expect(view.querySelector('.explori-results__spinner')).not.toBeNull();
    expect(view.textContent).toContain('Searching the archive');
  });
});
