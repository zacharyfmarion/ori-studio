import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useSpreadRenderer } from './useSpreadRenderer';
import type { SpreadFrame } from './renderProtocol';
import type { ConnectedSpreadView } from './view';

const workers: WorkerMock[] = [];
class WorkerMock {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    workers.push(this);
  }
}
const view = {} as ConnectedSpreadView;
const frame = (zoom: number) => ({ zoom }) as SpreadFrame;
const host = document.createElement('div');
let root: ReturnType<typeof createRoot> | null = null;
let render!: ReturnType<typeof useSpreadRenderer>;
function Harness({ paint }: { paint: (bitmap: ImageBitmap) => void }) {
  const result = useSpreadRenderer(view, paint);
  useLayoutEffect(() => {
    render = result;
  });
  return null;
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  workers.length = 0;
  vi.unstubAllGlobals();
});

it('retains one pending frame and closes late bitmaps after unmount', async () => {
  vi.stubGlobal('Worker', WorkerMock);
  root = createRoot(host);
  const paint = vi.fn();
  await act(async () => root!.render(<Harness paint={paint} />));
  const worker = workers[0]!;
  await act(async () => {
    render.request(frame(1));
    render.request(frame(2));
    render.request(frame(3));
  });
  expect(worker.postMessage.mock.calls.map((call) => call[0].kind)).toEqual(['source', 'frame']);
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
  await act(async () => worker.onmessage!({ data: { kind: 'frame', bitmap } }));
  expect(paint).toHaveBeenCalledWith(bitmap);
  expect(worker.postMessage.mock.lastCall![0].frame.zoom).toBe(3);
  await act(async () => root!.unmount());
  root = null;
  worker.onmessage!({ data: { kind: 'frame', bitmap } });
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it('falls back when the worker cannot render and stops further requests', async () => {
  vi.stubGlobal('Worker', WorkerMock);
  root = createRoot(host);
  await act(async () => root!.render(<Harness paint={() => {}} />));
  const worker = workers[0]!;
  await act(async () => worker.onmessage!({ data: { kind: 'error' } }));
  expect(render.status).toBe('error');
  expect(worker.terminate).toHaveBeenCalledOnce();
  render.request(frame(1));
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
});
