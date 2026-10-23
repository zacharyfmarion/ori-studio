import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FoldSessionSurface } from '../session/useFoldSession';
import type { FoldToolStep } from '../canvas/useFoldToolPreview';
import { useFoldOrderResolution } from './useFoldOrderResolution';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const base: FoldToolStep = { op: { kind: 'squash', flap: [0.2, 0.2], direction: 'valley' }, key: 'base' };
const witness = { faces: [[0.1, 0.1]], orders: [[0, 1, 1]] };
let activeBase = base;
const releaseOrderSearch = vi.fn();
const orderSelection = vi.fn();
const cancelSearch = vi.fn();
const session = { cursor: { state: { generation: 1, id: 1 } },
  withCursor: async (call: (e: unknown, at: number) => Promise<unknown>) => ({ status: 'answered', value: await call({ orderSelection, releaseOrderSearch }, 1) }),
  // The session's orders, asked of the state on screen as the worker's are: a ticket only for a search.
  resolveOrders: async (...[op, choices, query, search]: unknown[]) => ({
    status: 'answered',
    value: await (search ? orderSelection(1, op, choices, query, search) : orderSelection(1, op, choices, query)),
  }),
  cancelSearch,
} as unknown as FoldSessionSurface;
let seen: ReturnType<typeof useFoldOrderResolution>;
let root: ReturnType<typeof createRoot>;
function Probe({ input = 'a' }: { input?: string }) { const result = useFoldOrderResolution(session, activeBase, input); useEffect(() => { seen = result; }); return null; }
beforeEach(() => {
  activeBase = base;
  releaseOrderSearch.mockReset();
  cancelSearch.mockReset();
  root = createRoot(document.createElement('div'));
  orderSelection.mockReset().mockResolvedValue({ status: 'ok', count: { orders: 2, exact: true }, index: 0, completion: witness });
});
afterEach(() => act(() => root.unmount()));
const render = async (input = 'a') => { await act(async () => root.render(<Probe input={input} />)); };

it('does not require a decision for an exactly unique order, but does for an incomplete single result', async () => {
  orderSelection.mockResolvedValueOnce({ status: 'ok', count: { orders: 1, exact: true }, index: 0, completion: null });
  await render();
  expect(seen.resolution?.required).toBe(false);
  orderSelection.mockResolvedValueOnce({ status: 'ok', count: { orders: 1, exact: false }, index: 0, completion: witness });
  await render('changed');
  expect(seen.resolution).toMatchObject({ active: false, required: true, count: 1, exact: false });
  expect(seen.step?.choices?.completion).toEqual(witness);
});

it('keeps an ambiguous preview visible while cycling, and ignores a late answer after inputs change', async () => {
  await render();
  await act(async () => seen.resolution?.resume());
  let finish!: (value: unknown) => void;
  orderSelection.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await act(async () => seen.resolution?.step(1));
  expect(seen.resolution).toMatchObject({ active: true, waiting: true });
  expect(seen.step?.choices?.completion).toEqual(witness);
  await render('new fold');
  await act(async () => finish({ status: 'ok', count: { orders: 9, exact: true }, index: 8, completion: null }));
  expect(seen.resolution).toMatchObject({ count: 2, index: 0, inputKey: 'new fold', waiting: false });
});

it('waits for confirmation, backs out with inputs intact, and stays in the tool after input changes', async () => {
  await render();
  expect(seen.resolution).toMatchObject({ required: true, active: false });
  await act(async () => seen.resolution?.step(1));
  expect(orderSelection).toHaveBeenCalledTimes(1);
  await act(async () => seen.resolution?.resume());
  expect(seen.resolution?.active).toBe(true);
  await act(async () => seen.resolution?.back());
  expect(seen.resolution).toMatchObject({ required: true, active: false });
  await render('different layers');
  expect(seen.resolution).toMatchObject({ required: true, active: false });
  await act(async () => seen.resolution?.resume());
  await render('another change');
  expect(seen.resolution?.active).toBe(false);
  await render('different layers');
  expect(seen.resolution?.active).toBe(false);
});

it('stops a pleat’s order search in the worker once its input changes, and asks no other fold’s with a ticket', async () => {
  activeBase = { op: { kind: 'pleat', line: { via: 'free', through: [[0.5, 0], [0.5, 1]] }, second: { via: 'free', through: [[0.75, 0], [0.75, 1]] }, moving: [0.9, 0.5], seed: { scope: 'all' } }, key: 'pleat' };
  // Still searching when the line moves.
  orderSelection.mockImplementationOnce(() => new Promise(() => {}));
  await render();
  const ticket: unknown = orderSelection.mock.lastCall?.[4];
  expect(ticket).toEqual({ id: expect.any(Number) });
  expect(seen.resolution?.waiting).toBe(true);
  expect(cancelSearch).not.toHaveBeenCalled();
  await render('moved line');
  expect(cancelSearch).toHaveBeenCalledWith(ticket);
  activeBase = base;
  await render('a squash');
  expect(orderSelection.mock.lastCall?.[4]).toBeUndefined();
});

