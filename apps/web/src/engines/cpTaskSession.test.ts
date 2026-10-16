import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCpTaskSession } from './cpTaskSession';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('../platform/runtime', () => ({ isDesktopRuntime: () => true }));
vi.mock('../engine/oristudioCpNativeClient', () => ({ createOristudioCpNativeClient: () => ({}) }));
beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(17);
});
afterEach(() => vi.useRealTimers());

it('cancels and disposes only its own native session, once', async () => {
  const session = await createCpTaskSession();
  const controller = new AbortController();
  const work = session.run(() => new Promise<void>(() => undefined), controller.signal);
  controller.abort();
  await expect(work).rejects.toMatchObject({ name: 'AbortError' });
  await session.close();
  expect(invoke.mock.calls).toEqual([
    ['cp_create_session'],
    ['cp_fold_cancel', { sessionId: 17, runId: 1 }],
    ['cp_close_session', { sessionId: 17 }],
  ]);
  await expect(session.run(async () => 1, new AbortController().signal)).rejects.toThrow();
});

it('disposes a timed out solve without waiting for the solver to return', async () => {
  vi.useFakeTimers();
  const session = await createCpTaskSession();
  const work = session.run(() => new Promise<void>(() => undefined), new AbortController().signal, 100);
  const rejected = expect(work).rejects.toThrow('time limit');
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  expect(invoke).toHaveBeenCalledWith('cp_close_session', { sessionId: 17 });
});

it('reuses its engine for completed work and does not create an already cancelled session', async () => {
  const session = await createCpTaskSession();
  expect(await session.run(async () => 42, new AbortController().signal)).toBe(42);
  expect(await session.run(async () => 43, new AbortController().signal)).toBe(43);
  expect(invoke).toHaveBeenCalledTimes(1);
  await session.close();
  invoke.mockClear();
  await expect(createCpTaskSession(AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
  expect(invoke).not.toHaveBeenCalled();
});
