import { useCallback, useEffect, useRef, useState } from 'react';
import { transfer } from 'comlink';
import type {
  FoldDocument as SimulatorFoldDocument,
  FoldProfile,
  OrbitView,
  RenderSettings,
  SimulatorDiagnostics,
  SimulatorOptions,
} from '@treemaker/origami-simulator';
import { getSimulatorClient, type SimulatorClient } from '../store/workspaceStore/simulatorRuntime';
import { inflateRenderModel, type SimulatorRenderModel } from './renderModel';
import { readString, storageKey } from '../lib/storage';

// Drives the simulator worker and exposes the latest frame to a renderer.
//
// Two render paths, chosen per canvas:
//   - GPU: the worker owns the canvas (transferControlToOffscreen) and draws the
//     mesh straight from the solver's position texture. No positions cross to
//     the main thread; orbit/zoom is a `setCamera` message and a redraw.
//   - CPU fallback: the worker returns positions, the panel draws them on the
//     main thread (canvas-2D). Used when WebGL2 is absent or the model needs a
//     path the GPU renderer does not cover (fold profile, Verlet).
//
// Either way no solver work runs on this thread.

export type SimulatorStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SimulatorFrameView {
  /** Null in GPU-render mode: the worker already drew, nothing to draw here. */
  positions: Float32Array | null;
  step: number;
  stepsThisTick: number;
  /** Solver ms spent in the worker for this tick. */
  elapsedMs: number;
  converged: boolean;
  foldPercent: number;
  maxEdgeStrain: number;
}

// Main-thread timing, read and reset by the perf logger.
let cameraDispatchTotal = 0;
let cameraDispatchCount = 0;
function cameraDispatchAvg(): number {
  return cameraDispatchCount ? cameraDispatchTotal / cameraDispatchCount : 0;
}
let tickRoundTripTotal = 0;
let tickRoundTripCount = 0;
function tickRoundTripAvg(): number {
  return tickRoundTripCount ? tickRoundTripTotal / tickRoundTripCount : 0;
}

/** True if this canvas can host the WebGL2 float-render-target GPU path. */
export function webglRenderSupported(): boolean {
  if (typeof document === 'undefined' || typeof OffscreenCanvas === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    return Boolean(gl && gl.getExtension('EXT_color_buffer_float'));
  } catch {
    return false;
  }
}

export interface SimulatorModelView extends SimulatorRenderModel {
  edgeCount: number;
  creaseCount: number;
  diagnostics: SimulatorDiagnostics;
  backend: 'webgl2' | 'reference';
}

export interface UseSimulatorRuntimeOptions {
  fold: SimulatorFoldDocument | null;
  foldProfile?: FoldProfile | null;
  solverOptions?: SimulatorOptions;
  triangulate?: boolean;
  /**
   * The canvas the mesh is drawn on. In GPU mode it is transferred to the worker
   * (once) and the worker renders to it; in CPU mode the panel draws on it. Pass
   * `null` to force the CPU path (e.g. a fold-profile simulation).
   */
  canvas?: HTMLCanvasElement | null;
  /** Whether the GPU render path may be used for this source (no fold profile / Verlet). */
  allowGpuRender?: boolean;
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
  /** True when the worker owns the canvas and renders on the GPU. */
  gpuActive: boolean;
  /** Push a new orbit camera to the worker (GPU mode); no-op in CPU mode. */
  setCamera: (view: OrbitView, width: number, height: number) => void;
  /** Push render settings to the worker (GPU mode); no-op in CPU mode. */
  setRenderSettings: (settings: RenderSettings) => void;
}

