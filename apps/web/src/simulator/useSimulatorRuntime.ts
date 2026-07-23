import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FoldDocument as SimulatorFoldDocument,
  FoldProfile,
  SimulatorDiagnostics,
  SimulatorOptions,
} from '@treemaker/origami-simulator';
import { getSimulatorClient, type SimulatorClient } from '../store/workspaceStore/simulatorRuntime';
import { inflateRenderModel, type SimulatorRenderModel } from './renderModel';

// Drives the simulator worker and exposes the latest frame to a renderer.
//
// The load-bearing detail is that no solver work happens on this thread. The
// rAF callback issues an async tick and returns immediately; when the worker
// replies we hand the positions to the renderer. A slow model makes frames
// arrive less often, it does not make them longer.

export type SimulatorStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SimulatorFrameView {
  positions: Float32Array;
  step: number;
  stepsThisTick: number;
  /** Solver ms spent in the worker for this tick. */
  elapsedMs: number;
  converged: boolean;
  foldPercent: number;
}

export interface SimulatorModelView extends SimulatorRenderModel {
  edgeCount: number;
  creaseCount: number;
  diagnostics: SimulatorDiagnostics;
}

export interface UseSimulatorRuntimeOptions {
  fold: SimulatorFoldDocument | null;
  foldProfile?: FoldProfile | null;
  solverOptions?: SimulatorOptions;
  triangulate?: boolean;
  /** Called on the main thread whenever a new frame is available. */
  onFrame?: (frame: SimulatorFrameView) => void;
}

export interface SimulatorRuntime {
  status: SimulatorStatus;
  error: string | null;
  model: SimulatorModelView | null;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  setFoldPercent: (percent: number) => void;
  /** Jump to a fold target and settle to it without animating. */
  settleTo: (percent: number) => void;
  reset: () => void;
  setMaterial: (options: Partial<SimulatorOptions>) => void;
}

export function useSimulatorRuntime(options: UseSimulatorRuntimeOptions): SimulatorRuntime {
  const { fold, foldProfile = null, solverOptions, triangulate = true, onFrame } = options;

  const [status, setStatus] = useState<SimulatorStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<SimulatorModelView | null>(null);
  const [playing, setPlaying] = useState(false);

  const clientRef = useRef<SimulatorClient | null>(null);
  const rafRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const recycledRef = useRef<ArrayBuffer | undefined>(undefined);
  const generationRef = useRef(0);
  // Kept in a ref so the play loop does not have to tear down and rebuild every
  // time the caller passes a new closure. Assigned in an effect rather than
  // during render, which is a real hazard: a ref written during render can be
  // left stale when React discards a render pass.
  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  const publish = useCallback((payload: Awaited<ReturnType<SimulatorClient['tick']>>) => {
    const positions = new Float32Array(payload.positions);
    onFrameRef.current?.({
      positions,
      step: payload.step,
      stepsThisTick: payload.stepsThisTick,
      elapsedMs: payload.elapsedMs,
      converged: payload.converged,
      foldPercent: payload.foldPercent,
    });
    // Give the buffer straight back to the worker on the next request so the
    // steady-state loop allocates nothing.
    recycledRef.current = payload.positions;
  }, []);

  // Load / reload whenever the source model changes.
  useEffect(() => {
    if (!fold) {
      setStatus('idle');
      setModel(null);
      return;
    }

    const generation = (generationRef.current += 1);
    let cancelled = false;
    setStatus('loading');
    setError(null);

    void (async () => {
      try {
        const client = getSimulatorClient();
        clientRef.current = client;
        const info = await client.load(fold, {
          prepare: { triangulate },
          solver: { ...solverOptions, foldProfile },
        });
        if (cancelled || generation !== generationRef.current) return;

        setModel({
          ...inflateRenderModel(info),
          edgeCount: info.edgeCount,
          creaseCount: info.creaseCount,
          diagnostics: info.diagnostics,
        });
        setStatus('ready');

        // Settle to the opening state before the first paint, so the panel does
        // not flash a flat sheet.
        const first = await client.settle(4000, {});
        if (cancelled || generation !== generationRef.current) return;
        publish(first);
      } catch (cause) {
        if (cancelled || generation !== generationRef.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fold, foldProfile, triangulate, publish]);

  // The play loop. Never runs solver work on this thread.
  useEffect(() => {
    if (!playing || status !== 'ready') return;

    const tick = () => {
      rafRef.current = window.requestAnimationFrame(tick);
      const client = clientRef.current;
      // One tick in flight at a time: the worker is the bottleneck, and queuing
      // more would only add latency between simulated state and what is drawn.
      if (!client || inFlightRef.current) return;
      inFlightRef.current = true;

      const recycled = recycledRef.current;
      recycledRef.current = undefined;
      void client
        .tick(recycled ? { recycled } : {})
        .then((payload) => {
          publish(payload);
          if (payload.converged) setPlaying(false);
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
          setStatus('error');
        })
        .finally(() => {
          inFlightRef.current = false;
        });
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, status, publish]);

  const runOnce = useCallback(
    async (mutate: (client: SimulatorClient) => Promise<void>) => {
      const client = clientRef.current;
      if (!client) return;
      try {
        await mutate(client);
        const recycled = recycledRef.current;
        recycledRef.current = undefined;
        publish(await client.tick(recycled ? { recycled } : {}));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus('error');
      }
    },
    [publish]
  );

  const setFoldPercent = useCallback(
    (percent: number) => {
      void runOnce(async (client) => {
        await client.setFoldPercent(percent);
      });
    },
    [runOnce]
  );

  const settleTo = useCallback(
    (percent: number) => {
      const client = clientRef.current;
      if (!client) return;
      void (async () => {
        try {
          await client.setFoldPercent(percent);
          const recycled = recycledRef.current;
          recycledRef.current = undefined;
          publish(await client.settle(20_000, recycled ? { recycled } : {}));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setStatus('error');
        }
      })();
    },
    [publish]
  );

  const reset = useCallback(() => {
    setPlaying(false);
    void runOnce(async (client) => {
      await client.reset();
      await client.setFoldPercent(0);
    });
  }, [runOnce]);

  const setMaterial = useCallback(
    (materialOptions: Partial<SimulatorOptions>) => {
      void runOnce(async (client) => {
        await client.setMaterial(materialOptions);
      });
    },
    [runOnce]
  );

  return {
    status,
    error,
    model,
    playing,
    setPlaying,
    setFoldPercent,
    settleTo,
    reset,
    setMaterial,
  };
}
