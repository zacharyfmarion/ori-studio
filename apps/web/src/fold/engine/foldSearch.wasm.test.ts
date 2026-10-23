/**
 * The Pleat and Repeat searches as the worker runs them (`foldSearch.ts`),
 * over the real engine: paused between engine calls holding the states they
 * landed, then cancelled or out of time — and every state let go either way.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FoldOp, FoldPleatOp } from '../document/foldSequenceDocument';
import { prepareRepeat, prepareRepeatSearch, REPEAT_PREPARATION_MS, type RepeatRequest } from '../repeat/repeatPreparation';
import { PLEAT_SEARCH_MS, pleatSearchBudget } from '../tools/pleat/pleatEngine';
import { createFoldEngineCalls } from './foldEngineCalls';
import { createFoldEngineCompoundCalls } from './foldEngineCompoundCalls';
import { createFoldSearchRunner, FOLD_SEARCH_CANCELLED, foldSearchTicket, type FoldSearchRunner } from './foldSearch';

async function engine() {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(resolve(process.cwd(), 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm')) });
  const raw = new wasm.FoldEngine();
  return { ...createFoldEngineCalls(raw), ...createFoldEngineCompoundCalls(raw) };
}
type Engine = Awaited<ReturnType<typeof engine>>;

/** A runner on a clock the test moves, which pauses at every slice until the test lets it go on. */
function pausing() {
  let now = 0;
  let resume: (() => void) | null = null;
  const runner = createFoldSearchRunner({
    clock: { now: () => now },
    sliceMs: 0,
    yieldTask: () => new Promise<void>((done) => (resume = done)),
  });
  const tick = () => new Promise((done) => setTimeout(done, 0));
  return {
    runner,
    advance: (ms: number) => (now += ms),
    /** Let the search go on to its next slice. */
    async next() {
      const go = resume;
      resume = null;
      go?.();
      await tick();
      return resume !== null;
    },
    paused: () => resume !== null,
  };
}

/** Step the search from slice to slice until it holds a state it landed: the middle of the search. */
async function untilHolding(e: Engine, search: ReturnType<typeof pausing>, before: number) {
  await new Promise((done) => setTimeout(done, 0));
  for (let slices = 0; slices < 50; slices++) {
    if (search.paused() && e.live() > before) return;
    if (!(await search.next())) break;
  }
  throw new Error('the search finished before it held a state');
}

const pleat: FoldPleatOp = {
  kind: 'pleat',
  line: { via: 'free', through: [[0.5, 0], [0.5, 1]] },
  second: { via: 'free', through: [[0.75, 0], [0.75, 1]] },
  moving: [0.9, 0.5],
  seed: { scope: 'all' },
};

function pleatSearch(e: Engine, runner: FoldSearchRunner, state: number, ticket = foldSearchTicket()) {
  const { search, budgetMs } = e.pleatOrderSearch(state, pleat, undefined, { index: 0 });
  return { running: runner.run(search, budgetMs, ticket), ticket };
}

/** A precrease then a corner fold on the right half: the range Repeat mirrors across x = 1/2. */
function repeatable(e: Engine): RepeatRequest {
  const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
  if (sheet.status !== 'ok') throw new Error('sheet');
  const ops: FoldOp[] = [
    { kind: 'precrease', direction: 'valley', line: { via: 'free', through: [[0.75, 0], [0.75, 1]] }, moving: [0.9, 0.5], seed: { scope: 'all' } },
    { kind: 'valley', line: { via: 'free', through: [[0.6, 1], [1, 0.6]] }, moving: [0.95, 0.95], seed: { scope: 'all' } },
  ];
  let current = sheet.state;
  const steps = ops.map((op, i) => {
    const landed = e.step(current, op);
    if (landed.status !== 'ok') throw new Error(JSON.stringify(landed));
    const step = { id: `s${i}`, before: current, after: landed.state, op };
    current = landed.state;
    return step;
  });
  return { parent: current, axis: { n: [1, 0], d: 0.5 }, steps, source: { first: 's0', last: 's1', revision: 'test' } };
}

