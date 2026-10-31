import { describe, expect, it } from 'vitest';
import type { SpreadInput, SpreadSolution } from '@oristudio/layer-spread';
import { SpreadService, type SpreadWorker } from './spreadService';
import type { SpreadRequest } from './protocol';

const input: SpreadInput = {
  xy: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
  faces: [[0, 1, 2]],
  triangles: [[0, 1, 2]],
  triangleFaces: [0],
  orders: [],
  cells: [],
};
const solution = {
  version: 'normalized-50-v1',
  heights: [0, 0, 0],
  references: [
    { plane: [0, 0, 0], center: [0, 0, 0], samples: 1, rms: 0 },
    { plane: [0, 0, 0], center: [0, 0, 0], samples: 1, rms: 0 },
  ],
  diagnostics: { max_relative_warp: 0, max_slope: 0 },
} as SpreadSolution;
class WorkerMock implements SpreadWorker {
  onmessage: SpreadWorker['onmessage'] = null;
  onerror: SpreadWorker['onerror'] = null;
  requests: SpreadRequest[] = [];
  terminated = false;
  postMessage(r: SpreadRequest) {
    this.requests.push(r);
  }
  terminate() {
    this.terminated = true;
  }
  reply() {
    this.onmessage?.({ data: { kind: 'ready', generation: this.requests[0]!.generation, solution } } as never);
  }
}
describe('spread worker lifecycle', () => {
  it('deduplicates leases, retains another consumer and serves a cached pose without a solve', async () => {
    const worker = new WorkerMock(),
      service = new SpreadService(() => worker);
    const a = service.acquire(input),
      b = service.acquire(structuredClone(input));
    expect(worker.requests).toHaveLength(1);
    a.release();
    expect(worker.terminated).toBe(false);
    worker.reply();
    expect(await b.promise).toBe(solution);
    b.release();
    expect(await service.acquire(input).promise).toBe(solution);
    expect(worker.requests).toHaveLength(1);
    service.dispose();
  });
  it('terminates an unneeded synchronous solve and ignores its late result', async () => {
    const workers: WorkerMock[] = [];
    const service = new SpreadService(() => {
      const w = new WorkerMock();
      workers.push(w);
      return w;
    });
    const a = service.acquire(input);
    a.release();
    await expect(a.promise).rejects.toMatchObject({ name: 'AbortError' });
    const b = service.acquire(input);
    workers[0]!.reply();
    expect(service.peek(input)).toBeNull();
    expect(workers[0]!.terminated).toBe(true);
    workers[1]!.reply();
    expect(await b.promise).toBe(solution);
    service.dispose();
  });
  it('does not retain an entry beyond the byte budget', async () => {
    const worker = new WorkerMock(),
      service = new SpreadService(() => worker, 1);
    const a = service.acquire(input);
    worker.reply();
    await a.promise;
    expect(service.retainedBytes).toBe(0);
    expect(service.peek(input)).toBeNull();
    service.dispose();
  });
});

it('preempts a thumbnail for the active pose and resumes its still-retained lease', async () => {
  const workers: WorkerMock[] = [];
  const service = new SpreadService(() => {
    const w = new WorkerMock();
    workers.push(w);
    return w;
  });
  const thumbnail = service.acquire(input, 0);
  const other = {
    ...input,
    xy: [
      [0, 0],
      [2, 0],
      [0, 1],
    ] as [number, number][],
  };
  const active = service.acquire(other, 1);
  expect(workers[0]!.terminated).toBe(true);
  workers[0]!.reply();
  expect(service.peek(input)).toBeNull();
  workers[1]!.reply();
  await active.promise;
  expect(workers[1]!.requests).toHaveLength(2);
  workers[1]!.onmessage?.({
    data: { kind: 'ready', generation: workers[1]!.requests[1]!.generation, solution },
  } as never);
  expect(await thumbnail.promise).toBe(solution);
  service.dispose();
});
