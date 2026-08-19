import { singleDesignTab } from '../store/workspaceStore/designTabs';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider, createMemoryRouter, redirect } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHogClientLike } from '../analytics/bootstrap';
import { AnalyticsRuntimeProvider } from '../analytics/runtime';
import { useLayoutStore } from '../store/layoutStore';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import { DESIGN_PATH, LEGACY_DESIGN_PATHS } from './paths';
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
 * The Design workspace has one route.
 *
 * It used to have three — `/design` for the chooser, `/design/treemaker` and
 * `/design/bp` for the two methods — and bare `/design` *wrote* the chooser
 * state, so routing there replaced a design that had just loaded. That whole
 * class of bug is gone rather than merely unhit: with tabs a workspace can hold
 * a circle-packed design beside a box-pleat one, so there is no method for a URL
 * to name and nothing for a route to apply.
 */
function renderAt(root: Root, entry: string, client?: PostHogClientLike): void {
  const router = createMemoryRouter(
    [
      {
        path: DESIGN_PATH,
        element: <div data-testid="design">{<WorkspaceRoute workspace="design" />}</div>,
      },
      ...LEGACY_DESIGN_PATHS.map((path) => ({ path, loader: () => redirect(DESIGN_PATH) })),
    ],
    { initialEntries: [entry] },
  );
  const tree: ReactNode = <RouterProvider router={router} />;
  root.render(client ? createElement(AnalyticsRuntimeProvider, { client, children: tree }) : tree);
}

describe('WorkspaceRoute — /design', () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    useLayoutStore.setState({ activeWorkspace: 'edit', dockviewApi: null });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('activates the Design workspace', async () => {
    useWorkspaceStore.setState({ ...singleDesignTab(null) });
    await act(async () => renderAt(root, DESIGN_PATH));

    expect(host.querySelector('[data-testid="design"]')).not.toBeNull();
    expect(useLayoutStore.getState().activeWorkspace).toBe('design');
  });

  it('leaves an open design alone', async () => {
    // The old bare-`/design` route cleared the method here, which is how landing
    // on it replaced a design that had just loaded with the chooser.
    useWorkspaceStore.setState({ ...singleDesignTab('box-pleat') });
    const before = useWorkspaceStore.getState().designTabs;

    await act(async () => renderAt(root, DESIGN_PATH));

    expect(useWorkspaceStore.getState().designTabs).toEqual(before);
  });

  for (const legacy of LEGACY_DESIGN_PATHS) {
    it(`redirects ${legacy} to the one Design route`, async () => {
      useWorkspaceStore.setState({ ...singleDesignTab('treemaker') });
      await act(async () => renderAt(root, legacy));

      // A bookmark from an older build still lands, and lands on the workspace
      // rather than on a method it can no longer name.
      expect(host.querySelector('[data-testid="design"]')).not.toBeNull();
    });
  }

  it('reports the workspace it showed, with no method attached', async () => {
    // A Design workspace holding two kinds has no single variant to report, so
    // claiming one would be a lie the funnel would then be built on.
    useWorkspaceStore.setState({ ...singleDesignTab('box-pleat') });
    const client = makeFakeClient();

    await act(async () => renderAt(root, DESIGN_PATH, client));

    expect(viewedEvents(client)).toEqual([{ workspace: 'design', variant: undefined }]);
  });
});
