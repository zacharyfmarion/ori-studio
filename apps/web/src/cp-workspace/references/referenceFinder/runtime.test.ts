/**
 * The runtime's lifetimes, against a fake Worker. comlink's proxy never answers
 * a fake, which is exactly the hang each of these guards against: the runtime
 * must turn a dead or silent worker into a rejection on its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DATABASE_SETTINGS, DEFAULT_QUERY_SETTINGS } from './protocol';

async function freshRuntime() {
  vi.resetModules();
  return import('../../../store/workspaceStore/referenceFinderRuntime');
}

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  terminated = false;
  constructor() {
    super();
    FakeWorker.instances.push(this);
  }
  terminate() {
    this.terminated = true;
  }
  postMessage() {}
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const other = { ...DEFAULT_DATABASE_SETTINGS, maxRank: 5 };
const third = { ...DEFAULT_DATABASE_SETTINGS, maxRank: 4 };

describe('reference-finder client registry', () => {
  it('memoizes one client per instance and database key', async () => {
    const runtime = await freshRuntime();
    const a = runtime.getReferenceFinderClient('window');
    const b = runtime.getReferenceFinderClient('window');
    expect(b).toBe(a);
    expect(FakeWorker.instances).toHaveLength(1);
    runtime.getReferenceFinderClient('window', other);
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it('never shares a worker between the window and planner instances', async () => {
    const runtime = await freshRuntime();
    const window = runtime.getReferenceFinderClient('window');
    const planner = runtime.getReferenceFinderClient('planner');
    expect(planner).not.toBe(window);
    expect(planner.key).toBe(window.key);
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it('keeps at most two databases per instance, evicting the least recently used idle one', async () => {
    const runtime = await freshRuntime();
    const first = runtime.getReferenceFinderClient('window');
    vi.advanceTimersByTime(10);
    runtime.getReferenceFinderClient('window', other);
    vi.advanceTimersByTime(10);
    // Touch the first so the second is least recently used.
    runtime.getReferenceFinderClient('window');
    vi.advanceTimersByTime(10);
    const lost = vi.fn();
    runtime.onReferenceFinderClientLost(lost);
    runtime.getReferenceFinderClient('window', third);

    expect(runtime.referenceFinderClientKeys('window')).toEqual([first.key, expect.any(String)]);
    expect(runtime.referenceFinderClientKeys('window')).toHaveLength(2);
    expect(FakeWorker.instances[1].terminated).toBe(true);
    expect(lost).toHaveBeenCalledWith(
      expect.objectContaining({ instance: 'window', reason: 'evicted' })
    );
  });

  it('tears an idle client down after 60 s and spawns afresh on the next call', async () => {
    const runtime = await freshRuntime();
    runtime.getReferenceFinderClient('window');
    vi.advanceTimersByTime(runtime.REFERENCE_FINDER_IDLE_TEARDOWN_MS - 1);
    expect(runtime.isReferenceFinderClientConnected('window')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(runtime.isReferenceFinderClientConnected('window')).toBe(false);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    runtime.getReferenceFinderClient('window');
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it('a call refreshes the idle timer', async () => {
    const runtime = await freshRuntime();
    const client = runtime.getReferenceFinderClient('window');
    await vi.advanceTimersByTimeAsync(runtime.REFERENCE_FINDER_IDLE_TEARDOWN_MS - 1000);
    const pending = client.solvePoint(0.5, 0.5, DEFAULT_QUERY_SETTINGS).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2000);
    // Still connected: the call is in flight, not idle.
    expect(runtime.isReferenceFinderClientConnected('window')).toBe(true);
    await vi.advanceTimersByTimeAsync(runtime.REFERENCE_FINDER_QUERY_TIMEOUT_MS);
    await expect(pending).resolves.toMatchObject({ code: 'reference_finder_timeout' });
  });
});

describe('reference-finder query guard', () => {
  it('times out a silent query, terminates the worker and drops the client', async () => {
    const runtime = await freshRuntime();
    const client = runtime.getReferenceFinderClient('window');
    const lost = vi.fn();
    runtime.onReferenceFinderClientLost(lost);
    const pending = client.solveLine(0, 0.25, 1, 0.25, DEFAULT_QUERY_SETTINGS).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(runtime.REFERENCE_FINDER_QUERY_TIMEOUT_MS);

    await expect(pending).resolves.toMatchObject({ code: 'reference_finder_timeout' });
    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(runtime.isReferenceFinderClientConnected('window')).toBe(false);
    expect(lost).toHaveBeenCalledWith(expect.objectContaining({ reason: 'timeout' }));
    // The next call rebuilds on a fresh worker.
    expect(runtime.getReferenceFinderClient('window')).not.toBe(client);
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it('rejects the queued call behind a timed-out one instead of orphaning it', async () => {
    const runtime = await freshRuntime();
    const client = runtime.getReferenceFinderClient('window');
    const first = client.solvePoint(0.5, 0.5, DEFAULT_QUERY_SETTINGS).catch((e: unknown) => e);
    const second = client.solvePoint(0.25, 0.25, DEFAULT_QUERY_SETTINGS).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(runtime.REFERENCE_FINDER_QUERY_TIMEOUT_MS);

    await expect(first).resolves.toMatchObject({ code: 'reference_finder_timeout' });
    await expect(second).resolves.toMatchObject({ code: 'reference_finder_client_lost' });
  });

  it('turns a worker error into a rejection of the call in flight', async () => {
    const runtime = await freshRuntime();
    const client = runtime.getReferenceFinderClient('planner');
    const pending = client.solvePoint(0.5, 0.5, DEFAULT_QUERY_SETTINGS).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    FakeWorker.instances[0].dispatchEvent(new Event('error'));

    await expect(pending).resolves.toMatchObject({ code: 'reference_finder_client_lost' });
    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(runtime.isReferenceFinderClientConnected('planner')).toBe(false);
    expect(runtime.isReferenceFinderClientConnected('window')).toBe(false);
  });

  it('whileReferenceFinderClientAlive rejects when its own client is lost', async () => {
    const runtime = await freshRuntime();
    const window = runtime.getReferenceFinderClient('window');
    runtime.getReferenceFinderClient('planner');
    const guarded = runtime
      .whileReferenceFinderClientAlive('window', window.key, new Promise<string>(() => {}))
      .catch((e: unknown) => e);
    // A planner loss is not a window loss.
    runtime.releaseReferenceFinderClient('planner');
    runtime.releaseReferenceFinderClient('window');
    await expect(guarded).resolves.toMatchObject({ code: 'reference_finder_client_lost' });
  });

  it('whileReferenceFinderClientAlive ignores a sibling database of the same instance', async () => {
    // One instance holds two databases when a pattern has sheets of different
    // aspect ratios. The warm-up sheet's 60 s idle teardown must not reject a
    // query running against the sheet the user actually picked on.
    const runtime = await freshRuntime();
    const warmed = runtime.getReferenceFinderClient('window');
    const picked = runtime.getReferenceFinderClient('window', other);
    expect(picked.key).not.toBe(warmed.key);

    let settled: unknown = 'pending';
    const guarded = runtime
      .whileReferenceFinderClientAlive('window', picked.key, new Promise<string>(() => {}))
      .catch((e: unknown) => e);
    void guarded.then((value) => {
      settled = value;
    });

    // Keep the picked client fresh (a query would `touch` it), then let the
    // warmed one's 60 s idle timer fire underneath the guarded promise.
    await vi.advanceTimersByTimeAsync(runtime.REFERENCE_FINDER_IDLE_TEARDOWN_MS - 1);
    expect(runtime.getReferenceFinderClient('window', other)).toBe(picked);
    await vi.advanceTimersByTimeAsync(2);
    expect(runtime.getReferenceFinderClient('window', other)).toBe(picked);
    expect(settled).toBe('pending');

    // Losing the picked client itself still rejects.
    runtime.releaseReferenceFinderClient('window');
    await expect(guarded).resolves.toMatchObject({ code: 'reference_finder_client_lost' });
  });

  it('releasing an instance terminates all its workers and announces each', async () => {
    const runtime = await freshRuntime();
    runtime.getReferenceFinderClient('window');
    runtime.getReferenceFinderClient('window', other);
    runtime.getReferenceFinderClient('planner');
    const lost = vi.fn();
    runtime.onReferenceFinderClientLost(lost);
    runtime.releaseReferenceFinderClient('window');

    expect(lost).toHaveBeenCalledTimes(2);
    expect(lost.mock.calls.every(([loss]) => loss.reason === 'released')).toBe(true);
    expect(runtime.isReferenceFinderClientConnected('window')).toBe(false);
    expect(runtime.isReferenceFinderClientConnected('planner')).toBe(true);
    expect(FakeWorker.instances.filter((w) => w.terminated)).toHaveLength(2);
  });

  it('a late error from a replaced worker does not drop the replacement', async () => {
    const runtime = await freshRuntime();
    runtime.getReferenceFinderClient('window');
    runtime.releaseReferenceFinderClient('window');
    const replacement = runtime.getReferenceFinderClient('window');
    FakeWorker.instances[0].dispatchEvent(new Event('error'));

    expect(runtime.isReferenceFinderClientConnected('window')).toBe(true);
    expect(runtime.getReferenceFinderClient('window')).toBe(replacement);
  });

  it('normalises unknown errors into the reference_finder envelope', async () => {
    const runtime = await freshRuntime();
    expect(runtime.referenceFinderError(new Error('boom'))).toEqual({
      code: 'reference_finder',
      message: 'boom',
    });
    expect(runtime.referenceFinderError({ code: 'x', message: 'y' })).toEqual({ code: 'x', message: 'y' });
  });
});
