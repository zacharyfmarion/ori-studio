import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Remote } from 'comlink';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { cameraSpreadCaptureClient, cameraSpreadGeometryKey, cameraSpreadRenderClient } from './cameraSpreadClients';
import type { CameraSpreadRenderApi, CameraSpreadRenderRequest } from './cameraSpreadSession';

/** Latest-input scheduling: at most one bitmap request in flight per view. */
export function useCameraSpreadRuntime(kernel: OristudioCpFoldedPaperScene, onFrame: (bitmap: ImageBitmap) => void) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const frame = useRef(onFrame);
  useLayoutEffect(() => {
    frame.current = onFrame;
  }, [onFrame]);
  const state = useRef<{
    client: Remote<CameraSpreadRenderApi>;
    closed: boolean;
    running: boolean;
    animation: number | null;
    pending: CameraSpreadRenderRequest | null;
    key: number;
    kernel: OristudioCpFoldedPaperScene;
  } | null>(null);
  const last = useRef<Omit<CameraSpreadRenderRequest, 'key'> | null>(null);
  const drain = useCallback(async function drain() {
    const current = state.current;
    if (!current || current.closed || current.running) return;
    current.running = true;
    try {
      if (current.pending && !current.closed) {
        const request = current.pending;
        current.pending = null;
        let bitmap = await cameraSpreadRenderClient.call(
          () => current.client.render(request),
          120_000,
          (late) => late?.close()
        );
        if (!bitmap && !current.closed) {
          await cameraSpreadRenderClient.call(() => current.client.load(current.key, current.kernel));
          bitmap = await cameraSpreadRenderClient.call(
            () => current.client.render(request),
            120_000,
            (late) => late?.close()
          );
        }
        if (current.closed || state.current !== current) {
          bitmap?.close();
          return;
        }
        if (!bitmap) throw new Error('Camera spread render session was evicted');
        frame.current(bitmap);
        setStatus('ready');
      }
    } catch (cause) {
      current.pending = null;
      if (!current.closed) {
        setStatus('error');
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      current.running = false;
      if (current.pending && !current.closed && state.current === current) {
        current.animation = requestAnimationFrame(() => {
          current.animation = null;
          void drain();
        });
      }
    }
  }, []);
  useEffect(() => {
    let client: Remote<CameraSpreadRenderApi> | undefined;
    try {
      client = cameraSpreadRenderClient.retain();
      cameraSpreadCaptureClient.retain();
    } catch (cause) {
      if (client) cameraSpreadRenderClient.release();
      setStatus('error');
      setError(String(cause));
      return;
    }
    const current = {
      client,
      closed: false,
      running: false,
      animation: null as number | null,
      pending: null as CameraSpreadRenderRequest | null,
      key: cameraSpreadGeometryKey(kernel),
      kernel,
    };
    state.current = current;
    // Capture prepares lazily on the first edit. Preparing two copies of a dense
    // lift on entry competes with the frame the user is waiting to manipulate.
    setStatus('loading');
    setError(null);
    if (last.current) current.pending = { ...last.current, key: current.key };
    current.animation = requestAnimationFrame(() => {
      current.animation = null;
      void drain();
    });
    return () => {
      current.closed = true;
      current.pending = null;
      if (current.animation !== null) cancelAnimationFrame(current.animation);
      if (state.current === current) state.current = null;
      // The backend owns a two-scene LRU, freed when its idle worker expires.
      cameraSpreadRenderClient.release();
      cameraSpreadCaptureClient.release();
    };
  }, [kernel, retry, drain]);
  const draw = useCallback(
    (request: Omit<CameraSpreadRenderRequest, 'key'>) => {
      last.current = request;
      const current = state.current;
      if (!current || current.closed) return;
      current.pending = { ...request, key: current.key };
      if (!current.running && current.animation === null)
        current.animation = requestAnimationFrame(() => {
          current.animation = null;
          void drain();
        });
    },
    [drain]
  );
  return { status, error, draw, retry: () => setRetry((value) => value + 1) };
}
