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
const frame = (zoom: number) => ({ zoom, width: 800, height: 600 }) as SpreadFrame;
const host = document.createElement('div');
let root: ReturnType<typeof createRoot> | null = null;
let render!: ReturnType<typeof useSpreadRenderer>;
let commits = 0;
function Harness({ paint, source = view }: { paint: (bitmap: ImageBitmap) => void; source?: ConnectedSpreadView }) {
  const result = useSpreadRenderer(source, paint);
  useLayoutEffect(() => {
    render = result;
    commits++;
  });
  return null;
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  workers.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
  await act(async () => worker.onmessage!({ data: { kind: 'frame', id: 1, bitmap } }));
  expect(paint).toHaveBeenCalledWith(bitmap);
  expect(worker.postMessage.mock.lastCall![0].frame.zoom).toBe(3);
  await act(async () => root!.unmount());
  root = null;
  worker.onmessage!({ data: { kind: 'frame', id: 1, bitmap } });
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


it('falls back if a graphics worker stops responding and closes a late frame', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', WorkerMock);
  root = createRoot(host);
  const paint = vi.fn();
  await act(async () => root!.render(<Harness paint={paint} />));
  const worker = workers[0]!;
  await act(async () => render.request(frame(1)));
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(render.status).toBe('error');
  expect(worker.terminate).toHaveBeenCalledOnce();
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
  await act(async () => worker.onmessage!({ data: { kind: 'frame', id: 1, bitmap } }));
  expect(paint).not.toHaveBeenCalled();
  expect(bitmap.close).toHaveBeenCalledOnce();
});

it('waits for layout and a painted frame, resetting readiness when the model changes', async () => {
  vi.stubGlobal('Worker', WorkerMock); root = createRoot(host);
  const paint = vi.fn();
  await act(async () => root!.render(<Harness paint={paint} />));
  expect(render.status).toBe('preparing');
  await act(async () => render.request({...frame(1), width:1, height:1}));
  expect(workers[0]!.postMessage).toHaveBeenCalledTimes(1);
  await act(async () => render.request(frame(1)));
  const bitmap = {close:vi.fn()} as unknown as ImageBitmap;
  await act(async () => workers[0]!.onmessage!({data:{kind:'frame',id:workers[0]!.postMessage.mock.lastCall![0].id,bitmap}}));
  expect(paint).toHaveBeenCalledWith(bitmap); expect(render.status).toBe('ready');
  const readyCommits = commits;
  await act(async () => render.request(frame(2)));
  await act(async () => workers[0]!.onmessage!({data:{kind:'frame',id:workers[0]!.postMessage.mock.lastCall![0].id,bitmap}}));
  expect(commits).toBe(readyCommits); // Painting a live frame must not re-render React.
  await act(async () => render.request(frame(3)));
  expect(render.status).toBe('ready'); // Live updates do not re-block Pose.
  await act(async () => root!.render(<Harness source={{} as ConnectedSpreadView} paint={paint} />));
  expect(render.status).toBe('preparing');
  await act(async () => workers[0]!.onmessage!({data:{kind:'frame',id:workers[0]!.postMessage.mock.lastCall![0].id,bitmap}}));
  expect(render.status).toBe('preparing'); expect(bitmap.close).toHaveBeenCalledOnce();
});

it('ignores wrong frame IDs without consuming the current request or its watchdog', async () => {
  vi.stubGlobal('Worker', WorkerMock); root = createRoot(host); const paint = vi.fn();
  await act(async () => root!.render(<Harness paint={paint} />));
  await act(async () => render.request(frame(1)));
  const stale = {close:vi.fn()} as unknown as ImageBitmap;
  await act(async () => workers[0]!.onmessage!({data:{kind:'frame',id:999,bitmap:stale}}));
  expect(stale.close).toHaveBeenCalledOnce(); expect(paint).not.toHaveBeenCalled();
  const current = {close:vi.fn()} as unknown as ImageBitmap;
  await act(async () => workers[0]!.onmessage!({data:{kind:'frame',id:1,bitmap:current}}));
  expect(paint).toHaveBeenCalledWith(current);
});

it('does not let an obsolete worker error disable its replacement', async () => {
  vi.stubGlobal('Worker', WorkerMock); root = createRoot(host);
  await act(async () => root!.render(<Harness paint={() => {}} />));
  const obsolete = workers[0]!;
  await act(async () => root!.render(<Harness source={{} as ConnectedSpreadView} paint={() => {}} />));
  await act(async () => obsolete.onerror!());
  await act(async () => render.request(frame(4)));
  expect(workers[1]!.postMessage.mock.lastCall![0]).toMatchObject({kind:'frame', frame:{zoom:4}});
  expect(workers[1]!.terminate).not.toHaveBeenCalled();
});
