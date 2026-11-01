/**
 * The mount closes the Layer order dialog when the route or the workspace
 * changes under it (row H10's review): the browser's Back reaches every host
 * the same way, and the host hears `cancelled`, so no Apply lands in a place
 * the user left. The dialog itself is stood in for: this is the mount's
 * behaviour, not the dialog's.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAKE_LAYER_ORDER_SOURCE } from '../../layer-order/engine/layerOrderEngine.fixtures';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';

vi.mock('./LayerOrderDialog', () => ({ LayerOrderDialog: () => <div role="dialog" aria-label="Layer order" /> }));

import { openLayerOrderDialog, resetLayerOrderDialogGatewayForTest } from '../../layer-order/dialog/layerOrderDialogGateway';
import { resetLayerOrderDialogStoreForTest, useLayerOrderDialogStore } from '../../layer-order/dialog/layerOrderDialogStore';
import { useLayoutStore } from '../../store/layoutStore';
import { LayerOrderDialogMount } from './LayerOrderDialogMount';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REQUEST: LayerOrderRequest = {
  surface: 'fold_import',
  source: FAKE_LAYER_ORDER_SOURCE,
  record: null,
  look: {
    style: DEFAULT_PAPER_STYLE,
    policy: PAPER_STYLE_POLICIES.fold,
    turnDeg: 0,
    side: 'front',
    xray: false,
    lineStyle: 'color',
    lineWidth: 1,
  },
};

let host: HTMLDivElement;
let root: Root;
const initialLayout = useLayoutStore.getInitialState();

beforeEach(() => {
  useLayoutStore.setState({ ...initialLayout, activeWorkspace: 'fold' }, true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetLayerOrderDialogStoreForTest();
  resetLayerOrderDialogGatewayForTest();
  useLayoutStore.setState(initialLayout, true);
});

/** The app root's mount under a router at `/fold`, as the workspace runs it. */
function mountUnderRouter() {
  const routes: RouteObject[] = [
    {
      path: '/',
      element: <LayerOrderDialogMount />,
      children: [
        { path: 'fold', element: null },
        { path: 'edit', element: null },
      ],
    },
  ];
  const router = createMemoryRouter(routes, { initialEntries: ['/edit', '/fold'], initialIndex: 1 });
  act(() => root.render(<RouterProvider router={router} />));
  return router;
}

/** Open the dialog through the gateway, as a host does; its answer, once there is one. */
async function opened(): Promise<{ outcome: Promise<unknown> }> {
  let outcome: Promise<unknown> = Promise.resolve();
  await act(async () => {
    outcome = openLayerOrderDialog(REQUEST);
    // The stand-in's code loads, and the dialog renders.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  return { outcome };
}

describe('the Layer order dialog’s mount', () => {
  it('closes the dialog when the route changes under it (the browser’s Back), answering cancelled', async () => {
    const router = mountUnderRouter();
    const { outcome } = await opened();
    expect(useLayerOrderDialogStore.getState().opening).not.toBeNull();
    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.pathname).toBe('/edit');
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
    expect(useLayerOrderDialogStore.getState().opening).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('closes the dialog when the workspace changes under it', async () => {
    mountUnderRouter();
    const { outcome } = await opened();
    expect(useLayerOrderDialogStore.getState().opening).not.toBeNull();
    act(() => useLayoutStore.setState({ activeWorkspace: 'edit' }));
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('leaves the dialog open while the route and the workspace stay, and works with no router at all', async () => {
    mountUnderRouter();
    await opened();
    act(() => useLayoutStore.setState({ activeWorkspace: 'fold' }));
    expect(useLayerOrderDialogStore.getState().opening).not.toBeNull();
    act(() => root.unmount());
    resetLayerOrderDialogStoreForTest();

    // A host's unit test mounts it bare: the workspace still closes it.
    root = createRoot(host);
    act(() => root.render(<LayerOrderDialogMount />));
    const { outcome } = await opened();
    act(() => useLayoutStore.setState({ activeWorkspace: 'diagram' }));
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
  });
});
