import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHogClientLike } from '../bootstrap';
import type { WorkspaceScreen } from '../events';
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

function Probe({ workspace }: { workspace: WorkspaceScreen }) {
  useWorkspaceViewedEvent(workspace);
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
    expect(viewedEvents(client)).toEqual([{ workspace: 'edit' }]);
  });

  it('carries no design method', () => {
    // The Design workspace holds tabs, and one being circle-packed while another
    // is box-pleat means there is no single method to report. What designs are
    // open is reported by the `design tab *` events instead.
    const client = makeFakeClient();
    render(client, createElement(Probe, { workspace: 'design' }));
    expect(viewedEvents(client)).toEqual([{ workspace: 'design' }]);
  });

  it('refires when the workspace changes, not on an unrelated re-render', () => {
    const client = makeFakeClient();
    render(client, createElement(Probe, { workspace: 'design' }));
    // Same identity → no new event.
    render(client, createElement(Probe, { workspace: 'design' }));
    render(client, createElement(Probe, { workspace: 'edit' }));
    expect(viewedEvents(client)).toEqual([{ workspace: 'design' }, { workspace: 'edit' }]);
  });
});
