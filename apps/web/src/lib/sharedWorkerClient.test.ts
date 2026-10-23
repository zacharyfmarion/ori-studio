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
