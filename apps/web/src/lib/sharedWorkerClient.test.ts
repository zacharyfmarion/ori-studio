import { afterEach, expect, it, vi } from 'vitest';
import { createSharedWorkerClient } from './sharedWorkerClient';
vi.mock('comlink', () => ({ wrap: () => ({}) }));
afterEach(() => vi.useRealTimers());

it('rejects a closed session and disposes its late transferable result', async () => {
  const terminate = vi.fn();
  const runtime = createSharedWorkerClient(() => ({ terminate, addEventListener: vi.fn() }) as unknown as Worker);
  runtime.retain();
  let done!: (value: { close: () => void }) => void;
  const answer = new Promise<{ close: () => void }>((resolve) => {
    done = resolve;
  });
  const frame = { close: vi.fn() };
  const task = runtime.call(
    () => answer,
    1000,
    (value) => value.close()
  );
  const rejected = expect(task).rejects.toThrow('closed');
  runtime.release();
  await rejected;
  done(frame);
  await Promise.resolve();
  await Promise.resolve();
  expect(frame.close).toHaveBeenCalledOnce();
  expect(terminate).toHaveBeenCalledOnce();
});

it('keeps the worker alive for another consumer and bounds an unanswered request', async () => {
  vi.useFakeTimers();
  const terminate = vi.fn();
  const runtime = createSharedWorkerClient(() => ({ terminate, addEventListener: vi.fn() }) as unknown as Worker);
  runtime.retain();
  runtime.retain();
  runtime.release();
  expect(terminate).not.toHaveBeenCalled();
  const task = runtime.call(() => new Promise(() => {}), 50);
  const rejected = expect(task).rejects.toThrow('in time');
  await vi.advanceTimersByTimeAsync(50);
  await rejected;
  runtime.release();
  expect(terminate).toHaveBeenCalledOnce();
});

it('reuses an idle static worker during navigation, then frees it after the grace period', async () => {
  vi.useFakeTimers();
  const terminate = vi.fn();
  const create = vi.fn(() => ({ terminate, addEventListener: vi.fn() }) as unknown as Worker);
  const runtime = createSharedWorkerClient(create, 30_000);
  const first = runtime.retain();
  runtime.release();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(terminate).not.toHaveBeenCalled();
  expect(runtime.retain()).toBe(first);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(terminate).not.toHaveBeenCalled();
  runtime.release();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(terminate).toHaveBeenCalledOnce();
  expect(runtime.peek()).toBeNull();
  runtime.retain();
  expect(create).toHaveBeenCalledTimes(2);
  runtime.release();
  await vi.advanceTimersByTimeAsync(30_000);
});
