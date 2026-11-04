import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface BitmapFrame { width: number; height: number }
export type BitmapReply<Payload> = { kind: 'frame'; id: number; bitmap: ImageBitmap; payload?: Payload } | { kind: 'error'; message?: string };
export type BitmapRequest<Source, Frame> = { kind: 'source'; source: Source } | { kind: 'frame'; id: number; frame: Frame };

/** Bounded scheduling shared by Fold and Diagram. An instance is one source
 * generation. Late frames are closed; geometry never queues behind gestures. */
export function useBitmapRenderer<Source, Frame extends BitmapFrame, Payload>(
  source: Source | null,
  createWorker: () => Worker,
  paint: (bitmap: ImageBitmap, frame: Frame, payload?: Payload) => void,
) {
  const client = useRef<{ worker: Worker; submit: (frame: Frame) => void } | null>(null);
  const latest = useRef<{ source: Source | null; frame: Frame } | null>(null);
  const callback = useRef(paint);
  const currentSource = useRef(source);
  useLayoutEffect(() => { currentSource.current = source; }, [source]);
  useLayoutEffect(() => { callback.current = paint; });
  type Status = 'preparing' | 'ready' | 'error';
  const [result, setResult] = useState<{ source: Source; status: Status } | null>(null);
  const request = useCallback((frame: Frame) => {
    if (frame.width <= 1 || frame.height <= 1) return;
    latest.current = { source: currentSource.current, frame };
    client.current?.submit(frame);
  }, []);
  useEffect(() => {
    if (!source) return;
    let worker: Worker | null = null, live = true, counter = 0;
    let flight: { id: number; frame: Frame } | null = null, pending: Frame | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const status = (value: Status) => setResult(was => was?.source === source && was.status === value ? was : { source, status: value });
    const clear = () => { if (timer) clearTimeout(timer); timer = null; };
    const fail = () => { if (!live || currentSource.current !== source) return; clear(); live = false; worker?.terminate(); client.current = null; pending = null; status('error'); };
    const submit = (frame: Frame) => {
      if (!live || !worker || currentSource.current !== source) return;
      if (flight) { pending = frame; return; }
      flight = { id: ++counter, frame };
      timer = setTimeout(fail, 10_000);
      try { worker.postMessage({ kind: 'frame', id: flight.id, frame }); } catch { fail(); }
    };
    try {
      worker = createWorker();
      client.current = { worker, submit };
      status('preparing');
      worker.onmessage = ({ data }: MessageEvent<BitmapReply<Payload>>) => {
        if (!live || currentSource.current !== source) { if (data.kind === 'frame') data.bitmap.close(); return; }
        if (data.kind === 'error') { fail(); return; }
        if (!flight || data.id !== flight.id) { data.bitmap.close(); return; }
        clear();
        const frame = flight.frame;
        flight = null;
        try { callback.current(data.bitmap, frame, data.payload); } catch { data.bitmap.close(); fail(); return; }
        status('ready');
        const next = pending; pending = null;
        if (next) submit(next);
      };
      worker.onerror = fail;
      worker.postMessage({ kind: 'source', source });
      if (latest.current?.source === source) submit(latest.current.frame);
    } catch { fail(); }
    return () => {
      live = false; clear(); worker?.terminate();
      if (client.current?.worker === worker) client.current = null;
      if (latest.current?.source === source) latest.current = null;
    };
  }, [source, createWorker]);
  return { request, status: result?.source === source ? result.status : 'preparing' as Status };
}
