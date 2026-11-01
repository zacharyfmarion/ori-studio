/**
 * The inspector's effect runner (row U10) over the fake engine
 * (`engine/layerOrderEngine.fixtures.ts`), with the reducer it runs for:
 * each effect makes its engine call and answers the model with the action it
 * asked for, by its request; an answer the model no longer waits on goes
 * nowhere; the count follows the model's decision at every open and commit;
 * a call that fails goes to the hook's `failed`.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import {
  FAKE_LAYER_ORDER_FIGURE,
  FAKE_LAYER_ORDER_SOURCE,
  FAKE_LIMITS,
  createFakeLayerOrderBackend,
  fakeLayerOrderScene,
  type FakeLayerOrderBackend,
} from '../engine/layerOrderEngine.fixtures';
import type { LayerSolutionCount } from '../engine/layerOrderEngine';
import { initLayerOrderDialog, layerOrderReducer } from '../model/layerOrderReducer';
import type { LayerOrderAction, LayerOrderDialogState } from '../model/layerOrderState';
import { runLayerOrderEffects, type LayerOrderEffectHost } from './layerOrderEffects';
import { openLayerOrderSession } from './layerOrderSession';
import type { LayerOrderSessionEngine } from './useLayerOrderSession';

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
  shown: fakeLayerOrderScene(FAKE_LAYER_ORDER_FIGURE, [0, 1, 2, 3], 'front'),
};

/** Let every queued answer land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The model over the fake backend, as the hook binds them, but with no React:
 * the session's open done up front (its answer handed to the model), every
 * effect run, every answer dispatched back. `counting` records each
 * `setCounting`.
 */
async function harness(backend: FakeLayerOrderBackend = createFakeLayerOrderBackend()) {
  const engine = backend as unknown as LayerOrderSessionEngine;
  const opened = await openLayerOrderSession(engine, REQUEST, FAKE_LIMITS);
  if (opened.kind !== 'ready') throw new Error('the fake refused');
  let state: LayerOrderDialogState;
  const dispatched: LayerOrderAction[] = [];
  const counting: boolean[] = [];
  const failed = vi.fn();
  const close = vi.fn();
  const track = vi.fn();
  let count: LayerSolutionCount | null = null;
  const host: LayerOrderEffectHost = {
    engine,
    request: REQUEST,
    dispatch: (action) => {
      dispatched.push(action);
      const step = layerOrderReducer(state, action);
      state = step.state;
      runLayerOrderEffects(step.effects, step.state, host);
    },
    // The session's own open answers the model's first.
    reopen: (request) => host.dispatch({ type: 'opened', request, facts: opened.open.facts }),
    setCounting: (on) => counting.push(on),
    count: () => count,
    failed,
    close,
    track,
  };
  const first = initLayerOrderDialog({
    surface: 'edit_figure',
    hasRecord: false,
    recordNeedsAttention: false,
    review: false,
    xray: false,
    at: 0,
  });
  state = first.state;
  runLayerOrderEffects(first.effects, first.state, host);
  await settle();
  return {
    host,
    backend,
    dispatched,
    counting,
    failed,
    close,
    track,
    state: () => state,
    setCount: (next: LayerSolutionCount | null) => {
      count = next;
    },
  };
}

