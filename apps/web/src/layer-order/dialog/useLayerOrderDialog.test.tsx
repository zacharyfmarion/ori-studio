/**
 * `useLayerOrderDialog` over the fake engine (U10's review): Apply carries
 * out the model's own D16 verdict, whatever the session first opened on, and
 * a save that is refused leaves the session as it was.
 */
import { act, createElement, type MutableRefObject } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import {
  FAKE_LAYER_ORDER_FIGURE,
  FAKE_LAYER_ORDER_SOURCE,
  FakeLayerOrderWorker,
  createFakeLayerOrderBackend,
  fakeLayerOrderScene,
  type FakeLayerOrderBackend,
} from '../engine/layerOrderEngine.fixtures';
import { layerOrderReducer } from '../model/layerOrderReducer';
import { rowKeyOf } from '../model/layerOrderRowGroups';
import { applyState } from '../model/layerOrderSelectors';
import {
  beginLayerOrderDialog,
  registerLayerOrderDialogMount,
  resetLayerOrderDialogStoreForTest,
  type LayerOrderDialogOpening,
} from './layerOrderDialogStore';
import { useLayerOrderDialog, type LayerOrderDialogBinding } from './useLayerOrderDialog';
import { useLayerOrderSession } from './useLayerOrderSession';
import { useLayerOrderSettle } from './useLayerOrderSettle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

vi.mock('../../monitoring', () => ({ reportError: vi.fn() }));
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../../analytics/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics/runtime')>()),
  track: analytics.track,
}));

const pt = (k: number) => ({ at: FAKE_LAYER_ORDER_FIGURE.facePoints[k]!, area: 100 });
/** D over C: the toy figure's first order has to move for it, so a search with no nodes runs out. */
const RECORD: LayerOrderRecord = { faces: [pt(3), pt(2)], constraints: [[0, 1, 1]], order: [] };

const REQUEST: LayerOrderRequest = {
  source: FAKE_LAYER_ORDER_SOURCE,
  record: RECORD,
  look: {
    style: DEFAULT_PAPER_STYLE,
    policy: PAPER_STYLE_POLICIES['folded-flat'],
    turnDeg: 0,
    side: 'front',
    xray: false,
    lineStyle: 'color',
    lineWidth: 1,
  },
  shown: fakeLayerOrderScene(FAKE_LAYER_ORDER_FIGURE, [0, 1, 2, 3], 'front'),
};

async function mount(request: LayerOrderRequest, makeBackend: () => FakeLayerOrderBackend) {
  resetLayerOrderDialogStoreForTest();
  const leave = registerLayerOrderDialogMount();
  const begun = beginLayerOrderDialog(request);
  if (!('opening' in begun)) throw new Error('no opening');
  const out: MutableRefObject<LayerOrderDialogBinding | null> = { current: null };
  const spawn = () => new FakeLayerOrderWorker(makeBackend()) as unknown as Worker;
  function Harness({ opening }: { opening: LayerOrderDialogOpening }) {
    const session = useLayerOrderSession(opening.request, { spawn });
    const settle = useLayerOrderSettle(opening, session);
    out.current = useLayerOrderDialog(opening, session, settle);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Harness, { opening: begun.opening })));
  return {
    out,
    outcome: begun.outcome,
    done: async () => {
      await act(async () => root.unmount());
      leave();
    },
  };
}

