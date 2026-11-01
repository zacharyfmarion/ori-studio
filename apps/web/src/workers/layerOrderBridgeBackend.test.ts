/**
 * The bridge backend's own bookkeeping, over a stub of the bridge: the
 * session it holds, the cursor it starts and starts again, and what it sends
 * across. The calls themselves, over the built bridge, are
 * `layer-order/engine/layerOrderEngine.wasm.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS } from '../layer-order/engine/layerOrderEngine.fixtures';
import type { LayerOrderBridge, LayerSolutionCaps, LayerSolutionCount } from '../layer-order/engine/layerOrderWire';
import { LAYER_ORDER_RECORD_MAX_BYTES, type LayerOrderRecord } from '../lib/layerOrder/layerOrderRecord';
import { createLayerOrderBridgeBackend } from './layerOrderBridgeBackend';

const COUNT: LayerSolutionCount = {
  front: { n: 1, exact: false },
  back: { n: 1, exact: false },
  orders: { n: 1, exact: false },
  done: false,
};

/** A bridge that answers every call with a canned value, and logs each by name with its handles. */
function stubBridge() {
  const log: string[] = [];
  let sessions = 0;
  let cursors = 0;
  const opened = () => {
    sessions += 1;
    return {
      status: 'ok' as const,
      session: sessions,
      faces: 2,
      front_up: Uint8Array.of(1, 0),
      open_pairs: Uint32Array.of(0, 1),
      spots: 1,
      opened_on: { kind: 'first' as const, timed_out: null },
    };
  };
  const committed = {
    verdict: 'committed' as const,
    changed: { front: new Uint32Array(), back: new Uint32Array() },
    stacks: {
      front: { offsets: Uint32Array.of(0, 2), faces: Uint32Array.of(1, 0) },
      back: { offsets: Uint32Array.of(0, 2), faces: Uint32Array.of(0, 1) },
    },
    open_pairs: new Uint32Array(),
    stage: 'seeds_first' as const,
    nodes: 1,
    adopted: false,
  };
  const bridge = {
    layer_open: vi.fn((source: unknown, limits: unknown) => {
      log.push(`open ${JSON.stringify(source)} ${JSON.stringify(limits)}`);
      return opened();
    }),
    layer_open_showing: vi.fn(() => {
      log.push('open_showing');
      return opened();
    }),
    layer_restore: vi.fn(() => {
      log.push('restore');
      return { ...opened(), constraints: Int32Array.of(0, 1, 1), outcome: { kind: 'applied' as const } };
    }),
    layer_close: vi.fn((session: number) => {
      log.push(`close ${session}`);
      return true;
    }),
    layer_commit: vi.fn((session: number) => {
      log.push(`commit ${session}`);
      return committed;
    }),
    layer_constraints: vi.fn(() => Int32Array.of(0, 1, 1, 1, 0, -1)),
    layer_scene: vi.fn((_session: number, _side: string, model: unknown) => {
      log.push(`scene ${(model as { scale: number }).scale}`);
      return null;
    }),
    layer_save: vi.fn(() => ({ status: 'ok' as const, json: '{"v":1,"faces":[{"at":[0,0],"area":0}]' })),
    layer_step: vi.fn((session: number, cursor: number) => {
      log.push(`step ${session}:${cursor}`);
      return { verdict: 'end' as const };
    }),
    layer_open_pairs: vi.fn(() => Uint32Array.of(0, 1)),
    layer_solutions_start: vi.fn((session: number, _caps?: LayerSolutionCaps) => {
      cursors += 1;
      log.push(`start ${session}:${cursors}`);
      return cursors;
    }),
    layer_solutions_advance: vi.fn((session: number, cursor: number) => {
      log.push(`advance ${session}:${cursor}`);
      return COUNT;
    }),
    layer_solutions_close: vi.fn((session: number, cursor: number) => {
      log.push(`close cursor ${session}:${cursor}`);
      return true;
    }),
  };
  return { bridge, log, asBridge: bridge as unknown as LayerOrderBridge };
}

