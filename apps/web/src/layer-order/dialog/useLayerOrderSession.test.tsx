/**
 * The session hook's one promise about its worker: nothing it returns can
 * end the worker or its session under a status that still says it is there.
 * The worker ends when the dialog does (unmount), and when it dies on its
 * own the status says so.
 */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import {
  FAKE_LAYER_ORDER_FIGURE,
  FAKE_LAYER_ORDER_SOURCE,
  FAKE_LIMITS,
  fakeLayerOrderScene,
  fakeLayerOrderWorkers,
} from '../engine/layerOrderEngine.fixtures';
import { useLayerOrderSession, type LayerOrderSession } from './useLayerOrderSession';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const monitoring = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../../monitoring', () => ({ reportError: monitoring.reportError }));

const REQUEST: LayerOrderRequest = {
  source: FAKE_LAYER_ORDER_SOURCE,
  record: null,
  look: {
    style: DEFAULT_PAPER_STYLE,
    policy: PAPER_STYLE_POLICIES['folded-flat'],
    turnDeg: 0,
    side: 'front',
    xray: false,
    lineStyle: 'color',
    lineWidth: 1,
  },
  shown: fakeLayerOrderScene(FAKE_LAYER_ORDER_FIGURE, [2, 3, 0, 1], 'front'),
};

let host: HTMLDivElement;
let root: Root;
let session!: LayerOrderSession;
let workers: ReturnType<typeof fakeLayerOrderWorkers>;

/** Hands each render's session out, after the render. */
function Probe({ seen }: { seen: (latest: LayerOrderSession) => void }) {
  const latest = useLayerOrderSession(REQUEST, { spawn: workers.spawn });
  useEffect(() => seen(latest));
  return null;
}

const probe = () => (
  <Probe
    seen={(latest) => {
      session = latest;
    }}
  />
);

beforeEach(() => {
  monitoring.reportError.mockClear();
  workers = fakeLayerOrderWorkers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

async function flush(turns = 20) {
  await act(async () => {
    for (let i = 0; i < turns; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Whether the status still stands over a worker: opening or ready while none runs is a stranded session. */
const stranded = () =>
  (session.status.kind === 'opening' || session.status.kind === 'ready') && session.runtime?.running() === false;

describe('the session’s worker', () => {
  it('nothing reachable from the hook’s return ends the worker under a live status', async () => {
    act(() => root.render(probe()));
    await flush();
    expect(session.status.kind).toBe('ready');
    const runtime = session.runtime!;

    // No way to kill it: no stop, no cancel or dispose on the runtime, no close on its engine.
    expect('stop' in session).toBe(false);
    expect('cancel' in runtime).toBe(false);
    expect('dispose' in runtime).toBe(false);
    expect('close' in runtime.engine).toBe(false);

    // Everything there is, used: the worker stays and so does the session.
    runtime.invalidate();
    runtime.setCounting(true);
    runtime.setCounting(false);
    await act(async () => {
      await runtime.engine.stacks('front');
      await runtime.ask((client) => client.openPairs());
      await runtime.askCurrent((client) => client.constraints());
      await runtime.channel().request((client) => client.preview([2, 3, 1], FAKE_LIMITS));
      await session.apply();
    });
    expect(stranded()).toBe(false);
    act(() => session.reopen());
    await flush();
    expect(session.status.kind).toBe('ready');
    expect(stranded()).toBe(false);
    expect(workers.workers).toHaveLength(1);
    expect(workers.workers[0]!.terminated).toBe(false);

    // A worker that dies on its own: the status says so at once.
    act(() => workers.workers[0]!.crash());
    await flush();
    expect(session.status.kind).toBe('lost');
    expect(stranded()).toBe(false);

    // And the dialog closing is what ends the worker for good.
    act(() => session.reopen());
    await flush();
    expect(session.status.kind).toBe('ready');
    act(() => root.render(null));
    expect(workers.workers.every((worker) => worker.terminated)).toBe(true);
  });
});
