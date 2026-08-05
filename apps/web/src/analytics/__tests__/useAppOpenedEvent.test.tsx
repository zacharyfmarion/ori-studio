import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHogClientLike } from '../bootstrap';
import { AnalyticsRuntimeProvider } from '../runtime';
import { resetAppOpenedForTest, useAppOpenedEvent } from '../useAppOpenedEvent';

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

function capturedEvents(client: ReturnType<typeof makeFakeClient>, name: string) {
  return client.capture.mock.calls.filter((call) => call[0] === name);
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  resetAppOpenedForTest();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function renderWithAnalytics(client: PostHogClientLike, node: ReactNode) {
  act(() => {
    root.render(createElement(AnalyticsRuntimeProvider, { client, children: node }));
  });
}

function Probe() {
  useAppOpenedEvent();
  return null;
}

describe('useAppOpenedEvent', () => {
  it('fires `app opened` once on mount', () => {
    const client = makeFakeClient();
    renderWithAnalytics(client, createElement(Probe));
    expect(capturedEvents(client, 'app opened')).toHaveLength(1);
  });

  it('does not refire on a remount within the same launch', () => {
    const client = makeFakeClient();
    renderWithAnalytics(client, createElement(Probe));
    // Unmount and mount the probe again without resetting the module guard.
    renderWithAnalytics(client, null);
    renderWithAnalytics(client, createElement(Probe));
    expect(capturedEvents(client, 'app opened')).toHaveLength(1);
  });
});
