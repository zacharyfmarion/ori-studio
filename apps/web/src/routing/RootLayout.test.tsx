import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const gateway = vi.hoisted(() => ({
  loadWorkspace: vi.fn(async () => undefined),
  useLoadedWorkspace: vi.fn<() => { App: () => ReactNode } | null>(() => null),
}));
vi.mock('./workspaceGateway', () => gateway);

import { RootLayout } from './RootLayout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const router = createMemoryRouter(
    [{ path: '/', element: <RootLayout />, children: [{ path: 'welcome', element: <p>landing</p> }] }],
    { initialEntries: ['/welcome'] }
  );
  act(() => root?.render(<RouterProvider router={router} />));
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe('RootLayout', () => {
  it('renders the route alone, and loads nothing, before the workspace is asked for', () => {
    render();
    expect(container?.textContent).toBe('landing');
    expect(gateway.loadWorkspace).not.toHaveBeenCalled();
  });

  it('mounts the workspace runtime beside the route once it has loaded', () => {
    gateway.useLoadedWorkspace.mockReturnValue({ App: () => <p>runtime</p> });
    render();
    expect(container?.textContent).toBe('landingruntime');
  });

  it('loads the workspace at startup in the desktop app, where there is no first paint to protect', () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    render();
    expect(gateway.loadWorkspace).toHaveBeenCalledOnce();
  });
});
