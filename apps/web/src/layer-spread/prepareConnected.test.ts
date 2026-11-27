import { afterEach, expect, it, vi } from 'vitest';
import type { OristudioCpFoldedPaperScene } from '../engine/oristudioCpTypes';
import type { ConnectedSpreadSource } from '../cp-workspace/folded/connectedSpreadSource';
const solver = vi.hoisted(() => ({ acquire: vi.fn() }));
vi.mock('./spreadService', () => ({ layerSpreadService: () => solver }));
import { prepareConnected } from './prepareConnected';
import { spreadRefusalOf } from './spreadRefusal';
class WorkerMock {
  static all: WorkerMock[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    WorkerMock.all.push(this);
  }
}
const source = { input: {} } as ConnectedSpreadSource;
afterEach(() => {
  WorkerMock.all.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('shares preparation while another consumer is alive, then reuses the canonical input', async () => {
  vi.stubGlobal('Worker', WorkerMock);
  const release = vi.fn();
  solver.acquire.mockReturnValue({ promise: Promise.resolve({ heights: [0] }), release });
  const scene = {} as OristudioCpFoldedPaperScene;
  const a = prepareConnected(scene),
    b = prepareConnected(scene);
  expect(WorkerMock.all).toHaveLength(1);
  a.release();
  expect(WorkerMock.all[0]!.terminate).not.toHaveBeenCalled();
  WorkerMock.all[0]!.onmessage!({ data: { kind: 'ready', source } });
  await expect(a.promise).rejects.toMatchObject({ name: 'AbortError' });
  expect((await b.promise).source).toBe(source);
  b.release();
  expect(release).toHaveBeenCalledOnce();
  const c = prepareConnected(scene);
  await c.promise;
  c.release();
  expect(WorkerMock.all).toHaveLength(1);
});
it('cancels unneeded preparation before a numerical solve and ignores late results', async () => {
  vi.stubGlobal('Worker', WorkerMock);
  solver.acquire.mockClear();
  const a = prepareConnected({} as OristudioCpFoldedPaperScene);
  a.release();
  await expect(a.promise).rejects.toMatchObject({ name: 'AbortError' });
  const worker = WorkerMock.all[0]!;
  expect(worker.terminate).toHaveBeenCalledOnce();
  worker.onmessage!({ data: { kind: 'ready', source } });
  expect(solver.acquire).not.toHaveBeenCalled();
});
it('keeps a refusal from the preparation worker a refusal, and refuses a preparation past its time budget', async () => {
  vi.stubGlobal('Worker', WorkerMock);
  const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error);
  const large = prepareConnected({} as OristudioCpFoldedPaperScene);
  const refused = failure(large.promise);
  WorkerMock.all[0]!.onmessage!({
    data: { kind: 'unavailable', message: 'Layer spread model exceeds its preparation budget', refusal: 'preparation_budget' },
  });
  expect(spreadRefusalOf(await refused)).toBe('preparation_budget');
  large.release();

  const unnamed = prepareConnected({} as OristudioCpFoldedPaperScene);
  const failed = failure(unnamed.promise);
  WorkerMock.all[1]!.onmessage!({ data: { kind: 'unavailable', message: 'Layer spread requires named material faces' } });
  expect(spreadRefusalOf(await failed)).toBeNull();
  unnamed.release();

  vi.useFakeTimers();
  try {
    const slow = prepareConnected({} as OristudioCpFoldedPaperScene);
    const timedOut = failure(slow.promise);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(spreadRefusalOf(await timedOut)).toBe('time_budget');
    slow.release();
  } finally {
    vi.useRealTimers();
  }
});
