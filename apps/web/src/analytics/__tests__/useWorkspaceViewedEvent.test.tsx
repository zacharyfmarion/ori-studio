import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHogClientLike } from '../bootstrap';
import type { DesignVariant, WorkspaceScreen } from '../events';
import { AnalyticsRuntimeProvider } from '../runtime';
import { useWorkspaceViewedEvent } from '../useWorkspaceViewedEvent';

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
  return client.capture.mock.calls.filter((call) => call[0] === 'workspace viewed').map((call) => call[1]);
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function Probe({ workspace, variant }: { workspace: WorkspaceScreen; variant?: DesignVariant }) {
  useWorkspaceViewedEvent(workspace, variant);
  return null;
}

function render(client: PostHogClientLike, node: ReactNode) {
  act(() => {
    root.render(createElement(AnalyticsRuntimeProvider, { client, children: node }));
  });
}

describe('useWorkspaceViewedEvent', () => {
  it('fires `workspace viewed` with the workspace on mount', () => {
    const client = makeFakeClient();
    render(client, createElement(Probe, { workspace: 'edit' }));
    expect(viewedEvents(client)).toEqual([{ workspace: 'edit', variant: undefined }]);
  });

  it('carries the Design variant', () => {
    const client = makeFakeClient();
    render(client, createElement(Probe, { workspace: 'design', variant: 'treemaker' }));
    expect(viewedEvents(client)).toEqual([{ workspace: 'design', variant: 'treemaker' }]);
  });

  it('refires when the workspace or variant changes, not on an unrelated re-render', () => {
    const client = makeFakeClient();
    render(client, createElement(Probe, { workspace: 'design', variant: 'nux' }));
    // Same identity → no new event.
    render(client, createElement(Probe, { workspace: 'design', variant: 'nux' }));
    // Variant change → a new event.
    render(client, createElement(Probe, { workspace: 'design', variant: 'treemaker' }));
    expect(viewedEvents(client)).toEqual([
      { workspace: 'design', variant: 'nux' },
      { workspace: 'design', variant: 'treemaker' },
    ]);
  });
});