it('offers a bounded retry for a search limit without calling the fold impossible', async () => {
  orderSelection.mockResolvedValueOnce({ status: 'refused', refusal: { code: 'budget_exceeded' }, fixes: [], faces: [], vertices: [] });
  await render();
  expect(seen.resolution).toMatchObject({ active: false, required: true, count: 0, exact: false, canSearch: true });
  expect(seen.refused).toBeNull();
  await act(async () => seen.resolution?.resume());
  await act(async () => seen.resolution?.search());
  expect(orderSelection.mock.lastCall?.[3]).toMatchObject({ perComponent: 4000, maxNodes: 800000 });
  expect(seen.resolution?.count).toBe(2);
});


it('cycles complete M/V recipes, preserves the selected index during extension, and releases invalidated searches', async () => {
  activeBase = { op: { kind: 'valley', line: { via: 'free', through: [[0, 0.8], [1, 0.8]] }, moving: [0.5, 0.9], seed: { scope: 'all' }, landing: { kind: 'outer' } }, key: 'valley' };
  orderSelection.mockResolvedValueOnce({ status: 'ok', count: { orders: 2, exact: false }, index: 0, landing: { kind: 'outer' }, completion: null });
  await render();
  expect(seen.resolution).toMatchObject({ required: true, active: false, exact: false });
  await act(async () => seen.resolution?.resume());
  orderSelection.mockResolvedValueOnce({ status: 'ok', count: { orders: 2, exact: false }, index: 1, landing: { kind: 'against', targets: [[0.2, 0.2]] }, completion: witness, moving_varies: true });
  await act(async () => seen.resolution?.step(1));
  expect(seen.step?.op).toMatchObject({ kind: 'valley', landing: { kind: 'against', targets: [[0.2, 0.2]] } });
  expect(seen.step?.choices?.completion).toEqual(witness);
  expect(seen.resolution?.movingVaries).toBe(true);
  orderSelection.mockResolvedValueOnce({ status: 'ok', count: { orders: 3, exact: true }, index: 1, landing: { kind: 'against', targets: [[0.2, 0.2]] }, completion: witness });
  await act(async () => seen.resolution?.resume());
  await act(async () => seen.resolution?.search());
  expect(orderSelection.mock.lastCall?.[3]).toMatchObject({ index: 1, batch: 1 });
  expect(seen.resolution).toMatchObject({ index: 1, count: 3, exact: true });
  await render('new line');
  expect(releaseOrderSearch).toHaveBeenCalledWith(1);
});

const placement: FoldToolStep = { op: { kind: 'mountain', line: { via: 'free', through: [[0, 0], [1, 1]] }, moving: [0.9, 0.1], seed: { scope: 'all' }, landing: { kind: 'outer' } }, key: 'mountain' };
const incomplete = { status: 'ok', count: { orders: 1, exact: false }, index: 0, landing: { kind: 'outer' }, completion: null };

it('searches a plain fold’s placements four times longer on each press, as a search the worker can stop', async () => {
  activeBase = placement;
  orderSelection.mockResolvedValue(incomplete);
  await render();
  expect(orderSelection.mock.lastCall?.[3]).toMatchObject({ batch: 0, searchMs: 150 });
  expect(orderSelection.mock.lastCall?.[4]).toEqual({ id: expect.any(Number) });
  await act(async () => seen.resolution?.resume());
  const asked: unknown[] = [];
  for (let press = 0; press < 5; press++) {
    expect(seen.resolution).toMatchObject({ exact: false, canSearch: true });
    await act(async () => seen.resolution?.search());
    asked.push(orderSelection.mock.lastCall?.[3]);
  }
  // Each press goes on from where the last stopped, so it always finds more time; one is capped at 64 times the first.
  expect(asked).toMatchObject([600, 2400, 9600, 9600, 9600].map((searchMs, i) => ({ batch: i + 1, searchMs })));
});

it('names a running press as searching, stops it keeping what it found, and says when there are no other orders', async () => {
  activeBase = placement;
  orderSelection.mockResolvedValueOnce(incomplete);
  await render();
  await act(async () => seen.resolution?.resume());
  expect(seen.resolution).toMatchObject({ searching: false, searched: false });
  // A press still running: what was found stays on screen.
  orderSelection.mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => seen.resolution?.search());
  const ticket: unknown = orderSelection.mock.lastCall?.[4];
  expect(seen.resolution).toMatchObject({ searching: true, waiting: true, count: 1, exact: false });
  // Stop cancels it in the worker and reads what the search holds, searching no further.
  orderSelection.mockResolvedValueOnce({ ...incomplete, count: { orders: 2, exact: false } });
  await act(async () => seen.resolution?.stop());
  expect(cancelSearch).toHaveBeenCalledWith(ticket);
  expect(orderSelection.mock.lastCall?.[3]).toMatchObject({ batch: 2, searchMs: 0 });
  expect(seen.resolution).toMatchObject({ searching: false, waiting: false, count: 2, exact: false, canSearch: true });
  // The next press searches longer than the stopped one, and this one finishes: no other orders.
  orderSelection.mockResolvedValueOnce({ ...incomplete, count: { orders: 3, exact: true } });
  await act(async () => seen.resolution?.search());
  expect(orderSelection.mock.lastCall?.[3]).toMatchObject({ batch: 3, searchMs: 2400 });
  expect(seen.resolution).toMatchObject({ searching: false, searched: true, count: 3, exact: true, canSearch: false });
});
