import { selectDesignMethod, singleDesignTab } from '../store/workspaceStore/designTabs';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHogClientLike } from '../analytics/bootstrap';
import { AnalyticsRuntimeProvider } from '../analytics/runtime';
import { useLayoutStore } from '../store/layoutStore';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import { DESIGN_BP_PATH, DESIGN_PATH, DESIGN_TREEMAKER_PATH } from './paths';
import { WorkspaceRoute } from './WorkspaceRoute';

function makeFakeClient() {
  return {
    init: vi.fn(),
    register: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    identify: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn(),
  } satisfies PostHogClientLike;
}

function viewedEvents(client: ReturnType<typeof makeFakeClient>) {
  return client.capture.mock.calls
    .filter((call) => call[0] === 'workspace viewed')
    .map((call) => call[1]);
}

/**
 * Bare `/design` is the method chooser. It used to *write* that state, so
 * routing there replaced a design that had just loaded with the chooser — and
 * picking a method from it then built a blank project over the open one. It now
 * redirects an established design to its own sub-route instead, which is what
 * makes that class of bug unreachable rather than merely unhit.
 */
function renderAt(root: Root, entry: string, client?: PostHogClientLike): void {
  const router = createMemoryRouter(
    [
      { path: DESIGN_PATH, element: <WorkspaceRoute workspace="design" variant="nux" /> },
      {
        path: DESIGN_BP_PATH,
        element: <div data-testid="bp">{<WorkspaceRoute workspace="design" variant="box-pleat" />}</div>,
      },
      {
        path: DESIGN_TREEMAKER_PATH,
        element: (
          <div data-testid="treemaker">
            {<WorkspaceRoute workspace="design" variant="treemaker" />}
          </div>
        ),
      },
    ],
    { initialEntries: [entry] }
  );
  const tree: ReactNode = <RouterProvider router={router} />;
  root.render(
    client ? createElement(AnalyticsRuntimeProvider, { client, children: tree }) : tree
  );
}

describe('WorkspaceRoute — bare /design', () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    useLayoutStore.setState({ activeWorkspace: 'design', dockviewApi: null });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('sends a box-pleat design on to its own sub-route', async () => {
    useWorkspaceStore.setState({ ...singleDesignTab('box-pleat') });
    await act(async () => renderAt(root, DESIGN_PATH));
    expect(host.querySelector('[data-testid="bp"]')).not.toBeNull();
    // The design survives: the route no longer clears the method.
    expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('box-pleat');
  });

  it('sends a TreeMaker design on to its own sub-route', async () => {
    useWorkspaceStore.setState({ ...singleDesignTab('treemaker') });
    await act(async () => renderAt(root, DESIGN_PATH));
    expect(host.querySelector('[data-testid="treemaker"]')).not.toBeNull();
    expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('treemaker');
  });

  it('shows the chooser when no method has been picked', async () => {
    useWorkspaceStore.setState({ ...singleDesignTab(null) });
    await act(async () => renderAt(root, DESIGN_PATH));
    expect(host.querySelector('[data-testid="bp"]')).toBeNull();
    expect(host.querySelector('[data-testid="treemaker"]')).toBeNull();
    expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('none');
  });

  it('lets startNewDesign reach the chooser — the one caller that clears the method', async () => {
    useWorkspaceStore.setState({ ...singleDesignTab('box-pleat') });
    act(() => useWorkspaceStore.getState().startNewDesign());
    expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('none');
    await act(async () => renderAt(root, DESIGN_PATH));
    expect(host.querySelector('[data-testid="bp"]')).toBeNull();
  });

  it('applies the method a sub-route names', async () => {
    useWorkspaceStore.setState({ ...singleDesignTab(null) });
    await act(async () => renderAt(root, DESIGN_BP_PATH));
    expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('box-pleat');
  });

  it('reports only the screen the user lands on, not the one redirected through', async () => {
    // The `workspace viewed` event lives in the view, and a route the user is
    // passed straight through is not a screen they saw. Reporting `nux` here
    // would invent a chooser view that never rendered.
    useWorkspaceStore.setState({ ...singleDesignTab('box-pleat') });
    const client = makeFakeClient();
    await act(async () => renderAt(root, DESIGN_PATH, client));
    expect(viewedEvents(client)).toEqual([{ workspace: 'design', variant: 'box-pleat' }]);
  });

  it('offers the chooser on a fresh app, which has authored nothing', async () => {
    // The pair this replaced started at "not pending" + "treemaker", claiming a
    // method for a project that did not exist; bare `/design` only showed the
    // chooser because the route overwrote that claim on arrival. Now the state
    // is honest, so the route does not have to lie to correct it.
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('none');
    await act(async () => renderAt(root, DESIGN_PATH));
    expect(host.querySelector('[data-testid="treemaker"]')).toBeNull();
    expect(host.querySelector('[data-testid="bp"]')).toBeNull();
  });

  it('reports the chooser when it is genuinely what rendered', async () => {
    useWorkspaceStore.setState({ ...singleDesignTab(null) });
    const client = makeFakeClient();
    await act(async () => renderAt(root, DESIGN_PATH, client));
    expect(viewedEvents(client)).toEqual([{ workspace: 'design', variant: 'nux' }]);
  });
});