export function useSimulatorRuntime(options: UseSimulatorRuntimeOptions): SimulatorRuntime {
  const {
    fold,
    foldProfile = null,
    solverOptions,
    triangulate = true,
    canvas = null,
    allowGpuRender = true,
    onFrame,
  } = options;

  const [status, setStatus] = useState<SimulatorStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<SimulatorModelView | null>(null);
  const [playing, setPlaying] = useState(false);
  const [gpuActive, setGpuActive] = useState(false);

  const clientRef = useRef<SimulatorClient | null>(null);
  // The canvas element whose control was transferred to the worker. A canvas can
  // only be transferred once, so this guards against a second attempt and lets a
  // canvas swap (React key change) re-transfer the new element.
  const transferredCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gpuActiveRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  // Whether the model has settled at its current target. The loop idles when
  // this is true and nothing is playing, so a converged simulator costs nothing
  // while still restarting the instant a new target arrives.
  const convergedRef = useRef(true);
  const playingRef = useRef(false);
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
    // GPU-render mode: the worker already drew to the canvas and sent no
    // positions. Still surface the scalars (step, strain, fold percent) so the
    // readouts update; positions are null and there is nothing to draw here.
    const positions = payload.positions ? new Float32Array(payload.positions) : null;
    onFrameRef.current?.({
      positions,
      step: payload.step,
      stepsThisTick: payload.stepsThisTick,
      elapsedMs: payload.elapsedMs,
      converged: payload.converged,
      foldPercent: payload.foldPercent,
      maxEdgeStrain: payload.maxEdgeStrain,
    });
    convergedRef.current = payload.converged;
    // Give the buffer straight back to the worker on the next request so the
    // steady-state CPU loop allocates nothing. (Null in GPU mode.)
    recycledRef.current = payload.positions ?? undefined;
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

    // Decide the render path before loading. GPU render needs WebGL2, a canvas,
    // and a source the GPU path covers (no fold profile / Verlet). The canvas is
    // transferred once; a later CPU-only source keeps the (already transferred)
    // canvas but the worker falls back to positions, which the panel then cannot
    // draw -- so the panel swaps the canvas element (React key) when the desired
    // path changes, giving a fresh untransferred one.
    const wantsGpu = Boolean(canvas && allowGpuRender && webglRenderSupported());

    void (async () => {
      try {
        const client = getSimulatorClient();
        clientRef.current = client;

        if (wantsGpu && canvas && transferredCanvasRef.current !== canvas) {
          const offscreen = canvas.transferControlToOffscreen();
          await client.attachCanvas(transfer(offscreen, [offscreen]));
          transferredCanvasRef.current = canvas;
        }

        const info = await client.load(fold, {
          prepare: { triangulate },
          solver: { ...solverOptions, foldProfile },
          preferGpu: wantsGpu,
        });
        if (cancelled || generation !== generationRef.current) return;

        const gpu = info.backend === 'webgl2' && wantsGpu;
        gpuActiveRef.current = gpu;
        setGpuActive(gpu);
        setModel({
          ...inflateRenderModel(info),
          edgeCount: info.edgeCount,
          creaseCount: info.creaseCount,
          diagnostics: info.diagnostics,
          backend: info.backend,
        });
        setStatus('ready');

        // Settle the opening state before the first paint so the panel does not
        // flash a flat sheet. Bounded deliberately: at foldPercent 0 this
        // converges within a few dozen steps, and an unbounded settle would tie
        // the worker up for seconds on a model that oscillates above epsilon.
        const first = await client.settle(2000, {});
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
  }, [fold, foldProfile, triangulate, canvas, allowGpuRender, publish]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // The work loop. Mounted for as long as a model is loaded, and does nothing
  // on frames where the model has settled and playback is stopped -- so
  // scrubbing the fold slider animates towards the new target instead of
  // blocking anyone while it converges.
  //
  // Solver work never happens on this thread: the callback issues an async tick
  // and returns.
  useEffect(() => {
    if (status !== 'ready' || typeof window === 'undefined') return;

    const tick = () => {
      rafRef.current = window.requestAnimationFrame(tick);
      const client = clientRef.current;
      if (!client || inFlightRef.current) return;
      // Idle: nothing to solve and nothing playing.
      if (convergedRef.current && !playingRef.current) return;

      inFlightRef.current = true;
      const recycled = recycledRef.current;
      recycledRef.current = undefined;
      const dispatched = performance.now();
      void client
        .tick(recycled ? { recycled } : {})
        .then((payload) => {
          // Round-trip: dispatch -> worker tick -> reply. If the solver loop is
          // slow because the worker tick is slow (e.g. a GPU pipeline stall),
          // this is high; if it is fast but ticks are still infrequent, the
          // throttle is on the main thread.
          tickRoundTripTotal += performance.now() - dispatched;
          tickRoundTripCount += 1;
          publish(payload);
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
  }, [status, publish]);

  const retarget = useCallback(
    (mutate: (client: SimulatorClient) => Promise<void>) => {
      const client = clientRef.current;
      if (!client) return;
      // Assume the change unsettles the model; the loop picks it up next frame
      // and keeps working until the worker reports convergence again.
      convergedRef.current = false;
      void mutate(client).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus('error');
      });
    },
    []
  );

  const setFoldPercent = useCallback(
    (percent: number) => {
      retarget((client) => client.setFoldPercent(percent));
    },
    [retarget]
  );

  /**
   * Move to a fold target. Named for the caller's intent, but it does not block:
   * an earlier version ran the worker to convergence here, which could occupy
   * it for seconds on a model that oscillates above the convergence epsilon,
   * and showed the user nothing until it finished.
   */
  const settleTo = useCallback(
    (percent: number) => {
      setFoldPercent(percent);
    },
    [setFoldPercent]
  );

  const setMaterial = useCallback(
    (materialOptions: Partial<SimulatorOptions>) => {
      retarget((client) => client.setMaterial(materialOptions));
    },
    [retarget]
  );

  const reset = useCallback(() => {
    setPlaying(false);
    retarget(async (client) => {
      await client.reset();
      await client.setFoldPercent(0);
    });
  }, [retarget]);

  // Orbit/zoom and view-setting changes forward to the worker, which redraws
  // from the position texture. No solver work, no readback -- this is what makes
  // camera manipulation cheap at any model size. Fire-and-forget: the draw
  // happens on the worker's own schedule and must not block the pointer handler.
  const setCamera = useCallback((view: OrbitView, width: number, height: number) => {
    if (!gpuActiveRef.current) return;
    // Time the synchronous main-thread cost of dispatching the camera message
    // (comlink proxy + structured clone). If orbit lag lives on the main thread,
    // it shows up here.
    const started = performance.now();
    void clientRef.current?.setCamera({ view, width, height }).catch(() => undefined);
    cameraDispatchTotal += performance.now() - started;
    cameraDispatchCount += 1;
  }, []);

  const setRenderSettings = useCallback((settings: RenderSettings) => {
    if (!gpuActiveRef.current) return;
    void clientRef.current?.setRenderSettings(settings).catch(() => undefined);
  }, []);

  // Opt-in perf logging: set `oristudio:sim-perf` to `1` in localStorage, then
  // reload. Once a second it prints the worker's solve/render/camera timings
  // plus the main thread's own camera-dispatch cost, so it is clear whether lag
  // is the GPU draw, the solve, the message rate, or the main thread.
  useEffect(() => {
    if (status !== 'ready' || typeof window === 'undefined') return;
    if (readString(storageKey('sim-perf')) !== '1') return;
    const id = window.setInterval(() => {
      const client = clientRef.current;
      if (!client) return;
      void client
        .getPerfStats()
        .then((s) => {
          const perSec = (n: number) => (s.windowMs ? (n / s.windowMs) * 1000 : 0).toFixed(0);
          console.log(
            `[sim] ${s.backend}${s.gpuRender ? '+gpuRender' : '+cpuRender'} | ` +
              `solve ${s.solveAvgMs.toFixed(1)}ms avg / ${s.solveMaxMs.toFixed(1)} max, ` +
              `${perSec(s.ticks)} ticks/s, ${perSec(s.stepsTotal)} steps/s | ` +
              `render ${s.renderAvgMs.toFixed(2)}ms avg / ${s.renderMaxMs.toFixed(2)} max, ` +
              `${perSec(s.renders)} draws/s | ` +
              `camera ${perSec(s.cameraCalls)} msg/s, main-dispatch ${cameraDispatchAvg().toFixed(2)}ms | ` +
              `tick round-trip ${tickRoundTripAvg().toFixed(1)}ms`
          );
          cameraDispatchTotal = 0;
          cameraDispatchCount = 0;
          tickRoundTripTotal = 0;
          tickRoundTripCount = 0;
        })
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(id);
  }, [status]);

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
    gpuActive,
    setCamera,
    setRenderSettings,
  };
}
