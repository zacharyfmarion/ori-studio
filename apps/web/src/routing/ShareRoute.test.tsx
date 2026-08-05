import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import { resetInlinedSharedCp, SHARED_CP_SCRIPT_ID } from '../cp-workspace/share/sharedCpBootstrap';
import { EDIT_PATH } from './paths';
import { ShareRoute } from './ShareRoute';

/**
 * `/s` is intentionally almost nothing: capture the intent, redirect to Edit. These tests
 * pin exactly that, because the value of the route is what it does *not* do — decoding,
 * fetching, or provisioning here would put a second document-creation path beside
 * `ensureEditCreasePattern`.
 */
function renderAt(root: Root, entry: string): void {
  const router = createMemoryRouter(
    [
      { path: '/s', element: <ShareRoute /> },
      { path: '/s/:shareId', element: <ShareRoute /> },
      { path: EDIT_PATH, element: <div data-testid="edit" /> },
    ],
    { initialEntries: [entry] }
  );
  root.render(<RouterProvider router={router} />);
}

function inlineSharedCp(id: string, payload: string): void {
  const script = document.createElement('script');
  script.type = 'application/json';
  script.id = SHARED_CP_SCRIPT_ID;
  script.textContent = JSON.stringify({ id, payload, title: 'Bird base', author: null, creaseCount: 3 });
  document.head.append(script);
  resetInlinedSharedCp();
}

describe('ShareRoute', () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    useWorkspaceStore.setState({ pendingSharedCp: null });
    document.getElementById(SHARED_CP_SCRIPT_ID)?.remove();
    resetInlinedSharedCp();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('prefers the payload the server inlined, so opening a link makes no request', async () => {
    inlineSharedCp('a3bK9xmQ', 'T0NTMQEB-_09');
    await act(async () => renderAt(root, '/s/a3bK9xmQ'));
    expect(useWorkspaceStore.getState().pendingSharedCp).toEqual({
      kind: 'payload',
      payload: 'T0NTMQEB-_09',
    });
    expect(host.querySelector('[data-testid="edit"]')).not.toBeNull();
  });

  it('falls back to the id when nothing was inlined', async () => {
    // A hand-typed URL, or one opened inside the ~60s KV takes to propagate globally.
    await act(async () => renderAt(root, '/s/a3bK9xmQ'));
    expect(useWorkspaceStore.getState().pendingSharedCp).toEqual({
      kind: 'id',
      shareId: 'a3bK9xmQ',
    });
  });

  it('ignores an inlined payload belonging to a different share', async () => {
    // Otherwise a stale payload from a previous navigation would silently open the
    // wrong crease pattern.
    inlineSharedCp('zzzzzzzz', 'T0NTMQEB-_09');
    await act(async () => renderAt(root, '/s/a3bK9xmQ'));
    expect(useWorkspaceStore.getState().pendingSharedCp).toEqual({
      kind: 'id',
      shareId: 'a3bK9xmQ',
    });
  });

  it('still captures a legacy fragment payload', async () => {
    await act(async () => renderAt(root, '/s#T0NTMQEB-_09'));
    expect(useWorkspaceStore.getState().pendingSharedCp).toEqual({
      kind: 'payload',
      payload: 'T0NTMQEB-_09',
    });
  });

  it('redirects without capturing when the id is malformed', async () => {
    await act(async () => renderAt(root, '/s/not-an-id'));
    expect(useWorkspaceStore.getState().pendingSharedCp).toBeNull();
    // Still lands on Edit: a truncated link should give the normal empty editor, not an
    // error screen.
    expect(host.querySelector('[data-testid="edit"]')).not.toBeNull();
  });

  it('redirects without capturing when there is nothing to capture', async () => {
    await act(async () => renderAt(root, '/s'));
    expect(useWorkspaceStore.getState().pendingSharedCp).toBeNull();
    expect(host.querySelector('[data-testid="edit"]')).not.toBeNull();
  });

  it('leaves the document alone — the route provisions nothing', async () => {
    await act(async () => renderAt(root, '/s#T0NTMQEB'));
    // The whole point of the handoff: routing decides intent, the Edit surface
    // self-provisions. A document created here would be a second path.
    expect(useWorkspaceStore.getState().oristudioCpDocument).toBeNull();
  });
});
