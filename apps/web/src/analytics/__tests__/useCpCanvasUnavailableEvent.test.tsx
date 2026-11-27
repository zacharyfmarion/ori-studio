import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CpRendererStatus } from '../../cp-workspace/renderer/webglSupport';
import type { PostHogClientLike } from '../bootstrap';
import { AnalyticsRuntimeProvider } from '../runtime';
import {
  resetCpCanvasUnavailableEventForTests,
  useCpCanvasUnavailableEvent,
} from '../useCpCanvasUnavailableEvent';

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

function events(client: ReturnType<typeof makeFakeClient>) {
  return client.capture.mock.calls
    .filter((call) => call[0] === 'cp canvas unavailable')
    .map((call) => call[1]);
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  resetCpCanvasUnavailableEventForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function Probe({ status }: { status: CpRendererStatus }) {
  useCpCanvasUnavailableEvent(status);
  return null;
}

function render(client: PostHogClientLike, node: ReactNode) {
  act(() => {
    root.render(createElement(AnalyticsRuntimeProvider, { client, children: node }));
  });
}

describe('useCpCanvasUnavailableEvent', () => {
  it('names the cause as an enum, never the detail line', () => {
    const client = makeFakeClient();
    render(
      client,
      createElement(Probe, {
        status: { kind: 'unsupported', gap: 'no-context', detail: 'no WebGL context' },
      })
    );
    expect(events(client)).toEqual([
      expect.objectContaining({ state: 'unsupported', cause: 'no_webgl' }),
    ]);
    expect(JSON.stringify(events(client))).not.toContain('no WebGL context');
  });

  // An unexpected failure's detail is a raw error message; it stays on screen.
  it('keeps an unexpected failure’s message out of the event', () => {
    const client = makeFakeClient();
    render(
      client,
      createElement(Probe, {
        status: { kind: 'unsupported', gap: null, detail: '(regl) something specific' },
      })
    );
    expect(events(client)).toEqual([
      expect.objectContaining({ state: 'unsupported', cause: 'unexpected' }),
    ]);
    expect(JSON.stringify(events(client))).not.toContain('something specific');
  });

  it('tells a loss mid-session from one met at start-up and one met mid-build', () => {
    const client = makeFakeClient();
    const statuses: CpRendererStatus[] = [
      { kind: 'context-lost' },
      { kind: 'context-lost', gap: 'context-lost-at-start' },
      { kind: 'context-lost', gap: 'context-failed' },
    ];
    for (const status of statuses) render(client, createElement(Probe, { status }));
    expect(events(client)).toEqual([
      expect.objectContaining({ state: 'restoring', cause: 'lost_while_drawing' }),
      expect.objectContaining({ state: 'restoring', cause: 'lost_at_start' }),
      expect.objectContaining({ state: 'restoring', cause: 'stopped_responding' }),
    ]);
  });

  // A document short of contexts can lose and regain one many times a second;
  // what is worth knowing is who met it, not how often the browser flickered.
  it('counts each state and cause once per page load', () => {
    const client = makeFakeClient();
    for (let i = 0; i < 3; i += 1) {
      act(() => root.unmount());
      root = createRoot(container);
      render(client, createElement(Probe, { status: { kind: 'context-lost' } }));
    }
    expect(events(client)).toHaveLength(1);
  });
});
