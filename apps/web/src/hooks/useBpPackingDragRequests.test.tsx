import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBpPackingDragRequests, type BpPackingDragRequests } from './useBpPackingDragRequests';
import type { BpFlapFootprint } from '../lib/bpFlapReshape';

/**
 * What the packing pane is allowed to ask the engine during a drag.
 *
 * A trace of one 1.9 s flap drag caught 736 engine messages — one refresh per
 * frame, each a solve plus a full document rebuild — for a gesture that crossed
 * a handful of grid cells. These are the rules that stop that, asserted as call
 * counts because that is exactly what was wrong.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Loc = { x: number; y: number };

const actions = {
  moveFlap: vi.fn(async (_id: number, _loc: Loc, _dragging: boolean) => true),
  moveFlaps: vi.fn(async (_ids: number[], _loc: Loc, _dragging: boolean) => true),
  moveDevice: vi.fn(
    async (_stretchId: string, _index: number, _loc: Loc, _dragging: boolean) => true,
  ),
  reshapeFlap: vi.fn(async (_id: number, _footprint: BpFlapFootprint, _dragging: boolean) => true),
};

const footprint = (width: number, height: number, radius: number): BpFlapFootprint => ({
  anchor: { x: 4, y: 4 },
  width,
  height,
  radius,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
/** Filled in by the probe below, so a test can call the verbs directly. */
const held: { api: BpPackingDragRequests | null } = { api: null };
const api = () => {
  if (!held.api) throw new Error('probe did not mount');
  return held.api;
};

function Probe() {
  const requests = useBpPackingDragRequests(actions);
  useEffect(() => {
    held.api = requests;
  }, [requests]);
  return null;
}

beforeEach(() => {
  // Synchronous, like the other pane tests: a frame runs the moment it is asked
  // for, which is also the case the scheduling guard has to survive.
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  for (const fn of Object.values(actions)) fn.mockClear();
  container = window.document.createElement('div');
  window.document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Probe />));
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

const at = (x: number, y: number) => ({ ids: [7], loc: { x, y } });

/**
 * Run some requests and let the queue drain.
 *
 * Requests are chained one at a time on purpose, so the second only reaches the
 * engine once the first has settled — an async `act` flushes those microtasks.
 */
async function drain(fn: () => void) {
  await act(async () => {
    fn();
  });
}

describe('BP packing drag requests', () => {
  it('asks once for a run of samples that land on the same grid cell', async () => {
    await drain(() => {
      api().beginFlapDrag();
      for (let i = 0; i < 20; i += 1) api().queueFlapDrag(at(4, 9));
    });
    expect(actions.moveFlap).toHaveBeenCalledTimes(1);
    expect(actions.moveFlap).toHaveBeenCalledWith(7, { x: 4, y: 9 }, true);
  });

  it('asks again as soon as the cell changes, and not before', async () => {
    await drain(() => api().beginFlapDrag());
    for (const loc of [at(4, 9), at(4, 9), at(5, 9), at(5, 9), at(6, 9)]) {
      await drain(() => api().queueFlapDrag(loc));
    }
    expect(actions.moveFlap).toHaveBeenCalledTimes(3);
    expect(actions.moveFlap.mock.calls.map((call) => call[1])).toEqual([
      { x: 4, y: 9 },
      { x: 5, y: 9 },
      { x: 6, y: 9 },
    ]);
  });

  it('settles on release even when the position has not moved since', async () => {
    // The release carries dragging=false, which is what closes the undo entry —
    // dropping it as a repeat would leave the gesture uncommitted.
    await drain(() => {
      api().beginFlapDrag();
      api().queueFlapDrag(at(4, 9));
    });
    await drain(() => api().flushFlapDrag(at(4, 9)));
    expect(actions.moveFlap).toHaveBeenCalledTimes(2);
    expect(actions.moveFlap.mock.calls.map((call) => call[2])).toEqual([true, false]);
  });

  it('lets a new gesture repeat where the last one ended', async () => {
    await drain(() => {
      api().beginFlapDrag();
      api().queueFlapDrag(at(4, 9));
    });
    await drain(() => api().flushFlapDrag(at(4, 9)));
    actions.moveFlap.mockClear();
    await drain(() => {
      api().beginFlapDrag();
      api().queueFlapDrag(at(4, 9));
    });
    expect(actions.moveFlap).toHaveBeenCalledTimes(1);
  });

  it('sends a multi-flap drag through the batch action', async () => {
    await drain(() => {
      api().beginFlapDrag();
      api().queueFlapDrag({ ids: [7, 8], loc: { x: 4, y: 9 } });
      api().queueFlapDrag({ ids: [7, 8], loc: { x: 4, y: 9 } });
    });
    expect(actions.moveFlaps).toHaveBeenCalledTimes(1);
    expect(actions.moveFlap).not.toHaveBeenCalled();
  });

  it('applies the same rules to a device drag', async () => {
    const device = (x: number) => ({ stretchId: '2,3', index: 0, loc: { x, y: 1 } });
    await drain(() => api().beginDeviceDrag());
    for (const update of [device(2), device(2), device(3)]) {
      await drain(() => api().queueDeviceDrag(update));
    }
    expect(actions.moveDevice).toHaveBeenCalledTimes(2);
  });

  it('applies the same rules to a resize-handle drag', async () => {
    await drain(() => api().beginFlapReshape());
    for (const width of [3, 3, 4]) {
      await drain(() => api().queueFlapReshape({ id: 7, footprint: footprint(width, 0, 5) }));
    }
    expect(actions.reshapeFlap).toHaveBeenCalledTimes(2);
  });

  it('re-asks when only a reshape’s radius changed', async () => {
    // A handle drag can leave the anchor exactly where it was and move only the
    // radius, so a repeat test that compared positions would drop the step.
    await drain(() => api().beginFlapReshape());
    for (const radius of [5, 6]) {
      await drain(() => api().queueFlapReshape({ id: 7, footprint: footprint(0, 0, radius) }));
    }
    expect(actions.reshapeFlap).toHaveBeenCalledTimes(2);
  });

  it('settles a reshape on release even when nothing moved since', async () => {
    await drain(() => {
      api().beginFlapReshape();
      api().queueFlapReshape({ id: 7, footprint: footprint(3, 0, 5) });
    });
    await drain(() => api().flushFlapReshape({ id: 7, footprint: footprint(3, 0, 5) }));
    expect(actions.reshapeFlap.mock.calls.map((call) => call[2])).toEqual([true, false]);
  });
});