describe('useLayerOrderDialog', () => {
  it('D16 after Keep trying a restore that ran out: an untouched Apply answers unchanged, as the model says', async () => {
    const backend = () => {
      const base = createFakeLayerOrderBackend();
      return {
        ...base,
        // The dialog's first restore runs out (no nodes); Keep trying's, on the open session, does not.
        restore: (source, record, limits) => base.restore(source, record, { ...limits, maxNodes: 0 }),
        // As the real engine says of a restore that applied every row on the order it saved: held.
        restoreRecord: async (record, limits) => {
          const out = await base.restoreRecord(record, limits);
          return out.status === 'ok' ? { ...out, opened_on: { kind: 'held', ignored: 0 } } : out;
        },
      } as FakeLayerOrderBackend;
    };
    const h = await mount(REQUEST, backend);
    await vi.waitFor(() => expect(h.out.current?.state.phase.kind).toBe('open'));
    expect(h.out.current!.state.settle.kind).toBe('timed_out');
    await act(async () => h.out.current!.dispatch({ type: 'keep_trying' }));
    await vi.waitFor(() => expect(h.out.current?.state.settle.kind).toBe('settled'));
    const asked = layerOrderReducer(h.out.current!.state, { type: 'apply', at: 0 }).effects.find((e) => e.type === 'apply');
    expect(asked).toMatchObject({ result: { kind: 'no_change' } });
    analytics.track.mockClear();
    await act(async () => h.out.current!.apply());
    const outcome = await h.outcome;
    await h.done();
    expect(outcome.kind).toBe('unchanged');
    expect(analytics.track).toHaveBeenCalledWith('layer order dialog closed', expect.objectContaining({ outcome: 'unchanged' }));
  });

  it('Rotate alone: Apply answers unchanged with the host’s new turn, and says it was rotated', async () => {
    const turned = { ...REQUEST, record: null, look: { ...REQUEST.look, turnDeg: 90 } };
    const h = await mount(turned, () => createFakeLayerOrderBackend());
    await vi.waitFor(() => expect(h.out.current?.state.phase.kind).toBe('open'));
    expect(h.out.current!.view.turnDeg).toBe(90);
    await act(async () => h.out.current!.events.onTurn?.('right'));
    await act(async () => h.out.current!.events.onTurn?.('right'));
    expect(h.out.current!.view.turnDeg).toBe(120);
    expect(applyState(h.out.current!.state)).toEqual({ enabled: true });
    analytics.track.mockClear();
    await act(async () => h.out.current!.apply());
    const outcome = await h.outcome;
    await h.done();
    expect(outcome).toEqual({ kind: 'unchanged', turnDeg: 120 });
    expect(analytics.track).toHaveBeenCalledWith(
      'layer order dialog closed',
      expect.objectContaining({ outcome: 'unchanged', rotated: true })
    );
  });

  it('a carried row removed, an Apply refused, the removal undone: the next Apply writes the row back', async () => {
    let refuse = true;
    const saves: (readonly number[] | undefined)[] = [];
    const backend = () => {
      const base = createFakeLayerOrderBackend();
      return {
        ...base,
        save: async (keep?: readonly number[]) => {
          saves.push(keep);
          return refuse ? { status: 'refused', refusal: { code: 'record_over_budget', bytes: 2, budget: 1 } } : base.save(keep);
        },
      } as FakeLayerOrderBackend;
    };
    const off = { at: [9_999, 9_999] as [number, number], area: 1 };
    const gone: LayerOrderRecord = { faces: [off, pt(0), pt(1)], constraints: [[0, 1, 1], [0, 2, 1]], order: [] };
    const h = await mount({ ...REQUEST, record: gone }, backend);
    await vi.waitFor(() => expect(h.out.current?.state.phase.kind).toBe('open'));
    const carried = h.out.current!.state.rows.carried;
    expect(carried.map((row) => row.facts.index)).toEqual([0, 1]);
    const key = rowKeyOf(carried[0]!, h.out.current!.state.figure);
    await act(async () => h.out.current!.dispatch({ type: 'row_removed', key }));
    await act(async () => h.out.current!.apply());
    await vi.waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toEqual([1]);
    // The refusal lands after the save answers.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(h.out.current!.state.phase.kind).toBe('open');
    await act(async () => h.out.current!.history.undo());
    expect(h.out.current!.state.rows.carried.map((row) => row.facts.index)).toEqual([0, 1]);
    refuse = false;
    await act(async () => h.out.current!.apply());
    const outcome = await h.outcome;
    await h.done();
    if (outcome.kind !== 'applied') throw new Error(outcome.kind);
    expect(saves[1]).toEqual([0, 1]);
    expect(outcome.applied.record.constraints).toHaveLength(2);
  });

  describe('its init, read from the request (`layerOrderRequestInit`)', () => {
    /** The record restored whole, on the order the host shows: what an untouched Apply leaves alone (D16). */
    const restoredWhole = () => {
      const base = createFakeLayerOrderBackend();
      return {
        ...base,
        restore: async (source, record, limits) => {
          const out = await base.restore(source, record, limits);
          return out.status === 'ok' ? { ...out, opened_on: { kind: 'held', ignored: 0 } } : out;
        },
      } as FakeLayerOrderBackend;
    };

    async function untouchedApply(request: LayerOrderRequest) {
      const h = await mount(request, restoredWhole);
      // Settled, and the solutions' count quiet: Apply can go.
      await vi.waitFor(() => expect(h.out.current && applyState(h.out.current.state).enabled).toBe(true));
      const review = h.out.current!.state.review;
      await act(async () => h.out.current!.apply());
      const outcome = await h.outcome;
      await h.done();
      return { kind: outcome.kind, review };
    }

    it('writes on an untouched Apply over a stale host’s record, so the host’s refold happens (D12)', async () => {
      expect(await untouchedApply(REQUEST)).toEqual({ kind: 'unchanged', review: false });
      expect((await untouchedApply({ ...REQUEST, applyRefolds: true })).kind).toBe('applied');
    });

    it('opens from Review… as a review (D14)', async () => {
      expect((await untouchedApply({ ...REQUEST, review: true })).review).toBe(true);
    });
  });
});
