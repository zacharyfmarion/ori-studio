import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLayoutStore } from '../store/layoutStore';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import { DESIGN_BP_PATH, DESIGN_PATH, DESIGN_TREEMAKER_PATH } from './paths';
import { WorkspaceRoute } from './WorkspaceRoute';

/**
 * Bare `/design` is the method chooser. It used to *write* that state, so
 * routing there replaced a design that had just loaded with the chooser — and
 * picking a method from it then built a blank project over the open one. It now
 * redirects an established design to its own sub-route instead, which is what
 * makes that class of bug unreachable rather than merely unhit.
 */
function renderAt(root: Root, entry: string): void {
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
  root.render(<RouterProvider router={router} />);
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
    useWorkspaceStore.setState({ designMethod: 'box-pleat' });
    await act(async () => renderAt(root, DESIGN_PATH));
    expect(host.querySelector('[data-testid="bp"]')).not.toBeNull();
    // The design survives: the route no longer clears the method.
    expect(useWorkspaceStore.getState().designMethod).toBe('box-pleat');
  });

  it('sends a TreeMaker design on to its own sub-route', async () => {
    useWorkspaceStore.setState({ designMethod: 'treemaker' });
    await act(async () => renderAt(root, DESIGN_PATH));
    expect(host.querySelector('[data-testid="treemaker"]')).not.toBeNull();
    expect(useWorkspaceStore.getState().designMethod).toBe('treemaker');
  });

  it('shows the chooser when no method has been picked', async () => {
    useWorkspaceStore.setState({ designMethod: 'none' });
    await act(async () => renderAt(root, DESIGN_PATH));
    expect(host.querySelector('[data-testid="bp"]')).toBeNull();
    expect(host.querySelector('[data-testid="treemaker"]')).toBeNull();
    expect(useWorkspaceStore.getState().designMethod).toBe('none');
  });

  it('lets startNewDesign reach the chooser — the one caller that clears the method', async () => {
    useWorkspaceStore.setState({ designMethod: 'box-pleat' });
    act(() => useWorkspaceStore.getState().startNewDesign());
    expect(useWorkspaceStore.getState().designMethod).toBe('none');
    await act(async () => renderAt(root, DESIGN_PATH));
    expect(host.querySelector('[data-testid="bp"]')).toBeNull();
  });

  it('applies the method a sub-route names', async () => {
    useWorkspaceStore.setState({ designMethod: 'none' });
    await act(async () => renderAt(root, DESIGN_BP_PATH));
    expect(useWorkspaceStore.getState().designMethod).toBe('box-pleat');
  });
});
