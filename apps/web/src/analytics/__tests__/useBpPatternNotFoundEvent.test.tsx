import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioBpStretch } from '../../engine/oristudioBpTypes';
import type { PostHogClientLike } from '../bootstrap';
import { AnalyticsRuntimeProvider } from '../runtime';
import { useBpPatternNotFoundEvent } from '../useBpPatternNotFoundEvent';

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
    .filter((call) => call[0] === 'bp pattern not found')
    .map((call) => call[1]);
}

function stretch(overrides: Partial<OristudioBpStretch> = {}): OristudioBpStretch {
  return {
    id: '1,2',
    flapIds: [1, 2],
    riverIds: [],
    completed: true,
    configIndex: 0,
    configCount: 1,
    patternIndex: 0,
    patternCount: 1,
    patternFound: true,
    regions: [],
    ...overrides,
  };
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

function Probe({ stretches }: { stretches: OristudioBpStretch[] }) {
  useBpPatternNotFoundEvent(stretches);
  return null;
}

function render(client: PostHogClientLike, node: ReactNode) {
  act(() => {
    root.render(createElement(AnalyticsRuntimeProvider, { client, children: node }));
  });
}

describe('useBpPatternNotFoundEvent', () => {
  it('stays silent when every stretch found a pattern', () => {
    const client = makeFakeClient();
    render(client, createElement(Probe, { stretches: [stretch()] }));
    expect(events(client)).toEqual([]);
  });

  it('reports bucketed counts and how far the configuration search got', () => {
    const client = makeFakeClient();
    render(
      client,
      createElement(Probe, {
        stretches: [
          stretch(),
          stretch({
            id: '10,12,14,22',
            flapIds: [10, 12, 14, 22],
            configCount: 0,
            patternCount: 0,
            patternFound: false,
          }),
          stretch({
            id: '11,13,15,22',
            flapIds: [11, 13, 15, 22],
            configCount: 0,
            patternCount: 0,
            patternFound: false,
          }),
        ],
      })
    );

    expect(events(client)).toEqual([
      {
        stretch_count_bucket: '<=2',
        max_flap_count_bucket: '<=5',
        configuration_reach: 'none',
      },
    ]);
  });

  it('distinguishes a stretch that reached a configuration', () => {
    const client = makeFakeClient();
    render(
      client,
      createElement(Probe, {
        stretches: [stretch({ configCount: 3, patternCount: 0, patternFound: false })],
      })
    );

    expect(events(client)).toEqual([
      {
        stretch_count_bucket: '<=1',
        max_flap_count_bucket: '<=5',
        configuration_reach: 'all',
      },
    ]);
  });

  it('sends no ids: they are flap ids, which are design structure', () => {
    const client = makeFakeClient();
    render(
      client,
      createElement(Probe, {
        stretches: [stretch({ id: '10,12,14,22', flapIds: [10, 12, 14, 22], patternFound: false })],
      })
    );

    const serialized = JSON.stringify(events(client));
    expect(serialized).not.toContain('10,12,14,22');
    expect(serialized).not.toContain('flap_ids');
  });

  it('refires only when which stretches fail changes', () => {
    const client = makeFakeClient();
    const failing = stretch({ patternFound: false });
    render(client, createElement(Probe, { stretches: [failing] }));
    // A new array with the same failing stretch is an ordinary re-render.
    render(client, createElement(Probe, { stretches: [{ ...failing }] }));
    expect(events(client)).toHaveLength(1);

    render(
      client,
      createElement(Probe, {
        stretches: [failing, stretch({ id: '3,4', flapIds: [3, 4], patternFound: false })],
      })
    );
    expect(events(client)).toHaveLength(2);
  });

  it('stays silent again once the failures are resolved', () => {
    const client = makeFakeClient();
    render(client, createElement(Probe, { stretches: [stretch({ patternFound: false })] }));
    render(client, createElement(Probe, { stretches: [stretch()] }));
    expect(events(client)).toHaveLength(1);
  });
});