describe('createLayerOrderBridgeBackend', () => {
  it('answers nothing before an open, as session_not_open', () => {
    const backend = createLayerOrderBridgeBackend(stubBridge().asBridge);
    expect(() => backend.openPairs()).toThrow(expect.objectContaining({ code: 'layer_order_session_not_open' }));
    expect(() => backend.countSlice(FAKE_LIMITS)).toThrow(
      expect.objectContaining({ code: 'layer_order_session_not_open' })
    );
  });

  it('sends the kernel’s source and the three limits, holds no handle, and closes a session before the next', () => {
    const { log, asBridge } = stubBridge();
    const backend = createLayerOrderBridgeBackend(asBridge);
    const extra = { ...FAKE_LIMITS, label: 'not a limit' };
    const first = backend.open(FAKE_LAYER_ORDER_SOURCE, extra);
    expect(first).not.toHaveProperty('session');
    expect(first).toMatchObject({ status: 'ok', faces: 2, opened_on: { kind: 'first', timed_out: null } });
    backend.openShowing(FAKE_LAYER_ORDER_SOURCE, Uint32Array.of(0, 1), FAKE_LIMITS);
    backend.scene('front');
    expect(log).toEqual([
      'open {"segments":[],"starting_face_id":0,"aux_segments":[],"digest":"fake-figure"} {"maxNodes":1000,"fastNodes":128,"deadlineMs":1000}',
      'close 1',
      'open_showing',
      `scene ${FAKE_LAYER_ORDER_SOURCE.model.scale}`,
    ]);
    expect(backend.constraints()).toEqual([
      [0, 1, 1],
      [1, 0, -1],
    ]);
  });

  it('starts one cursor, keeps it across a step, and starts another after a commit that committed', () => {
    const { bridge, log, asBridge } = stubBridge();
    const backend = createLayerOrderBridgeBackend(asBridge);
    backend.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    log.length = 0;

    expect(backend.countSlice(FAKE_LIMITS)).toEqual({ epoch: 1, count: COUNT });
    expect(backend.countSlice(FAKE_LIMITS)).toEqual({ epoch: 1, count: COUNT });
    backend.step({ picture: 'front' }, 'next', FAKE_LIMITS);
    expect(backend.countSlice(FAKE_LIMITS)).toEqual({ epoch: 1, count: COUNT });
    backend.commit([[0, 1, 1]], FAKE_LIMITS);
    expect(backend.countSlice(FAKE_LIMITS)).toEqual({ epoch: 2, count: COUNT });
    // A commit that did not land keeps the cursor.
    bridge.layer_commit.mockImplementationOnce((session: number) => {
      log.push(`commit ${session}`);
      return { verdict: 'timed_out', limit: 'nodes', nodes: 0 } as never;
    });
    backend.commit([[1, 0, 1]], FAKE_LIMITS);
    expect(backend.countSlice(FAKE_LIMITS)).toEqual({ epoch: 2, count: COUNT });
    // A close takes the cursor with the session.
    backend.close();

    expect(log).toEqual([
      'start 1:1',
      'advance 1:1',
      'advance 1:1',
      'step 1:1',
      'advance 1:1',
      'commit 1',
      'close cursor 1:1',
      'start 1:2',
      'advance 1:2',
      'commit 1',
      'advance 1:2',
      'close cursor 1:2',
      'close 1',
    ]);
  });

  it('starts each cursor saying whether its steps count on, by the pairs open as it starts (E9)', () => {
    const { bridge, asBridge } = stubBridge();
    const asked: number[] = [];
    const backend = createLayerOrderBridgeBackend(asBridge, {
      caps: { storedBits: 1 << 20 },
      countInSteps: (openPairs) => {
        asked.push(openPairs);
        return openPairs <= 1;
      },
    });
    backend.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    backend.step({ picture: 'front' }, 'next', FAKE_LIMITS);
    expect(bridge.layer_solutions_start).toHaveBeenLastCalledWith(1, { storedBits: 1 << 20, countInSteps: true });
    // A commit leaves more pairs open (more than the threshold here): the next cursor's steps spend nothing on the count.
    bridge.layer_open_pairs.mockReturnValue(Uint32Array.of(0, 1, 0, 2));
    backend.commit([[0, 1, 1]], FAKE_LIMITS);
    backend.countSlice(FAKE_LIMITS);
    expect(bridge.layer_solutions_start).toHaveBeenLastCalledWith(1, { storedBits: 1 << 20, countInSteps: false });
    // Read once per cursor, as it starts.
    backend.step({ picture: 'front' }, 'next', FAKE_LIMITS);
    expect(asked).toEqual([1, 2]);
  });

  it('leaves whether a step counts on to the wire when it is not told', () => {
    const { bridge, asBridge } = stubBridge();
    const backend = createLayerOrderBridgeBackend(asBridge);
    backend.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    backend.step({ picture: 'front' }, 'next', FAKE_LIMITS);
    expect(bridge.layer_solutions_start).toHaveBeenLastCalledWith(1, undefined);
    expect(bridge.layer_open_pairs).not.toHaveBeenCalled();
  });

  it('starts a cursor the bridge calls stale again on the spot, under a new epoch', () => {
    const { bridge, log, asBridge } = stubBridge();
    const backend = createLayerOrderBridgeBackend(asBridge);
    backend.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    backend.countSlice(FAKE_LIMITS);
    log.length = 0;
    bridge.layer_solutions_advance.mockImplementationOnce(() => {
      throw { code: 'session_stale_solutions', message: 'stale' };
    });

    expect(backend.countSlice(FAKE_LIMITS)).toEqual({ epoch: 2, count: COUNT });
    expect(log).toEqual(['close cursor 1:1', 'start 1:2', 'advance 1:2']);

    // Any other thrown code passes through.
    bridge.layer_solutions_advance.mockImplementationOnce(() => {
      throw { code: 'session_internal', message: 'broken' };
    });
    expect(() => backend.countSlice(FAKE_LIMITS)).toThrow(expect.objectContaining({ code: 'session_internal' }));
  });

  it('refuses a record the codec cannot send without asking the bridge, and restores one it can', () => {
    const { bridge, asBridge } = stubBridge();
    const backend = createLayerOrderBridgeBackend(asBridge);
    const huge: LayerOrderRecord = {
      faces: Array.from({ length: LAYER_ORDER_RECORD_MAX_BYTES / 20 }, (_, i) => ({ at: [i, i] as const, area: 1 })),
      constraints: [],
      order: [],
    };
    expect(backend.restore(FAKE_LAYER_ORDER_SOURCE, huge, FAKE_LIMITS)).toMatchObject({
      status: 'refused',
      refusal: { code: 'record_over_budget', budget: LAYER_ORDER_RECORD_MAX_BYTES },
    });
    expect(bridge.layer_restore).not.toHaveBeenCalled();

    const small: LayerOrderRecord = { faces: [], constraints: [], order: [] };
    expect(backend.restore(FAKE_LAYER_ORDER_SOURCE, small, FAKE_LIMITS)).toMatchObject({
      status: 'ok',
      constraints: [[0, 1, 1]],
      outcome: { kind: 'applied' },
    });
  });

  it('a saved record that does not read here is a defect, thrown as session_internal', () => {
    const backend = createLayerOrderBridgeBackend(stubBridge().asBridge);
    backend.open(FAKE_LAYER_ORDER_SOURCE, FAKE_LIMITS);
    expect(() => backend.save()).toThrow(expect.objectContaining({ code: 'session_internal' }));
  });
});
