import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectedSpreadView } from './view';
import type { SpreadFrame } from './renderProtocol';

/** One in-flight frame and one replaceable pending frame. Slow GPUs never
 * accumulate a queue of obsolete pointer positions. */
export function useSpreadRenderer(view: ConnectedSpreadView, onFrame: (bitmap: ImageBitmap) => void) {
  const worker = useRef<Worker | null>(null),
    busy = useRef(false),
    pending = useRef<SpreadFrame | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearWatchdog = useCallback(() => {
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = null;
  }, []);
  const last = useRef<SpreadFrame | null>(null),
    paint = useRef(onFrame);
  const [status, setStatus] = useState<'preparing' | 'ready' | 'error'>('preparing');
  useEffect(() => {
    paint.current = onFrame;
  }, [onFrame]);
  const request = useCallback((frame: SpreadFrame) => {
    last.current = frame;
    if (!worker.current) return;
    if (busy.current) {
      pending.current = frame;
      return;
    }
    busy.current = true;
    watchdog.current = setTimeout(() => {
      worker.current?.terminate();
      worker.current = null;
      busy.current = false;
      pending.current = null;
      setStatus('error');
    }, 10_000);
    try {
      worker.current.postMessage({ kind: 'frame', frame });
    } catch {
      clearWatchdog();
      worker.current.terminate();
      worker.current = null;
      busy.current = false;
      pending.current = null;
      setStatus('error');
    }
  }, [clearWatchdog]);
  useEffect(() => {
    let live = true;
    let w: Worker;
    try {
      w = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      setStatus('error');
      return;
    }

    worker.current = w;
    busy.current = false;
    pending.current = null;
    setStatus('preparing');
    w.onmessage = ({ data }: { data: { kind: 'frame'; bitmap: ImageBitmap } | { kind: 'error' } }) => {
      if (!live || worker.current !== w) {
        if (data.kind === 'frame') data.bitmap.close();
        return;
      }
      clearWatchdog();
      busy.current = false;
      if (data.kind === 'error') {
        w.terminate();
        worker.current = null;
        pending.current = null;
        setStatus('error');
        return;
      }
      paint.current(data.bitmap);
      setStatus('ready');
      const next = pending.current;
      pending.current = null;
      if (next) request(next);
    };
    w.onerror = () => {
      if (live && worker.current === w) {
        clearWatchdog();
        w.terminate();
        worker.current = null;
        pending.current = null;
        busy.current = false;
        setStatus('error');
      }
    };
    try {
      w.postMessage({ kind: 'source', view });
      if (last.current) request(last.current);
    } catch {
      clearWatchdog();
      w.terminate();
      worker.current = null;
      setStatus('error');
    }
    return () => {
      live = false;
      clearWatchdog();
      w.terminate();
      if (worker.current === w) worker.current = null;
    };
  }, [view, request, clearWatchdog]);
  return { status, request };
}
