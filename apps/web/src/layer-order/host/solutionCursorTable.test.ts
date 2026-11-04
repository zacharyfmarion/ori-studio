import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAKE_LAYER_ORDER_SOURCE } from '../engine/layerOrderEngine.fixtures';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import { useLayerOrderDialogStore } from '../dialog/layerOrderDialogStore';
import {
  createSolutionCursorTable,
  SOLUTION_CURSOR_IDLE_MS,
  solutionPlaceEnds,
  solutionPressOf,
  solutionsHeldForReview,
  type SolutionCursorOpening,
} from './solutionCursorTable';
import { scriptedSolutionCursor, solutionPosition } from './solutionCursorTable.fixtures';

/**
 * The hosts' one solutions-cursor table on its own (rows H6, H9): what every
 * host's binding shares. Edit's rules through it are
 * `foldedSolutionCursor.test.ts`; the Diagram's, `stepSolutionSteps.test.ts`.
 */
const gateway = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('./hostEngineGateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./hostEngineGateway')>()),
  openLayerOrderSolutionCursor: (...args: unknown[]) => gateway.open(...args),
}));

const RECORD: LayerOrderRecord = { faces: [], constraints: [], order: [] };

/** A toy host: a thing is its id and the order it holds; the world, a number that must not change. */
interface Thing {
  id: string;
  holds: string;
}
function toyTable() {
  return createSolutionCursorTable<Thing, number, { holds: string; world: number }, SolutionCursorOpening>({
    idOf: (thing) => thing.id,
    markOf: (thing, world) => ({ holds: thing.holds, world }),
    inStep: (mark, thing) => mark.holds === thing.holds,
    heldIn: (mark, _thing, world) => mark.world === world,
    stepBy: () => ({ picture: 'front' }),
  });
}

const tables = [toyTable(), toyTable()] as const;
afterEach(() => {
  for (const table of tables) table.drop();
  gateway.open.mockReset();
});

const END = { outcome: 'end', position: solutionPosition(1, 3, false), counted: true } as const;
/** The ends a step proved: › only, ‹ only, both. */
const NEXT = { previous: false, next: true } as const;
const PREVIOUS = { previous: true, next: false } as const;
const BOTH = { previous: true, next: true } as const;
const ask = { direction: 'next', open: async () => ({ source: FAKE_LAYER_ORDER_SOURCE, record: RECORD }) } as const;

async function seat(table: (typeof tables)[number], thing: Thing) {
  const cursor = scriptedSolutionCursor([END]);
  gateway.open.mockReturnValueOnce(cursor);
  const turn = table.begin(thing, 0);
  await turn.step(ask);
  turn.end((id) => (id === thing.id ? thing : undefined), 0);
  return cursor;
}

