import { expect, it, vi } from 'vitest';
import { foldSearchTicket } from '../engine/foldSearch';
import { axisState, axisStateView, createRepeatPreparedStore } from './repeatPrepared';
import type { RepeatPrepared } from './repeatPreparation';

const blocked: RepeatPrepared = { status: 'blocked', step: 0, code: 'repeat_creases' };

it('keeps what each axis prepared says of it, joins one running, and lets a stopped one go at once', async () => {
  const store = createRepeatPreparedStore();
  const settled = vi.fn();
  let answer!: (prepared: RepeatPrepared | null | undefined) => void;
  const first = store.start('range|a', foldSearchTicket(), () => new Promise((done) => (answer = done)), settled);
  expect(store.busy()).toBe(true);
  expect(store.running('range|a')).toBe(first);
  expect(axisState(store, 'range|a')).toEqual({ kind: 'unknown' });
  answer(blocked);
  await first.answer;
  expect(settled).toHaveBeenCalledOnce();
  expect(store.busy()).toBe(false);
  expect(axisStateView(axisState(store, 'range|a'))).toEqual({ kind: 'refused', stop: { code: 'repeat_creases' }, step: 0 });

  // Stopped: let go at once, so one asked again starts afresh; the stopped one settling later takes nothing with it.
  const stop = vi.fn();
  let late!: (prepared: RepeatPrepared | null) => void;
  const stopped = store.start('range|b', foldSearchTicket(), () => new Promise((done) => (late = done)), () => {});
  store.stopOthers(() => false, stop);
  expect(stop).toHaveBeenCalledWith(stopped.ticket);
  expect(store.running('range|b')).toBeUndefined();
  const again = store.start('range|b', foldSearchTicket(), () => new Promise(() => {}), () => {});
  late(null);
  await stopped.answer;
  expect(store.running('range|b')).toBe(again);
  expect(axisState(store, 'range|b')).toEqual({ kind: 'unknown' });

  // The worker failing is not the repeat refused: neither kept nor asked again of itself.
  const failing = store.start('range|c', foldSearchTicket(), async () => undefined, () => {});
  await failing.answer;
  expect(store.failed('range|c')).toBe(true);
  expect(axisState(store, 'range|c')).toEqual({ kind: 'unknown' });
});