describe('Pleat order search in slices', () => {
  it('answers a small pleat exactly as the synchronous call does', async () => {
    const e = await engine();
    const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
    if (sheet.status !== 'ok') throw new Error('sheet');
    const live = e.live();
    const sync = e.orderSelection(sheet.state, pleat, undefined, { index: 0 });
    const sliced = await pleatSearch(e, createFoldSearchRunner(), sheet.state).running;
    expect(sync).toMatchObject({ status: 'ok', count: { orders: 1, exact: true } });
    expect(sliced).toEqual(sync);
    expect(e.live()).toBe(live);
  });

  it('stops at its next slice when cancelled, letting go of the leg it had landed', async () => {
    const e = await engine();
    const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
    if (sheet.status !== 'ok') throw new Error('sheet');
    const live = e.live();
    const search = pausing();
    const { running, ticket } = pleatSearch(e, search.runner, sheet.state);
    const ended = running.catch((error: unknown) => error);
    await untilHolding(e, search, live);
    search.runner.cancel(ticket.id);
    await search.next();
    expect(await ended).toMatchObject({ code: FOLD_SEARCH_CANCELLED });
    expect(e.live()).toBe(live);
  });

  it('runs out of time with the engine’s own budget refusal, letting go of the leg it had landed', async () => {
    const e = await engine();
    const sheet = e.sheet({ shape: { kind: 'square' }, startSide: 'front' });
    if (sheet.status !== 'ok') throw new Error('sheet');
    const live = e.live();
    const search = pausing();
    const { running } = pleatSearch(e, search.runner, sheet.state);
    await untilHolding(e, search, live);
    search.advance(PLEAT_SEARCH_MS);
    await search.next();
    await expect(running).resolves.toMatchObject({
      status: 'refused',
      refusal: { code: 'budget_exceeded', limit: 'deadline' },
    });
    expect(e.live()).toBe(live);
  });

  it('gets four times as long for each search for more orders', () => {
    expect(pleatSearchBudget({ index: 0 })).toBe(PLEAT_SEARCH_MS);
    expect(pleatSearchBudget({ index: 0, maxNodes: 800_000 })).toBe(4 * PLEAT_SEARCH_MS);
    expect(pleatSearchBudget({ index: 0, maxNodes: 12_800_000 })).toBe(64 * PLEAT_SEARCH_MS);
  });
});

describe('Repeat preparation in slices', () => {
  it('prepares a small range exactly as the synchronous call does', async () => {
    const e = await engine();
    const request = repeatable(e);
    const live = e.live();
    const sync = prepareRepeat(e, request);
    const sliced = await createFoldSearchRunner().run(prepareRepeatSearch(e, request), REPEAT_PREPARATION_MS, foldSearchTicket());
    expect(sync.status).toBe('ready');
    expect(sliced).toEqual(sync);
    expect(e.live()).toBe(live);
  });

  it('stops at its next slice when cancelled, letting go of every trial state', async () => {
    const e = await engine();
    const request = repeatable(e);
    const live = e.live();
    const search = pausing();
    const ticket = foldSearchTicket();
    const ended = search.runner.run(prepareRepeatSearch(e, request), REPEAT_PREPARATION_MS, ticket).catch((error: unknown) => error);
    await untilHolding(e, search, live);
    search.runner.cancel(ticket.id);
    await search.next();
    expect(await ended).toMatchObject({ code: FOLD_SEARCH_CANCELLED });
    expect(e.live()).toBe(live);
  });

  it('runs out of time as a range too long to repeat, at the operation it had reached, letting go of every trial state', async () => {
    const e = await engine();
    const request = repeatable(e);
    const live = e.live();
    const search = pausing();
    const running = search.runner.run(prepareRepeatSearch(e, request), REPEAT_PREPARATION_MS, foldSearchTicket());
    await untilHolding(e, search, live);
    search.advance(REPEAT_PREPARATION_MS);
    await search.next();
    const prepared = await running;
    expect(prepared).toMatchObject({ status: 'blocked', code: 'repeat_limit', step: 1 });
    // What was prepared before the time ran out is shown, as for any block.
    expect(prepared.status === 'blocked' && prepared.prefix?.steps).toHaveLength(1);
    expect(e.live()).toBe(live);
  });
});
