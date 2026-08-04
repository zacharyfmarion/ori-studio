import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import { EDIT_PATH } from './paths';
import { ShareRoute } from './ShareRoute';

/**
 * `/s` is intentionally almost nothing: capture the payload, redirect to Edit.
 * These tests pin exactly that, because the value of the route is what it does
 * *not* do — decoding or provisioning here would put a second document-creation
 * path beside `ensureEditCreasePattern`.
 */
function renderAt(root: Root, entry: string): void {
  const router = createMemoryRouter(
    [
      { path: '/s', element: <ShareRoute /> },
      { path: EDIT_PATH, element: <div data-testid="edit" /> },
    ],
    { initialEntries: [entry] }
  );
  root.render(<RouterProvider router={router} />);
}

describe('ShareRoute', () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    useWorkspaceStore.setState({ pendingSharedCpPayload: null });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('captures the payload and redirects to Edit', async () => {
    await act(async () => renderAt(root, '/s#T0NTMQEB-_09'));
    expect(useWorkspaceStore.getState().pendingSharedCpPayload).toBe('T0NTMQEB-_09');
    expect(host.querySelector('[data-testid="edit"]')).not.toBeNull();
  });

  it('redirects without capturing when the fragment is not a payload', async () => {
    await act(async () => renderAt(root, '/s#not a payload'));
    expect(useWorkspaceStore.getState().pendingSharedCpPayload).toBeNull();
    // Still lands on Edit: a truncated link should give the normal empty
    // editor, not an error screen.
    expect(host.querySelector('[data-testid="edit"]')).not.toBeNull();
  });

  it('redirects without capturing when there is no fragment at all', async () => {
    await act(async () => renderAt(root, '/s'));
    expect(useWorkspaceStore.getState().pendingSharedCpPayload).toBeNull();
    expect(host.querySelector('[data-testid="edit"]')).not.toBeNull();
  });

  it('leaves the document alone — the route provisions nothing', async () => {
    await act(async () => renderAt(root, '/s#T0NTMQEB'));
    // The whole point of the handoff: routing decides intent, the Edit surface
    // self-provisions. A document created here would be a second path.
    expect(useWorkspaceStore.getState().oristudioCpDocument).toBeNull();
  });
});
