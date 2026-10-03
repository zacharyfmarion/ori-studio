import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramPagePanel } from './DiagramPagePanel';

const analytics = vi.hoisted(() => ({ trackDiagramPageSetupChanged: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));

/** The Page pane through the store: each control one change, one undo step and one count. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialState = useWorkspaceStore.getInitialState();
let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(initialState, true);
  act(() => {
    for (let i = 0; i < 10; i += 1) useWorkspaceStore.getState().addDiagramStep();
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <TooltipProvider>
        <DiagramPagePanel />
      </TooltipProvider>
    )
  );
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

const state = () => useWorkspaceStore.getState();
const radio = (name: string) =>
  [...(host?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])].find((element) =>
    element.textContent?.startsWith(name)
  )!;
const toggle = (name: string) =>
  [...(host?.querySelectorAll<HTMLElement>('[role="switch"]') ?? [])].find(
    (element) => element.getAttribute('aria-label') === name || element.closest('.control-row')?.textContent?.includes(name)
  )!;

describe('DiagramPagePanel', () => {
  it('lays the steps out in a flow, one undo step and one count, and offers its path', () => {
    const past = state().diagramHistory.past.length;
    expect(host?.textContent).not.toContain('Show path');
    act(() => radio('Flow').click());
    expect(state().diagram?.page.layout).toBe('flow');
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(analytics.trackDiagramPageSetupChanged).toHaveBeenCalledWith('layout');
    expect(host?.textContent).toContain('Show path');
    expect(host?.textContent).toContain('Steps per row');
  });

  it('says how many steps a page holds and how many pages there are', () => {
    expect(host?.textContent).toContain('9 steps per page · 2 pages');
  });

  it('shows the first page number only while numbers are on', () => {
    expect(host?.textContent).toContain('First number');
    act(() => toggle('Page numbers').click());
    expect(state().diagram?.page.pageNumbers.enabled).toBe(false);
    expect(analytics.trackDiagramPageSetupChanged).toHaveBeenCalledWith('page_numbers');
    expect(host?.textContent).not.toContain('First number');
  });

  it('changes nothing on a read-only diagram', () => {
    act(() => useWorkspaceStore.setState({ diagramReadOnly: true }));
    act(() => radio('Flow').click());
    expect(state().diagram?.page.layout).toBe('grid');
    expect(analytics.trackDiagramPageSetupChanged).not.toHaveBeenCalled();
  });
});
