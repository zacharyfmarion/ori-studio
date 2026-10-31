import { afterEach, describe, expect, it, vi } from 'vitest';
import { settledTask } from './settledTask';
afterEach(() => vi.useRealTimers());
describe('settled view captures', () => {
  it('keeps only the newest value and flushes on leaving before the timer', async () => {
    vi.useFakeTimers();
    const write = vi.fn(async (_value: number) => {}),
      task = settledTask<number>(write);
    task.offer(1);
    task.offer(2);
    await task.flush();
    expect(write.mock.calls.map((call) => call[0])).toEqual([2]);
    await vi.runAllTimersAsync();
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('waits for the newest view to rest even when the previous capture finishes mid-gesture', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const first = new Promise<void>((r) => {
      release = r;
    });
    const seen: number[] = [];
    const task = settledTask<number>(async (value) => {
      seen.push(value);
      if (value === 1) await first;
    });
    task.offer(1);
    const done = task.flush();
    await Promise.resolve();
    task.offer(2);
    task.offer(3);
    release();
    await done;
    expect(seen).toEqual([1]);
    await vi.advanceTimersByTimeAsync(449);
    expect(seen).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual([1, 3]);
    await task.flush();
  });
  it('invalidates an edit waiting when history moves', async () => {
    let release!: () => void;
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const seen: number[] = [];
    const task = settledTask<number>(async (value, current) => {
      await wait;
      if (current()) seen.push(value);
    });
    task.offer(1);
    const done = task.flush();
    await Promise.resolve();
    task.cancel();
    release();
    await done;
    expect(seen).toEqual([]);
  });
  it('invalidates a running capture when a newer view is offered', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const committed: number[] = [];
    const task = settledTask<number>(async (value, current) => {
      if (value === 1) await gate;
      if (current()) committed.push(value);
    });
    task.offer(1);
    const done = task.flush();
    await Promise.resolve();
    task.offer(2);
    release();
    await done;
    await task.flush();
    expect(committed).toEqual([2]);
    task.cancel();
  });

});
