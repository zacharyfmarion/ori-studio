import { useCallback, useEffect, useRef, useState } from 'react';
import { transfer } from 'comlink';
import type {
  FoldDocument as SimulatorFoldDocument,
  FoldProfile,
  OrbitView,
  PullOutcome,
  RenderSettings,
  SimulatorDiagnostics,
  SimulatorOptions,
  SimulationRecovery,
} from '@treemaker/origami-simulator';
import {
  releaseSimulatorClient,
  retainSimulatorClient,
  type SimulatorClient,
} from '../store/workspaceStore/simulatorRuntime';
import { ensureWorkerGpuSupport, markWorkerGpuUnsupported } from './workerGpuSupport';
import { inflateRenderModel, type SimulatorRenderModel } from './renderModel';
import {
  beginCameraMessage,
  endCameraMessage,
  recordSimulatorProbe,
} from './simulatorPerfProbe';
import { useSimulatorPerfLog } from './useSimulatorPerfLog';
import { simulatorDevicePixelRatio } from './simulatorDevicePixelRatio';
import type { PaperScene } from '../lib/paper/paperScene';
import type {
  SimulatorDrawnView,
  SimulatorExportSceneOptions,
  SimulatorPoseEnd,
  SimulatorPullEndResult,
} from './simulatorSession';
import type { SimulatorPickQuery, SimulatorPullStart, SimulatorScreenPoint } from './pickQuery';

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

/** One orbit camera push: where to look from, and at what drawing-buffer size. */
interface SimulatorCameraRequest {
  view: OrbitView;
  width: number;
  height: number;
}

/**
 * The view frozen for the export dialog, and the scenes built from it. The
 * worker holds the frame; `release` lets it go when the dialog closes.
 */
export interface SimulatorExportSnapshot {
  scene: (options: SimulatorExportSceneOptions) => Promise<PaperScene | null>;
  release: () => void;
}

export interface SimulatorFrameView {
  /** Null in GPU-render mode: the worker already drew, nothing to draw here. */
  positions: Float32Array | null;
  /**
   * The rendered frame, when the worker is in bitmap-present mode. The consumer
   * hands it to a `bitmaprenderer` canvas. Null when the worker drew straight to
   * a transferred canvas, or in the CPU path.
   */
  bitmap: ImageBitmap | null;
  step: number;
  stepsThisTick: number;
  /** Solver ms spent in the worker for this tick. */
  elapsedMs: number;
  converged: boolean;
  foldPercent: number;
  maxStrain: number;
  /**
   * What the solver's blow-up guard did on the tick this frame came from, if
   * anything. Absent on a redraw, which ran no solver step.
   */
  recovered?: SimulationRecovery | null;
  /** The paper holds a pose a pull left it in. */
  posed?: boolean;
  /** What ended a pose since the last frame. Absent on a redraw. */
  poseEnded?: SimulatorPoseEnd | null;
}

/** What a pin request did; see `SimulatorPinResult`. */
export interface SimulatorPinOutcome {
  applied: number;
  dropped: number;
}

/**
 * True if the **main thread** can host a WebGL2 float-render-target context.
 *
 * Narrower than it looks, and the narrowness is the point: this says nothing
 * about the worker, which is where the simulator actually renders. On WebKitGTK
 * the two disagree — main thread yes, worker no — so anything deciding whether
 * to commit a canvas to the worker must ask {@link useWorkerGpuSupport} instead.
 * Using this for that is what shipped the Linux `InvalidStateError`.
 *
 * The probe context is explicitly released. Contexts are a small, hard-capped
 * resource — four per worker, sixteen per page in Chromium 148 — so leaving each
 * probe to garbage collection spends the budget the simulator itself needs. The
 * result is cached because the answer cannot change within a session, which
 * makes the common case free.
 */
let webglRenderSupportedCache: boolean | null = null;

