import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHONE_MEDIA_QUERY } from '../platform/phoneLayout';
import {
  simulatorPhoneHasList,
  useSimulatorPhoneFlow,
  type SimulatorPhoneFlow,
  type SimulatorPhoneFlowView,
} from './useSimulatorPhoneFlow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tracked: { event: string; properties?: Record<string, unknown> }[] = [];
vi.mock('../analytics', () => ({
  ANALYTICS_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
  track: (event: string, properties?: Record<string, unknown>) => {
    tracked.push(properties ? { event, properties } : { event });
  },
}));

function stubLayout(phone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === PHONE_MEDIA_QUERY ? phone : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: SimulatorPhoneFlow | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  latest = null;
  tracked.length = 0;
  vi.unstubAllGlobals();
});

function Probe({ view, select }: { view: SimulatorPhoneFlowView; select: (id: number) => void }) {
  const flow = useSimulatorPhoneFlow(view, select);
  useEffect(() => {
    latest = flow;
  });
  return null;
}

function render(view: SimulatorPhoneFlowView, select: (id: number) => void = () => {}) {
  act(() => root?.render(<Probe view={view} select={select} />));
}

const TWO: SimulatorPhoneFlowView = { segments: 2, revision: 1 };

describe('simulatorPhoneHasList', () => {
  // The rail hides itself for one pattern on every layout; a phone follows.
  it('lists only a choice of patterns', () => {
    expect(simulatorPhoneHasList({ segments: 0, revision: 1 })).toBe(false);
    expect(simulatorPhoneHasList({ segments: 1, revision: 1 })).toBe(false);
    expect(simulatorPhoneHasList(TWO)).toBe(true);
  });
});

describe('useSimulatorPhoneFlow', () => {
  it('starts on the list and opens a pattern by selecting it and showing the simulator', () => {
    stubLayout(true);
    const select = vi.fn();
    render(TWO, select);
    expect(latest?.screen).toBe('list');
    expect(latest?.back).toBeNull();

    act(() => latest?.openSegment(1));
    expect(select).toHaveBeenCalledWith(1);
    expect(latest?.screen).toBe('detail');
    expect(latest?.back).not.toBeNull();
    expect(tracked).toEqual([{ event: 'simulatorPatternOpened' }]);

    act(() => latest?.back?.());
    expect(latest?.screen).toBe('list');
  });

  it('opens straight on the simulator for a single pattern, with no Back', () => {
    stubLayout(true);
    render({ segments: 1, revision: 1 });
    expect(latest?.screen).toBe('detail');
    expect(latest?.back).toBeNull();
    // And for no pattern at all, whose overlay says why.
    render({ segments: 0, revision: 1 });
    expect(latest?.screen).toBe('detail');
    expect(latest?.back).toBeNull();
  });

  // The fold artifacts go stale when the document changes, which bumps the
  // revision: the pattern the simulator was opened on may no longer exist.
  it('returns to the list when the simulation source changes under the simulator', () => {
    stubLayout(true);
    render(TWO);
    act(() => latest?.openSegment(0));
    expect(latest?.screen).toBe('detail');
    render({ ...TWO, revision: 2 });
    expect(latest?.screen).toBe('list');
  });

  // A refresh of the same source — the artifacts recomputed for the same
  // document — keeps the revision, so the simulator stays open through it.
  it('keeps the simulator open while the same source reloads', () => {
    stubLayout(true);
    render(TWO);
    act(() => latest?.openSegment(0));
    render({ segments: 0, revision: 1 });
    expect(latest?.screen).toBe('detail');
    render(TWO);
    expect(latest?.screen).toBe('detail');
  });

  it('answers null off the phone, where a press is the selection alone', () => {
    stubLayout(false);
    const select = vi.fn();
    render(TWO, select);
    expect(latest?.screen).toBeNull();
    act(() => latest?.openSegment(1));
    expect(select).toHaveBeenCalledWith(1);
    expect(latest?.screen).toBeNull();
    expect(latest?.back).toBeNull();
    // Nothing was opened, so nothing is counted as opened.
    expect(tracked).toEqual([]);
  });
});