describe('the inspector’s effect runner', () => {
  it('opens on the session’s own open, reports it, and asks the position with the count on', async () => {
    const h = await harness();
    expect(h.state().phase.kind).toBe('open');
    expect(h.counting).toEqual([true]);
    expect(h.track.mock.calls[0]![0]).toMatchObject({
      event: 'layer order dialog opened',
      properties: { surface: 'edit_figure', solutions_bucket: 'pending' },
    });
    expect(h.dispatched.map((action) => action.type)).toEqual(['opened', 'solutions_counted']);
    expect(h.backend.calls).toContain('position');
  });

  it('previews a complete sentence, and Add commits it by the preview’s token', async () => {
    const h = await harness();
    // Face 2 in front of face 3: both open, and the order on screen already fits it.
    h.host.dispatch({ type: 'face_picked', face: 2, origin: 'pattern' });
    h.host.dispatch({ type: 'face_picked', face: 3, origin: 'folded' });
    await settle();
    expect(h.backend.calls).toContain('previewList');
    expect(h.dispatched.at(-1)).toMatchObject({ type: 'previewed', facts: { verdict: 'fits' } });
    h.host.dispatch({ type: 'add' });
    await settle();
    expect(h.backend.calls).toContain('commitPreview');
    // Face 3 shows its back from the front: in front of it is its back side, FOLD's -1.
    expect(h.state().rows.committed.map((row) => row.constraint)).toEqual([[2, 3, -1]]);
    expect(h.track.mock.calls.at(-1)![0]).toMatchObject({ event: 'layer constraint added', properties: { object_count_bucket: '<=1' } });
  });

  it('drops an answer the model no longer waits on: a preview the sentence moved past', async () => {
    const backend = createFakeLayerOrderBackend();
    const held = backend.hold('previewList');
    const h = await harness(backend);
    h.host.dispatch({ type: 'face_picked', face: 2, origin: 'pattern' });
    h.host.dispatch({ type: 'face_picked', face: 3, origin: 'folded' });
    // A new subject before the answer: its preview is no longer the one on display, and the commit
    // after it (Clear all of nothing, here a removal) moves the order on screen.
    h.host.dispatch({ type: 'sentence_cleared' });
    const before = h.state();
    held.release();
    await settle();
    await settle();
    // The answer landed in the cache it was asked for, and changed nothing on screen.
    expect(h.state().sentence).toEqual(before.sentence);
    expect(h.state().shown).toBe(before.shown);
  });

  it('turns the count off and on as each commit leaves more or fewer pairs open (D7)', async () => {
    const budgets = await import('../layerOrderBudgets');
    const h = await harness();
    const starts = vi.spyOn(budgets, 'layerOrderCountStarts');
    starts.mockReturnValue(false);
    h.host.dispatch({ type: 'face_picked', face: 2, origin: 'pattern' });
    h.host.dispatch({ type: 'face_picked', face: 3, origin: 'folded' });
    await settle();
    h.host.dispatch({ type: 'add' });
    await settle();
    expect(h.counting.at(-1)).toBe(false);
    expect(h.state().solutions.runs).toBe(false);
    starts.mockReturnValue(true);
    h.host.dispatch({ type: 'undo' });
    await settle();
    expect(h.counting.at(-1)).toBe(true);
    expect(h.state().solutions.runs).toBe(true);
    starts.mockRestore();
  });

  it('undo puts the exact order back (`show`), and commits the list instead should that be refused', async () => {
    const h = await harness();
    const opening = h.state().shownOrder;
    expect(opening).not.toBeNull();
    for (const direction of ['next', 'previous'] as const) {
      if (h.state().history.past.length > 0) break;
      h.host.dispatch({ type: 'step', direction });
      await settle();
    }
    expect(h.state().history.past).toEqual([{ kind: 'step', order: opening }]);
    const stepped = h.state().shownOrder;
    expect(stepped).not.toEqual(opening);
    const before = h.backend.calls.length;
    h.host.dispatch({ type: 'undo' });
    await settle();
    // No search, and the position read again for the order put back.
    expect(h.backend.calls.slice(before)).toEqual(['show', 'position']);
    expect(h.state().shownOrder).toEqual(opening);
    expect(h.state().history.future).toEqual([{ kind: 'step', order: stepped }]);
    // Refused (which an order the session showed never is): the list is committed for the closest order, and
    // the history moves all the same, so an undo never sticks.
    const refuse = vi.spyOn(h.backend, 'show').mockResolvedValue({ verdict: 'refused' });
    const asked = h.backend.calls.length;
    h.host.dispatch({ type: 'redo' });
    await settle();
    expect(refuse).toHaveBeenCalledOnce();
    expect(h.backend.calls.slice(asked, asked + 2)).toEqual(['commit', 'order']);
    expect(h.state().history).toEqual({ past: [{ kind: 'step', order: opening }], future: [] });
    refuse.mockRestore();
  });

  it('asks nothing for a count slice: the runtime slices between calls', async () => {
    const h = await harness();
    const calls = h.backend.calls.length;
    runLayerOrderEffects([{ type: 'solutions_slice', generation: 1, by: { picture: 'front' }, limits: FAKE_LIMITS }], h.state(), h.host);
    runLayerOrderEffects([{ type: 'flash', n: 1 }], h.state(), h.host);
    await settle();
    expect(h.backend.calls.length).toBe(calls);
  });

  it('hands a call that fails to the hook, and Cancel to the dialog’s way out', async () => {
    const backend = createFakeLayerOrderBackend();
    const h = await harness(backend);
    backend.trapNext('previewList');
    h.host.dispatch({ type: 'face_picked', face: 2, origin: 'pattern' });
    h.host.dispatch({ type: 'face_picked', face: 3, origin: 'folded' });
    await settle();
    expect(h.failed).toHaveBeenCalledWith(expect.any(WebAssembly.RuntimeError), 'preview');
    h.host.dispatch({ type: 'cancel', at: 5_000 });
    expect(h.close).toHaveBeenCalledTimes(1);
    expect(h.track.mock.calls.at(-1)![0]).toMatchObject({ event: 'layer order dialog closed', properties: { outcome: 'cancelled' } });
  });

  it('restores a record that ran out again on the session already open (D10’s Keep trying)', async () => {
    const h = await harness();
    const restoring: LayerOrderDialogState = { ...h.state(), settle: { kind: 'restoring', request: 99, limits: FAKE_LIMITS } };
    const engine = { ...h.host.engine, restoreRecord: vi.fn(h.host.engine.restoreRecord) } as LayerOrderSessionEngine;
    const reopen = vi.fn();
    runLayerOrderEffects(
      [{ type: 'open', request: 99, how: 'restore', limits: FAKE_LIMITS }],
      restoring,
      { ...h.host, engine, reopen, request: { ...REQUEST, record: { faces: [], constraints: [], order: [] } } }
    );
    await settle();
    expect(reopen).not.toHaveBeenCalled();
    expect(engine.restoreRecord).toHaveBeenCalledTimes(1);
  });
});