describe('the hosts’ solutions-cursor table', () => {
  it('keeps one cursor in the whole app: making one in a host lets every other host’s go', async () => {
    const [edit, diagram] = tables;
    const first = await seat(edit, { id: 'figure', holds: 'a' });
    expect(edit.heldId()).toBe('figure');
    const second = await seat(diagram, { id: 'step', holds: 'b' });
    expect(first.closed).toBe(true);
    expect(edit.heldId()).toBeNull();
    expect(diagram.heldId()).toBe('step');
    expect(second.closed).toBe(false);
  });

  it('drops only the thing named, when one is', async () => {
    const [table] = tables;
    const cursor = await seat(table, { id: 'step', holds: 'a' });
    table.drop('another');
    expect(cursor.closed).toBe(false);
    table.drop('step');
    expect(cursor.closed).toBe(true);
  });

  it('lets the cursor go once its thing holds something else, is gone, or its world changed', async () => {
    const [table] = tables;
    for (const [thing, world] of [
      [{ id: 'step', holds: 'b' }, 0],
      [undefined, 0],
      [{ id: 'step', holds: 'a' }, 1],
    ] as const) {
      const cursor = await seat(table, { id: 'step', holds: 'a' });
      table.settle(() => thing, world);
      expect(cursor.closed).toBe(true);
    }
    // And keeps it while it holds what the cursor shows.
    const kept = await seat(table, { id: 'step', holds: 'a' });
    table.settle(() => ({ id: 'step', holds: 'a' }), 0);
    expect(kept.closed).toBe(false);
  });

  it('lets it go when the selection moves off its thing, and keeps it while its thing is the one selected', async () => {
    const [table] = tables;
    const thing = { id: 'step', holds: 'a' };
    const cursor = await seat(table, thing);
    table.settle(() => thing, 0, 'step');
    expect(cursor.closed).toBe(false);
    table.settle(() => thing, 0, 'another');
    expect(cursor.closed).toBe(true);
  });

  it('lets it go when a Layer order dialog opens, and as its host says (the workspace switching)', async () => {
    let hostDrop: (() => void) | null = null;
    const unwatched = vi.fn();
    const watched = createSolutionCursorTable<Thing, number, { holds: string }, SolutionCursorOpening>({
      idOf: (thing) => thing.id,
      markOf: (thing) => ({ holds: thing.holds }),
      inStep: (mark, thing) => mark.holds === thing.holds,
      heldIn: () => true,
      stepBy: () => ({ picture: 'front' }),
      whileKept: (drop) => {
        hostDrop = drop;
        return unwatched;
      },
    });
    try {
      const thing = { id: 'step', holds: 'a' };
      const viaHost = await seat(watched as never, thing);
      hostDrop!();
      expect(viaHost.closed).toBe(true);
      expect(unwatched).toHaveBeenCalledOnce();
      const viaDialog = await seat(watched as never, thing);
      useLayerOrderDialogStore.setState({ opening: { id: 99 } as never });
      expect(viaDialog.closed).toBe(true);
    } finally {
      useLayerOrderDialogStore.setState({ opening: null });
      watched.drop();
    }
  });

  it('lets its worker go after a minute with no press, keeping the readout, and keeps it through presses', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const [table] = tables;
      const thing = { id: 'step', holds: 'a' };
      const cursor = scriptedSolutionCursor([END, END]);
      gateway.open.mockReturnValueOnce(cursor);
      const press = async () => {
        const turn = table.begin(thing, 0);
        await turn.step(ask);
        turn.end(() => thing, 0);
      };
      await press();
      vi.advanceTimersByTime(SOLUTION_CURSOR_IDLE_MS - 1000);
      await press();
      vi.advanceTimersByTime(SOLUTION_CURSOR_IDLE_MS - 1000);
      expect(cursor.closed).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(cursor.closed).toBe(true);
      expect(table.heldId()).toBeNull();
      // Where its order lay stays for the readout, with the end it proved, while the thing holds what it did.
      expect(table.place(thing)).toEqual({ position: END.position, counted: true, ended: NEXT });
      table.settle(() => thing, 0, 'step');
      expect(table.place(thing)).not.toBeNull();
      // And goes on the cursor's terms: here, the thing holding another order.
      table.settle(() => ({ id: 'step', holds: 'b' }), 0);
      expect(table.place(thing)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('seeds the next press’s cursor with where a rested one left the thing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const [table] = tables;
      const thing = { id: 'step', holds: 'a' };
      await seat(table, thing);
      vi.advanceTimersByTime(SOLUTION_CURSOR_IDLE_MS);
      expect(table.heldId()).toBeNull();
      // A press that has not answered yet still reads where the thing was.
      let answer: (step: typeof END) => void = () => {};
      gateway.open.mockReturnValueOnce(scriptedSolutionCursor([() => new Promise((resolve) => (answer = resolve as never))]));
      const turn = table.begin(thing, 0);
      const stepped = turn.step(ask);
      await vi.waitFor(() => expect(table.heldId()).toBe('step'));
      expect(table.place(thing)).toEqual({ position: END.position, counted: true, ended: NEXT });
      answer(END);
      await stepped;
      turn.end(() => thing, 0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks the way a step proved to end, so that way’s verb waits there whatever the count says (E9)', async () => {
    const [table] = tables;
    const thing = { id: 'step', holds: 'a' };
    gateway.open.mockReturnValueOnce(
      scriptedSolutionCursor([{ outcome: 'end', position: solutionPosition(2, 5, false), counted: true }])
    );
    const turn = table.begin(thing, 0);
    await turn.step({ ...ask, direction: 'previous' });
    turn.end(() => thing, 0);
    const place = table.place(thing)!;
    expect(place.ended).toEqual(PREVIOUS);
    expect(solutionPlaceEnds(place)).toEqual({ first: true, last: false, only: false });
  });

  it('keeps both ends a step proved from the same place, whichever came first; a step that runs out keeps them', async () => {
    const [table] = tables;
    const thing = { id: 'step', holds: 'a' };
    const at = solutionPosition(1, 1, false);
    gateway.open.mockReturnValueOnce(
      scriptedSolutionCursor([
        { outcome: 'end', position: at, counted: true },
        { outcome: 'timed_out', stage: 'step' },
        { outcome: 'end', position: at, counted: true },
      ])
    );
    const press = async (direction: 'next' | 'previous') => {
      const turn = table.begin(thing, 0);
      await turn.step({ ...ask, direction });
      turn.end(() => thing, 0);
    };
    await press('previous');
    // A › that ran out proves nothing, and takes nothing back: ‹ still waits.
    await press('next');
    expect(table.place(thing)?.ended).toEqual(PREVIOUS);
    expect(solutionPlaceEnds(table.place(thing)!)).toMatchObject({ first: true, last: false });
    // A › that ends, from the same place: both wait, never one in place of the other.
    await press('next');
    expect(table.place(thing)?.ended).toEqual(BOTH);
    expect(solutionPlaceEnds(table.place(thing)!)).toEqual({ first: true, last: true, only: true });
  });

  it('keeps a proved end when the next end reads the same order at another index, the count gone on', async () => {
    const [table] = tables;
    const thing = { id: 'step', holds: 'a' };
    gateway.open.mockReturnValueOnce(
      scriptedSolutionCursor([
        { outcome: 'end', position: solutionPosition(5, 5, false), counted: true },
        { outcome: 'end', position: solutionPosition(8, 8, false), counted: true },
      ])
    );
    for (const direction of ['next', 'previous'] as const) {
      const turn = table.begin(thing, 0);
      await turn.step({ ...ask, direction });
      turn.end(() => thing, 0);
    }
    expect(table.place(thing)).toEqual({ position: solutionPosition(8, 8, false), counted: true, ended: BOTH });
    expect(solutionPlaceEnds(table.place(thing)!)).toMatchObject({ first: true, last: true });
  });

  it('lets proved ends go when a step lands elsewhere', async () => {
    const [table] = tables;
    const thing = { id: 'step', holds: 'a' };
    gateway.open.mockReturnValueOnce(
      scriptedSolutionCursor([
        { outcome: 'end', position: solutionPosition(2, 3, false), counted: true },
        {
          outcome: 'moved',
          applied: { record: RECORD, relations: new Uint32Array(), source: FAKE_LAYER_ORDER_SOURCE },
          position: solutionPosition(3, 3, false),
          counted: true,
        },
      ])
    );
    const first = table.begin(thing, 0);
    await first.step({ ...ask, direction: 'previous' });
    first.end(() => thing, 0);
    expect(table.place(thing)?.ended).toEqual(PREVIOUS);
    const second = table.begin(thing, 0);
    await second.step(ask);
    second.landed((mark) => ({ ...mark, holds: 'b' }));
    const moved = { id: 'step', holds: 'b' };
    second.end(() => moved, 0);
    expect(table.place(moved)).toEqual({ position: solutionPosition(3, 3, false), counted: true });
  });

  it('keeps the readout of the side shown when its thing turns over and straight back', async () => {
    const answers: ((place: { position: ReturnType<typeof solutionPosition>; counted: boolean } | null) => void)[] = [];
    const sided = createSolutionCursorTable<Thing & { side: 'front' | 'back' }, number, null, SolutionCursorOpening>({
      idOf: (thing) => thing.id,
      markOf: () => null,
      inStep: () => true,
      heldIn: () => true,
      stepBy: (thing) => ({ picture: thing.side }),
    });
    gateway.open.mockReturnValueOnce({
      step: async () => END,
      place: () => new Promise((resolve) => answers.push(resolve)),
      alive: () => true,
      close: () => {},
    });
    try {
      const front = { id: 'step', holds: 'a', side: 'front' } as const;
      const turn = sided.begin(front, 0);
      await turn.step(ask);
      turn.end(() => front, 0);
      sided.settle(() => ({ ...front, side: 'back' }), 0);
      expect(answers).toHaveLength(1);
      sided.settle(() => front, 0);
      answers[0]!({ position: solutionPosition(1, 1), counted: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sided.place(front)).toEqual({ position: END.position, counted: true, ended: NEXT });
    } finally {
      sided.drop();
    }
  });

  it('asks a step with the user’s tries, and keeps the cursor when it ran out of time, for Keep trying', async () => {
    const [table] = tables;
    const thing = { id: 'step', holds: 'a' };
    const cursor = scriptedSolutionCursor([{ outcome: 'timed_out', stage: 'step' }, END]);
    gateway.open.mockReturnValueOnce(cursor);
    const first = table.begin(thing, 0);
    expect((await first.step(ask)).outcome).toBe('timed_out');
    first.end(() => thing, 0);
    expect(cursor.closed).toBe(false);
    const again = table.begin(thing, 0);
    await again.step({ ...ask, tries: 1 });
    again.end(() => thing, 0);
    expect(cursor.triesAsked).toEqual([0, 1]);
    expect(gateway.open).toHaveBeenCalledOnce();
  });

  it('lets the cursor go when the press was given up on before its step moved (the host’s engine lost under it)', async () => {
    const [table] = tables;
    let answer: (step: { outcome: 'moved' } & Record<string, unknown>) => void = () => {};
    const cursor = scriptedSolutionCursor([() => new Promise((resolve) => (answer = resolve as never))]);
    gateway.open.mockReturnValueOnce(cursor);
    const thing = { id: 'step', holds: 'a' };
    const turn = table.begin(thing, 0);
    const stepped = turn.step(ask);
    await vi.waitFor(() => expect(cursor.asked).toHaveLength(1));
    // The host's capture ended first: nothing will land.
    turn.end(() => thing, 0);
    expect(cursor.closed).toBe(false);
    answer({
      outcome: 'moved',
      applied: { record: RECORD, relations: new Uint32Array(), source: FAKE_LAYER_ORDER_SOURCE },
      position: solutionPosition(2, 3),
      counted: true,
    });
    await stepped;
    expect(cursor.closed).toBe(true);
    expect(table.heldId()).toBeNull();
  });

  it('keeps what the host marked of the thing, and what each landing changed', async () => {
    const [table] = tables;
    gateway.open.mockReturnValueOnce(
      scriptedSolutionCursor([
        { outcome: 'moved', applied: { record: RECORD, relations: new Uint32Array(), source: FAKE_LAYER_ORDER_SOURCE }, position: solutionPosition(2, 3), counted: true },
      ])
    );
    const turn = table.begin({ id: 'step', holds: 'a' }, 0);
    expect(turn.mark()).toBeNull();
    await turn.step(ask);
    expect(turn.mark()).toEqual({ holds: 'a', world: 0 });
    turn.landed((mark) => ({ ...mark, holds: 'b' }));
    turn.end(() => ({ id: 'step', holds: 'b' }), 0);
    expect(table.place({ id: 'step', holds: 'b' })).toEqual({ position: solutionPosition(2, 3), counted: true });
    expect(table.place({ id: 'step', holds: 'a' })).toBeNull();
  });
});

describe('what every host’s pager and press read', () => {
  it('waits at the ends of a fixed order once the count is final: ‹ on the first, › on the last', () => {
    const at = (index: number, n: number, exact: boolean) => solutionPlaceEnds({ position: solutionPosition(index, n, exact), counted: true });
    expect(at(1, 3, true)).toEqual({ first: true, last: false, only: false });
    expect(at(2, 3, true)).toEqual({ first: false, last: false, only: false });
    expect(at(3, 3, true)).toEqual({ first: false, last: true, only: false });
    expect(at(1, 1, true)).toEqual({ first: true, last: true, only: true });
  });

  it('keeps ‹ at 1 until the count is final: the index counts the solutions found, not their rank (E9)', () => {
    const at = (index: number, n: number) => solutionPlaceEnds({ position: solutionPosition(index, n, false), counted: true });
    expect(at(1, 3)).toEqual({ first: false, last: false, only: false });
    expect(at(1, 1)).toEqual({ first: false, last: false, only: false });
    expect(at(3, 3)).toEqual({ first: false, last: false, only: false });
  });

  it('waits at each way a step proved to end, whatever the count says (E9)', () => {
    const at = (index: number, n: number, ended: { previous: boolean; next: boolean }) =>
      solutionPlaceEnds({ position: solutionPosition(index, n, false), counted: true, ended });
    expect(at(3, 3, NEXT)).toEqual({ first: false, last: true, only: false });
    expect(at(2, 3, PREVIOUS)).toEqual({ first: true, last: false, only: false });
    expect(at(1, 3, PREVIOUS)).toEqual({ first: true, last: false, only: false });
    // Proved past the first found, with the count unfinished: one listed before it may yet be found.
    expect(at(1, 1, NEXT)).toEqual({ first: false, last: true, only: false });
    // Both ways proved: the one there is, the count unfinished.
    expect(at(1, 1, BOTH)).toEqual({ first: true, last: true, only: true });
    // Once final, the one there is.
    expect(solutionPlaceEnds({ position: solutionPosition(1, 1, true), counted: true, ended: NEXT })).toEqual({
      first: true,
      last: true,
      only: true,
    });
  });

  it('holds ‹ › while a record needs any review since an edit (D14)', () => {
    expect(solutionsHeldForReview(null)).toBe(false);
    expect(solutionsHeldForReview(undefined)).toBe(false);
    expect(solutionsHeldForReview({ reason: 'conflict', count: 2 })).toBe(true);
    expect(solutionsHeldForReview({ reason: 'timeout', count: 0 })).toBe(true);
  });

  it('says what a press that moved nothing came to: an end is proved, however far the count got', () => {
    expect(solutionPressOf({ outcome: 'end', position: solutionPosition(3, 3, false), counted: true })).toEqual({ status: 'end' });
    expect(solutionPressOf({ outcome: 'timed_out', stage: 'restore' })).toEqual({ status: 'timed_out', stage: 'restore' });
    expect(solutionPressOf({ outcome: 'timed_out', stage: 'step' })).toEqual({ status: 'timed_out', stage: 'step' });
    expect(solutionPressOf({ outcome: 'unrestored', why: 'clash' })).toEqual({ status: 'unrestored', why: 'clash' });
    expect(solutionPressOf({ outcome: 'too_large' })).toEqual({ status: 'too-large' });
    expect(solutionPressOf({ outcome: 'lost', cause: 'load' })).toEqual({ status: 'lost', cause: 'load' });
    expect(solutionPressOf({ outcome: 'cancelled' })).toEqual({ status: 'stopped' });
  });
});
