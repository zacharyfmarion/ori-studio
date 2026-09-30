import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHogClientLike } from '../bootstrap';
import type { SitePageViewedId } from '../events';
import { AnalyticsRuntimeProvider } from '../runtime';
import { useSitePageViewedEvent } from '../useSitePageViewedEvent';

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

function events(client: ReturnType<typeof makeFakeClient>, name: string) {
  return client.capture.mock.calls.filter((call) => call[0] === name).map((call) => call[1]);
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
});

function Probe({ page }: { page: SitePageViewedId }) {
  useSitePageViewedEvent(page);
  return null;
}

function render(client: PostHogClientLike, page: SitePageViewedId) {
  act(() => {
    root.render(
      createElement(AnalyticsRuntimeProvider, { client, children: createElement(Probe, { page }) })
    );
  });
}

describe('useSitePageViewedEvent', () => {
  it('reports which page was opened', () => {
    const client = makeFakeClient();
    render(client, 'download');
    expect(events(client, 'site page viewed')).toEqual([{ page: 'download' }]);
  });

  it('fires once per mount, not per render', () => {
    const client = makeFakeClient();
    render(client, 'download');
    render(client, 'download');
    expect(events(client, 'site page viewed')).toHaveLength(1);
  });
});
