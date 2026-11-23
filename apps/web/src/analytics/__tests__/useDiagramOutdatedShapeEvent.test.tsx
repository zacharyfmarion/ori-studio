import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHogClientLike } from '../bootstrap';
import { AnalyticsRuntimeProvider } from '../runtime';
import { useDiagramOutdatedShapeEvent } from '../useDiagramOutdatedShapeEvent';

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
  return client.capture.mock.calls.filter((call) => call[0] === 'diagram outdated shape shown');
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function Probe({ shown }: { shown: boolean }) {
  useDiagramOutdatedShapeEvent(shown);
  return null;
}

function render(client: PostHogClientLike, shown: boolean) {
  act(() => {
    root.render(createElement(AnalyticsRuntimeProvider, { client, children: createElement(Probe, { shown }) }));
  });
}

describe('useDiagramOutdatedShapeEvent', () => {
  it('stays silent while Pose folds the step', () => {
    const client = makeFakeClient();
    render(client, false);
    expect(events(client)).toEqual([]);
  });

  it('reports each showing once, and again after Fold Again and another showing', () => {
    const client = makeFakeClient();
    render(client, true);
    render(client, true);
    expect(events(client)).toHaveLength(1);
    render(client, false);
    render(client, true);
    expect(events(client)).toHaveLength(2);
  });
});