export function webglRenderSupported(): boolean {
  if (webglRenderSupportedCache !== null) return webglRenderSupportedCache;
  if (typeof document === 'undefined' || typeof OffscreenCanvas === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    const supported = Boolean(gl && gl.getExtension('EXT_color_buffer_float'));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    webglRenderSupportedCache = supported;
    return supported;
  } catch {
    webglRenderSupportedCache = false;
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
  /**
   * Present frames as ImageBitmaps from a worker-private canvas, instead of
   * transferring this canvas to the worker.
   *
   * This is how several simulations share one GL context: the receiving canvas
   * takes a `bitmaprenderer` context, which does not count against the four
   * WebGL contexts a worker gets, so the cap stops being a limit on how many
   * simulations can be open. Costs one bitmap transfer per frame.
   */
  bitmapOutput?: { width: number; height: number } | null;
  /**
   * Stop stepping the solver, without unloading it.
   *
   * A paused runtime still answers `setCamera`, so its model can be re-rendered
   * at a new size or angle — which is the whole reason an unfocused inline
   * simulation keeps its session. It simply stops advancing: freezing the fold
   * is what the user asked for, and it is also the honest reading of "only one
   * simulation runs at a time".
   */
  paused?: boolean;
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
  /**
   * Changes when this runtime needs a *different* canvas element than the one it
   * was given. Consumers that pass a canvas must fold it into that element's
   * React key; a canvas whose control has been transferred cannot be reclaimed,
   * so the only way back to a drawable surface is a new one.
   */
  canvasGeneration: number;
  /**
   * Push a new orbit camera to the worker (GPU mode). In CPU mode it is only
   * remembered, for the next session to open on and for {@link beginExport}.
   */
  setCamera: (view: OrbitView, width: number, height: number) => void;
  /** Push render settings to the worker (GPU mode); remembered in CPU mode. */
  setRenderSettings: (settings: RenderSettings) => void;
  /**
   * The crease-pattern faces under a press or a box, from the worker's last
   * frame. GPU-render mode only — the canvas-2D fallback draws on the main
   * thread and answers its own picks — and null when there is no such frame,
   * or the session is gone.
   */
  pickFaces: (query: SimulatorPickQuery) => Promise<number[] | null>;
  /**
   * Hold exactly these faces in place. `forModel` is the model the ids were
   * read against: a request for any other is stale and answers null without
   * reaching the worker, so ids cannot land on the wrong model across a reload
   * or a segment switch. Requests are sent in order, so the newest set is the
   * one that stays. Rejects if the worker does; the caller decides what the
   * user is told.
   */
  setPinnedFaces: (
    faces: readonly number[],
    forModel: SimulatorModelView
  ) => Promise<SimulatorPinOutcome | null>;
  /**
   * Grip the paper under a press and start pulling it, or say why not. Null
   * when `forModel` is no longer the model on screen, or the session is gone.
   * `drawn` is the canvas-2D path's frame; the GPU path leaves it out.
   */
  beginPull: (
    at: SimulatorScreenPoint,
    forModel: SimulatorModelView,
    drawn?: SimulatorDrawnView
  ) => Promise<SimulatorPullStart | null>;
  /** Draw the pull toward where the cursor is now. Coalesced: the newest wins. */
  movePull: (at: SimulatorScreenPoint, drawn?: SimulatorDrawnView) => void;
  /** Let go: keep the shape as a pose, or put the paper back. */
  endPull: (outcome: PullOutcome) => Promise<SimulatorPullEndResult | null>;
  /** Let a pose spring back to the fold. */
  releasePose: () => Promise<boolean | null>;
  /**
   * Freeze the current view for the export dialog, or null when this runtime
   * holds no model.
   *
   * The worker keeps the frame: that is where the complete render state
   * lives, so a scene of it is one message rather than an exporter reaching
   * for positions, a camera and a palette from three different owners, and a
   * solver still settling changes nothing the dialog shows. Keeps the session
   * token private, like every other call here. The camera and settings last
   * handed to `setCamera` and `setRenderSettings` travel with the request,
   * which is what makes the file the view on screen on the canvas-2D path,
   * where the worker was never sent them.
   */
  beginExport: () => Promise<SimulatorExportSnapshot | null>;
}

export function useSimulatorRuntime(options: UseSimulatorRuntimeOptions): SimulatorRuntime {
  const {
    fold,
    foldProfile = null,
    solverOptions,
    triangulate = true,
    canvas = null,
    allowGpuRender = true,
    bitmapOutput = null,
    paused = false,
    onFrame,
  } = options;

  const [status, setStatus] = useState<SimulatorStatus>('idle');
  /**
   * Bumped to reload a model the worker no longer has. The cap should make this
   * unreachable — see MAX_LIVE_SESSIONS — so it is a recovery path, not a
   * routine one: it exists so that being evicted costs a reload rather than
   * leaving the window frozen and silent.
   */
  const [reloadNonce, setReloadNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<SimulatorModelView | null>(null);
  // The model the worker session holds now, for checking a pin request against
  // without waiting for a render.
  const modelRef = useRef<SimulatorModelView | null>(null);
  // Pin requests, chained so they reach the worker in the order they were made.
  const pinQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const [playing, setPlaying] = useState(false);
  const [gpuActive, setGpuActive] = useState(false);
  /**
   * Bumped when a committed canvas turns out to be unusable, to ask the consumer
   * for a fresh element. A canvas can only be committed once, so recovery is a
   * new element rather than a reset of this one.
   */
  const [canvasGeneration, setCanvasGeneration] = useState(0);

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
  // Whether the worker's camera has arrived at the shape as it is. The model
  // can settle before its camera does, and the camera only moves on a frame.
  const framedRef = useRef(true);
  const playingRef = useRef(false);
  const recycledRef = useRef<ArrayBuffer | undefined>(undefined);
  const generationRef = useRef(0);
  // The worker session this runtime loaded. Quoted on every later call, so that
  // when another consumer loads its own model in between, this runtime's replies
  // are dropped in the worker instead of arriving with the wrong geometry.
  const tokenRef = useRef<number | undefined>(undefined);
  // What this runtime last forwarded, so a new session can open on it. A
  // session is made by `load`, and the worker can only carry a view forward
  // from a session it still has — a fold that went null in between (a rebuild
  // that re-derives the artifacts) released the old one first, and the viewport
  // pushes only when the GPU path first turns on. The runtime is the one thing
  // that knows a session was replaced, so it re-asserts the inputs itself.
  const lastCameraRef = useRef<SimulatorCameraRequest | null>(null);
  const lastRenderSettingsRef = useRef<RenderSettings | null>(null);
  // A camera or settings redraw produces a new image but no new solver state, so
  // it reuses the last frame's scalars rather than inventing zeros — which would
  // make the readouts flicker every time the user orbits.
  const lastScalarsRef = useRef<Omit<SimulatorFrameView, 'bitmap'>>({
    positions: null,
    step: 0,
    stepsThisTick: 0,
    elapsedMs: 0,
    converged: true,
    foldPercent: 0,
    maxStrain: 0,
    recovered: null,
    posed: false,
    poseEnded: null,
  });
  // Kept in a ref so the play loop does not have to tear down and rebuild every
  // time the caller passes a new closure. Assigned in an effect rather than
  // during render, which is a real hazard: a ref written during render can be
  // left stale when React discards a render pass.
  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);
  // Only whether bitmap presentation is wanted takes part in loading; the size
  // itself is read at load time and changes thereafter through `setCamera`.
  const wantsBitmapOutput = bitmapOutput !== null;
  const bitmapOutputRef = useRef(bitmapOutput);
  useEffect(() => {
    bitmapOutputRef.current = bitmapOutput;
  });
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  /** Hand a model back to the worker, if there is one. Safe to call with none. */
  const releaseToken = useCallback((token: number | undefined) => {
    if (token === undefined) return;
    void clientRef.current?.release(token).catch(() => undefined);
  }, []);

  // A mounted runtime is exactly what "someone is using the simulator" means, so
  // the worker's lifetime is tied to it rather than to any particular panel.
  // Without this the worker — and its model, and one of the four WebGL2 contexts
  // a worker gets — outlived every consumer and stayed resident for the session.
  useEffect(() => {
    clientRef.current = retainSimulatorClient();
    return () => {
      // Hand back this runtime's model before dropping the worker reference, so
      // its textures go when the consumer does rather than waiting to be evicted
      // by whatever loads next.
      const token = tokenRef.current;
      const client = clientRef.current;
      if (token !== undefined && client) void client.release(token).catch(() => undefined);
      clientRef.current = null;
      releaseSimulatorClient();
    };
  }, []);

  const publish = useCallback((payload: Awaited<ReturnType<SimulatorClient['tick']>>) => {
    // Null means this call quoted a session that has since been replaced — the
    // ordinary outcome of focus moving to another simulation, not an error.
    if (!payload) return;
    // GPU-render mode: the worker already drew to the canvas and sent no
    // positions. Still surface the scalars (step, strain, fold percent) so the
    // readouts update; positions are null and there is nothing to draw here.
    const positions = payload.positions ? new Float32Array(payload.positions) : null;
    onFrameRef.current?.({
      positions,
      bitmap: payload.bitmap,
      step: payload.step,
      stepsThisTick: payload.stepsThisTick,
      elapsedMs: payload.elapsedMs,
      converged: payload.converged,
      foldPercent: payload.foldPercent,
      maxStrain: payload.maxStrain,
      recovered: payload.recovered,
      posed: payload.posed,
      poseEnded: payload.poseEnded,
    });
    convergedRef.current = payload.converged;
    framedRef.current = payload.framed;
    lastScalarsRef.current = {
      positions: null,
      step: payload.step,
      stepsThisTick: payload.stepsThisTick,
      elapsedMs: payload.elapsedMs,
      converged: payload.converged,
      foldPercent: payload.foldPercent,
      maxStrain: payload.maxStrain,
      // A redraw reuses these scalars, and must not report a recovery twice.
      recovered: null,
      posed: payload.posed,
      poseEnded: null,
    };
    // Give the buffer straight back to the worker on the next request so the
    // steady-state CPU loop allocates nothing. (Null in GPU mode.)
    recycledRef.current = payload.positions ?? undefined;
  }, []);

  // Load / reload whenever the source model changes.
  useEffect(() => {
    if (!fold) {
      setStatus('idle');
      // An error belongs to a model, and this one is gone: a rebuild that
      // passes through here must not keep reporting the failure it is fixing.
      setError(null);
      modelRef.current = null;
      setModel(null);
      // Nothing to show and nothing to render: hand the model back rather than
      // leaving it resident until something else pushes it out.
      releaseToken(tokenRef.current);
      tokenRef.current = undefined;
      return;
    }

    const generation = (generationRef.current += 1);
    const previousToken = tokenRef.current;
    let cancelled = false;
    setStatus('loading');
    setError(null);

    // Whether this *source* could use the GPU path at all: it needs somewhere to
    // draw, and a solver path the GPU renderer covers (no fold profile / Verlet).
    // Whether the machine can is a separate question, asked below.
    const gpuRenderPossible = Boolean((canvas || wantsBitmapOutput) && allowGpuRender);

    void (async () => {
      try {
        // Retained by the mount effect above; null only while unmounting.
        const client = clientRef.current;
        if (!client) return;

        // Ask the worker before committing the canvas, never the main thread.
        // Committing is irreversible -- a transferred canvas is in placeholder
        // mode for good, a `bitmaprenderer` context is exclusive -- so a wrong
        // answer here does not cost a slow render path, it costs the canvas. The
        // canvas-2D fallback then cannot draw on its own canvas: it throws
        // `InvalidStateError` on the transferred one and silently no-ops on the
        // bitmap one. See `workerGpuSupport`.
        const wantsGpu = gpuRenderPossible && (await ensureWorkerGpuSupport());
        if (cancelled || generation !== generationRef.current) return;

        if (wantsGpu && bitmapOutputRef.current) {
          await client.attachBitmapOutput(
            bitmapOutputRef.current.width,
            bitmapOutputRef.current.height
          );
        } else if (wantsGpu && canvas && transferredCanvasRef.current !== canvas) {
          const offscreen = canvas.transferControlToOffscreen();
          await client.attachCanvas(transfer(offscreen, [offscreen]));
          transferredCanvasRef.current = canvas;
        }

        const info = await client.load(fold, {
          prepare: { triangulate },
          solver: { ...solverOptions, foldProfile },
          preferGpu: wantsGpu,
          // Open on what was last forwarded, so a replacement session's first
          // frame is already right. Nothing yet on a first load, which the
          // viewport covers when the GPU path turns on.
          view: {
            camera: lastCameraRef.current ?? undefined,
            settings: lastRenderSettingsRef.current ?? undefined,
          },
        });
        // A load that has been cancelled or superseded still *made* a session in
        // the worker — `load` registers it before it returns. Abandoning the
        // token here leaks it: nothing else holds a reference, so it stays
        // resident until the cap evicts it, taking a live window's session with
        // it. StrictMode makes that one leak per mount, which halved the
        // effective residency cap and had every eleventh window kill the first.
        //
        // Released through the `client` captured above, not `releaseToken`: that
        // reads `clientRef.current`, and on unmount the retaining effect — which
        // is declared first, so it cleans up first — has already nulled it. The
        // release would silently no-op in exactly the StrictMode case that needs
        // it most.
        if (cancelled || generation !== generationRef.current) {
          void client.release(info.token).catch(() => undefined);
          return;
        }
        // Each load makes a new model; the one this runtime had is now nobody's.
        // Released only once the replacement exists, so the window is never
        // briefly backed by nothing.
        releaseToken(previousToken);
        tokenRef.current = info.token;

        // The worker's own answer outranks the probe's. A load made with
        // `preferGpu` that comes back on the reference solver means the canvas
        // just committed can never be drawn on -- not by the worker, which has no
        // GL, and not here, because committing is irreversible. Record that and
        // remount a clean canvas.
        //
        // This is the recovery for causes a probe cannot see coming: the GL
        // context cap evicting this session, or a driver losing the context
        // between the probe and the load. It cannot loop, because the reload runs
        // against a cache this just set to false, so it takes the fallback rather
        // than committing a second canvas the same way.
        //
        // Only the transferred path needs a new element. A bitmap-output consumer
        // holds a `bitmaprenderer` canvas it chose from `useWorkerGpuSupport`,
        // which the same call has just flipped -- so it re-renders into its own
        // no-GPU state without this runtime reaching into it.
        if (wantsGpu && info.backend !== 'webgl2') {
          markWorkerGpuUnsupported();
          if (canvas && transferredCanvasRef.current === canvas) {
            setCanvasGeneration((value) => value + 1);
          }
          return;
        }

        const gpu = info.backend === 'webgl2' && wantsGpu;
        gpuActiveRef.current = gpu;
        setGpuActive(gpu);
        const loaded: SimulatorModelView = {
          ...inflateRenderModel(info),
          edgeCount: info.edgeCount,
          creaseCount: info.creaseCount,
          diagnostics: info.diagnostics,
          backend: info.backend,
        };
        modelRef.current = loaded;
        setModel(loaded);
        setStatus('ready');

        // Settle the opening state before the first paint so the panel does not
        // flash a flat sheet. Bounded deliberately: at foldPercent 0 this
        // converges within a few dozen steps, and an unbounded settle would tie
        // the worker up for seconds on a model that oscillates above epsilon.
        const first = await client.settle(2000, { token: tokenRef.current });
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
    // `solverOptions` is deliberately absent -- reloading the model would throw
    // away the current fold -- and so is `bitmapOutput`: it carries a size, and a
    // size change must not reload. It used to be a dependency, so every time a
    // window crossed a size step the whole thing re-loaded and re-settled, which
    // both restarted a fold meant to be still and left the previous frame
    // stretched while it happened. Later sizes ride on `setCamera`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fold,
    foldProfile,
    triangulate,
    canvas,
    allowGpuRender,
    wantsBitmapOutput,
    publish,
    reloadNonce,
  ]);

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
      // Frozen: the caller wants this model held where it is. It still renders
      // on demand, it just does not advance.
      if (pausedRef.current) return;
      // Idle: nothing to solve, nothing playing, and the camera where it is going.
      if (convergedRef.current && framedRef.current && !playingRef.current) return;

      inFlightRef.current = true;
      const recycled = recycledRef.current;
      recycledRef.current = undefined;
      const dispatched = performance.now();
      const quoted = tokenRef.current;
      void client
        .tick(recycled ? { recycled, token: quoted } : { token: quoted })
        .then((payload) => {
          // Round-trip: dispatch -> worker tick -> reply. If the solver loop is
          // slow because the worker tick is slow (e.g. a GPU pipeline stall),
          // this is high; if it is fast but ticks are still infrequent, the
          // throttle is on the main thread.
          recordSimulatorProbe('tickRoundTrip', performance.now() - dispatched);
          // A null reply means the worker does not know this token. Usually that
          // is our own newer load having replaced it, which `publish` ignores —
          // but if the token we quoted is *still* the one we hold, nothing of
          // ours replaced it and the worker dropped our model: we were evicted
          // past the residency cap.
          //
          // Load it again rather than sitting on a dead token. Without this the
          // window keeps reporting 'ready' while every frame it asks for is
          // discarded, so it freezes with no error anywhere — which is exactly
          // how the session leak presented, and why it took so long to find.
          // Setting 'loading' also stops this loop, so one eviction costs one
          // reload rather than a tick-per-frame spin.
          if (payload === null && quoted !== undefined && quoted === tokenRef.current) {
            setStatus('loading');
            setReloadNonce((nonce) => nonce + 1);
            return;
          }
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
      retarget((client) => client.setFoldPercent(percent, tokenRef.current));
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
      retarget((client) => client.setMaterial(materialOptions, tokenRef.current));
    },
    [retarget]
  );

  // One round-trip, not two: the session zeroes the fold target as part of
  // resetting, so there is no window in which the worker holds flat paper and a
  // stale target and springs the two together.
  const reset = useCallback(() => {
    setPlaying(false);
    retarget((client) => client.reset(tokenRef.current));
  }, [retarget]);

  // Orbit/zoom and view-setting changes forward to the worker, which redraws
  // from the position texture. No solver work, no readback -- this is what makes
  // camera manipulation cheap at any model size. Still non-blocking for the
  // pointer handler, which is what "fire-and-forget" meant here; what changed is
  // that the number of forgotten messages is now bounded.
  /**
   * At most one camera message outstanding, with the newest view queued behind
   * it. The loop is self-clocking: the next send is triggered by the previous
   * reply, so the rate matches whatever the worker can actually draw.
   *
   * This used to dispatch unconditionally, once per pointermove. That is not a
   * throttle, it is an unbounded queue — measured on the desktop shell at 108
   * moves/s against ~40 renders/s, which peaked at 164 messages in flight and
   * kept painting for 3.0s after the pointer came up. Each render was
   * individually fine, which is why every per-render average looked healthy
   * throughout.
   *
   * Dropping the intermediate views is not an approximation: a camera is
   * absolute state, not a delta, so the newest one is the only one whose picture
   * anyone wants. Coalescing to the latest is lossless in the only sense that
   * matters — and `moves` vs `msgs` in the orbit readout is what shows it
   * working.
   */
  const cameraBusyRef = useRef(false);
  const pendingCameraRef = useRef<SimulatorCameraRequest | null>(null);

  // A named function expression so the trailing send can call itself, and
  // `useCallback([])` because it closes over refs only — no prop, no state. That
  // is also why it is not a ref assigned during render, which this file avoids
  // deliberately (see `onFrameRef`): a ref written during render can be left
  // stale when React discards a render pass.
  const sendCamera = useCallback(function send(payload: SimulatorCameraRequest): void {
    // Read once rather than through `?.`: optional chaining short-circuits the
    // whole chain, so a null client would skip the `finally` too and leave both
    // the in-flight count and `cameraBusyRef` permanently stuck.
    const client = clientRef.current;
    if (!client) return;
    cameraBusyRef.current = true;
    // Time the synchronous main-thread cost of dispatching the camera message
    // (comlink proxy + structured clone). If orbit lag lives on the main thread,
    // it shows up here.
    const started = performance.now();
    // And separately, the wait for the reply — see `beginCameraMessage`. Kept
    // now that the queue is bounded, because it is what would show the bound
    // being lost again.
    const message = beginCameraMessage();
    void client
      .setCamera(payload, tokenRef.current)
      .then((bitmap) => {
        // Bitmap-present mode: an orbit redraw comes back as a frame, and the
        // consumer has to be handed it or the view would not move.
        if (bitmap) onFrameRef.current?.({ ...lastScalarsRef.current, bitmap });
      })
      .catch(() => undefined)
      .finally(() => {
        endCameraMessage(message);
        cameraBusyRef.current = false;
        const next = pendingCameraRef.current;
        pendingCameraRef.current = null;
        // Trailing send, so the view the gesture ended on is always drawn.
        // Without it a coalesced run would settle on whatever the last
        // *dispatched* frame happened to be, leaving the model a few degrees
        // from where the pointer was released.
        if (next) send(next);
      });
    recordSimulatorProbe('cameraDispatch', performance.now() - started);
  }, []);

  const setCamera = useCallback(
    (view: OrbitView, width: number, height: number) => {
      const payload = { view, width, height };
      // Remembered before the gate: it is the consumer's view either way, the
      // next session opens on it, and an export is taken from it. On the
      // canvas-2D path this is all that happens — the frame is drawn on the main
      // thread, so an orbit costs no worker message.
      lastCameraRef.current = payload;
      if (!gpuActiveRef.current) return;
      if (cameraBusyRef.current) {
        pendingCameraRef.current = payload;
        return;
      }
      sendCamera(payload);
    },
    [sendCamera]
  );

  const setRenderSettings = useCallback((settings: RenderSettings) => {
    lastRenderSettingsRef.current = settings;
    if (!gpuActiveRef.current) return;
    void clientRef.current
      ?.setRenderSettings(settings, tokenRef.current)
      .then((bitmap) => {
        if (bitmap) onFrameRef.current?.({ ...lastScalarsRef.current, bitmap });
      })
      .catch(() => undefined);
  }, []);

  const pickFaces = useCallback(async (query: SimulatorPickQuery): Promise<number[] | null> => {
    const client = clientRef.current;
    if (!client || !gpuActiveRef.current || tokenRef.current === undefined) return null;
    return client.pickFaces(query, tokenRef.current);
  }, []);

  const setPinnedFaces = useCallback(
    (faces: readonly number[], forModel: SimulatorModelView): Promise<SimulatorPinOutcome | null> => {
      const send = async (): Promise<SimulatorPinOutcome | null> => {
        const client = clientRef.current;
        // Checked when the request's turn comes, not when it was made: the
        // model may have been replaced by a request queued ahead of it.
        if (!client || modelRef.current !== forModel || tokenRef.current === undefined) return null;
        const result = await client.setPinnedFaces([...faces], tokenRef.current);
        if (!result) return null;
        // Bitmap-present mode: the redraw comes back as a frame.
        if (result.bitmap) onFrameRef.current?.({ ...lastScalarsRef.current, bitmap: result.bitmap });
        return { applied: result.applied, dropped: result.dropped };
      };
      const sent = pinQueueRef.current.then(send, send);
      pinQueueRef.current = sent.catch(() => undefined);
      return sent;
    },
    []
  );

  /**
   * A pull's moves, coalesced as camera messages are: at most one in flight,
   * the newest waiting behind it. A pull's begin, moves and end reach the worker
   * in the order they were sent, so a move needs no wait for its begin; the
   * lane only stops moves outliving their pull.
   */
  const pullLaneRef = useRef<{ open: boolean; moving: boolean; pending: PullMove | null }>({
    open: false,
    moving: false,
    pending: null,
  });

  const sendPullMove = useCallback(function send(move: PullMove): void {
    const client = clientRef.current;
    const lane = pullLaneRef.current;
    if (!client || !lane.open) return;
    lane.moving = true;
    convergedRef.current = false;
    void client
      .movePull(move.at, move.drawn, tokenRef.current)
      .catch(() => undefined)
      .finally(() => {
        lane.moving = false;
        const next = lane.pending;
        lane.pending = null;
        if (next) send(next);
      });
  }, []);

  const beginPull = useCallback(
    async (
      at: SimulatorScreenPoint,
      forModel: SimulatorModelView,
      drawn?: SimulatorDrawnView
    ): Promise<SimulatorPullStart | null> => {
      const client = clientRef.current;
      const lane = pullLaneRef.current;
      lane.pending = null;
      if (!client || modelRef.current !== forModel || tokenRef.current === undefined) {
        lane.open = false;
        return null;
      }
      lane.open = true;
      convergedRef.current = false;
      try {
        const result = await client.beginPull(at, drawn, tokenRef.current);
        if (result?.outcome !== 'pulling') lane.open = false;
        return result?.outcome ?? null;
      } catch (cause) {
        lane.open = false;
        throw cause;
      }
    },
    []
  );

  const movePull = useCallback(
    (at: SimulatorScreenPoint, drawn?: SimulatorDrawnView) => {
      const lane = pullLaneRef.current;
      if (!lane.open) return;
      if (lane.moving) {
        lane.pending = { at, drawn };
        return;
      }
      sendPullMove({ at, drawn });
    },
    [sendPullMove]
  );

  const endPull = useCallback(async (outcome: PullOutcome): Promise<SimulatorPullEndResult | null> => {
    const lane = pullLaneRef.current;
    lane.open = false;
    lane.pending = null;
    const client = clientRef.current;
    if (!client || tokenRef.current === undefined) return null;
    convergedRef.current = false;
    return client.endPull(outcome, tokenRef.current);
  }, []);

  const releasePose = useCallback(async (): Promise<boolean | null> => {
    const client = clientRef.current;
    if (!client || tokenRef.current === undefined) return null;
    convergedRef.current = false;
    return client.releasePose(tokenRef.current);
  }, []);

  const beginExport = useCallback(async (): Promise<SimulatorExportSnapshot | null> => {
    const client = clientRef.current;
    if (!client || tokenRef.current === undefined) return null;
    // The worker holds the frame in device pixels; the ratio the viewport sized
    // it by is what takes the page back to CSS pixels.
    //
    // The view goes with the request. On the GPU path the worker already has
    // it, bar a camera still queued behind an in-flight one (`pendingCameraRef`),
    // and this is the newest. On the canvas-2D path the worker was never sent
    // either, so without them the file would be the worker's defaults at the
    // opening camera rather than what is on screen.
    const snapshot = await client.beginExportSnapshot({
      token: tokenRef.current,
      devicePixelRatio: simulatorDevicePixelRatio(),
      camera: lastCameraRef.current ?? undefined,
      settings: lastRenderSettingsRef.current ?? undefined,
    });
    if (snapshot === null) return null;
    return {
      scene: (options) => client.exportScene(snapshot, options),
      // A worker that has gone takes its snapshots with it.
      release: () => void client.endExportSnapshot(snapshot).catch(() => undefined),
    };
  }, []);

  // Opt-in perf logging: set `oristudio:sim-perf` to `1` in localStorage, then
  // reload. Shared with every other simulator surface — see
  // `useSimulatorPerfLog`, which is one poller per page rather than one per
  // runtime, because the worker's counters are global and reading them resets
  // them.
  useSimulatorPerfLog();

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
    canvasGeneration,
    setCamera,
    setRenderSettings,
    pickFaces,
    setPinnedFaces,
    beginPull,
    movePull,
    endPull,
    releasePose,
    beginExport,
  };
}

/** One move of a pull: where the cursor is, and the frame it is measured against. */
interface PullMove {
  at: SimulatorScreenPoint;
  drawn?: SimulatorDrawnView;
}
