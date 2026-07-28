import { transfer } from 'comlink';
import { PreparedModelCache } from '../lib/preparedModelCache';
import { MAX_CONCURRENT_SIMULATIONS } from './simulatorLimits';
import {
  OrigamiModel,
  ReferenceSolver,
  SimulationClock,
  WebglSolver,
  cameraUniforms,
  centroid,
  boundingRadius,
  prepareFoldModel,
  type FoldDocument,
  type FoldProfile,
  type OrbitView,
  type PrepareFoldOptions,
  type RenderSettings,
  type SimulatorDiagnostics,
  type SimulatorOptions,
  type SolverBackend,
} from '@treemaker/origami-simulator';

// The simulator's solver, off the main thread.
//
// Before this, the whole simulation ran inside requestAnimationFrame on the
// main thread with a fixed step count, so a single play tick on a 1089-vertex
// model took ~780ms and the tab stopped responding. The solver is not faster
// here -- that is the GPU port's job -- but it no longer competes with the UI,
// which is the difference between "slow" and "frozen".
//
// Control flows over comlink like every other worker in this app. Frame data
// does not: positions move as transferable ArrayBuffers that the caller hands
// back for reuse, so a 60fps loop performs no allocation and no structured
// clone. Deliberately NOT a SharedArrayBuffer ring -- see the plan; the GPU
// backend removes this transport entirely, so it only ever serves the
// no-WebGL2 fallback and simple is the right trade.

export type SimulatorBackendId = 'webgl2' | 'reference';

export interface SimulatorLoadOptions {
  prepare?: PrepareFoldOptions;
  solver?: SimulatorOptions;
  /** Solver milliseconds per tick. Higher than the main thread could afford. */
  budgetMs?: number;
  convergenceEpsilon?: number;
  /** Force the CPU reference backend (debugging, or a known-bad driver). */
  preferGpu?: boolean;
  /** GPU steps per tick (bounds async GPU work; overrides the default). */
  gpuStepsPerTick?: number;
  /**
   * Stable identity of this fold, so re-loading it skips `prepareFoldModel`.
   *
   * Switching the focused inline window means loading its model again, and
   * preparation is the expensive part — triangulation, edge indexing, crease
   * params — where stepping the solver afterwards is not. Omit it and every load
   * prepares from scratch, which is right for a source that actually changed.
   */
  modelKey?: string;
}

/**
 * Steps per GPU tick. Small enough that one tick's shader passes finish well
 * inside a frame (so the convergence readback barely stalls), large enough that
 * the fold still converges in well under a second at 60 ticks/s.
 */
const GPU_STEPS_PER_TICK = 80;

/** Orbit view + viewport + look, forwarded from the panel for worker-side rendering. */
export interface SimulatorCamera {
  view: OrbitView;
  /** Drawing-buffer size in device pixels. */
  width: number;
  height: number;
}

/**
 * Everything the render side needs about topology, as flat typed arrays.
 *
 * The worker owns the prepared model now, so the main thread cannot reach into
 * it. Rather than ship a structured clone of arrays-of-arrays (which for a
 * 19k-edge model is tens of thousands of tiny objects), topology crosses once
 * at load as transferable buffers and is inflated on the other side.
 */
export interface SimulatorModelInfo {
  vertexCount: number;
  faceCount: number;
  edgeCount: number;
  creaseCount: number;
  /** Triangle indices, 3 per face. */
  indices: ArrayBuffer;
  /** 2 vertex indices per edge. */
  edgesVertices: ArrayBuffer;
  /** One {@link EDGE_ASSIGNMENT_CODES} index per edge. */
  edgesAssignment: ArrayBuffer;
  /** 3 edge indices per (triangulated) face; -1 where an edge was not found. */
  facesEdges: ArrayBuffer;
  diagnostics: SimulatorDiagnostics;
  /** Which solver actually got selected, for the UI's backend indicator. */
  backend: SimulatorBackendId;
  /** Quote this on later calls; see {@link SimulatorSessionToken}. */
  token: SimulatorSessionToken;
}

/** Index -> FOLD assignment letter, shared with the render side. */
export const EDGE_ASSIGNMENT_CODES = ['B', 'M', 'V', 'F', 'U', 'C', 'J'] as const;

export interface SimulatorFramePayload {
  /**
   * xyz per vertex. Transferred; hand it back via `recycled` to avoid churn.
   * Null in GPU-render mode — the worker drew straight to the canvas and the
   * main thread needs no positions.
   */
  positions: ArrayBuffer | null;
  /** rgb per vertex, only present when colours were requested. */
  colors: ArrayBuffer | null;
  /** True when the worker rendered this frame itself (GPU-render mode). */
  renderedInWorker: boolean;
  /**
   * The rendered frame, in bitmap-present mode. Transferred; the caller hands it
   * to a `bitmaprenderer` canvas. Null when the worker drew straight to a
   * transferred canvas, or when there was nothing to draw.
   */
  bitmap: ImageBitmap | null;
  step: number;
  stepsThisTick: number;
  elapsedMs: number;
  converged: boolean;
  maxVelocity: number;
  foldPercent: number;
  /**
   * Peak per-node mean axial strain for this frame, as a fraction. Computed once
   * per frame rather than per step, and defined identically on both backends so
   * the readout does not change meaning with the solver.
   */
  maxStrain: number;
}

/** Folded geometry snapshot handed to the exporters. */
export interface SimulatorExportGeometry {
  /** xyz per vertex, in the solver's normalized (centered, unit-radius) space. */
  positions: ArrayBuffer;
  /** 3 vertex indices per triangle. */
  triangles: ArrayBuffer;
  vertexCount: number;
  /** Fold percent the snapshot was taken at, for the exported file's metadata. */
  foldPercent: number;
}

interface Session {
  model: OrigamiModel;
  backend: SolverBackend;
  backendId: SimulatorBackendId;
  clock: SimulationClock;
  positionScratch: Float32Array;
  colorScratch: Float32Array;
  foldPercent: number;
  /**
   * Present only when the panel transferred its canvas and the GPU solver was
   * selected: the solver renders straight to that canvas in the worker, so no
   * positions are transferred to the main thread. Absent means the panel draws
   * on the main thread from transferred positions (canvas-2D fallback).
   */
  gpuRender: GpuRenderState | null;
}

interface GpuRenderState {
  solver: WebglSolver;
  view: OrbitView;
  width: number;
  height: number;
  settings: RenderSettings;
  /** Camera fit, computed once from the settled model. */
  center: [number, number, number];
  radius: number;
  fitted: boolean;
}

const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  frontColor: [0.31, 0.51, 0.84],
  backColor: [0.95, 0.94, 0.9],
  mountainColor: [0.86, 0.12, 0.14],
  valleyColor: [0.11, 0.36, 0.85],
  borderColor: [0.16, 0.18, 0.2],
  lightDir: [-0.45, 0.58, 0.68],
  background: [0.05, 0.06, 0.07],
  showFaces: true,
  showEdges: true,
  lighting: true,
  creaseWidthPx: 3,
  faceAlpha: 1,
};

/**
 * Identifies one loaded model, handed back by `load` and quoted by every later
 * call.
 *
 * The worker holds a single live session, and more than one consumer can ask it
 * to load: the Simulate panel, and any of the inline simulation windows on the
 * Edit canvas. Those calls are asynchronous, so a `tick` dispatched by the
 * window that just lost focus can arrive after its successor has loaded — and
 * would otherwise be answered with the *new* model's geometry, which the caller
 * would happily draw into the old window. Quoting a token makes that arrival
 * identifiable, and it is dropped instead.
 */
export type SimulatorSessionToken = number;

/**
 * Every loaded model, newest last. Keyed by the token `load` handed back.
 *
 * Originally there was one. That was enough while an unfocused inline simulation
 * only ever had to hold still: it kept the last frame its canvas received, which
 * costs nothing. But the crease-pattern camera keeps moving underneath it — pan
 * and zoom resize the window — and a bitmap rendered for the old size is then
 * scaled, so the fold goes soft when zoomed in and its creases go to threads
 * when zoomed out.
 *
 * Re-rendering needs the mesh, and the mesh lives in solver textures, so the
 * sessions have to stay. They are cheap to keep and cheap to draw: bitmap
 * presentation means they share a single GL context, and a settled model spends
 * no solver budget. Only the focused window ticks; the rest cost a draw when the
 * camera moves them, which is the whole point.
 */
const sessions = new Map<SimulatorSessionToken, Session>();
let sessionToken: SimulatorSessionToken = 0;

/**
 * How many models stay resident.
 *
 * The same limit the UI uses to cap open windows, so nothing is ever evicted in
 * practice and a window cannot lose its session while it is still on screen. The
 * eviction path exists so a caller that ignores the cap degrades to a stale
 * frame rather than exhausting memory.
 */
const MAX_LIVE_SESSIONS = MAX_CONCURRENT_SIMULATIONS;

/** The most recently loaded session, for callers with no token to quote. */
function latestSession(): Session | null {
  let latest: Session | null = null;
  for (const candidate of sessions.values()) latest = candidate;
  return latest;
}

function disposeSession(token: SimulatorSessionToken): void {
  const existing = sessions.get(token);
  if (!existing) return;
  existing.backend.dispose();
  sessions.delete(token);
}

/** Drop the oldest sessions until the cap is met. */
function evictBeyondCap(): void {
  while (sessions.size > MAX_LIVE_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    disposeSession(oldest);
  }
}

/**
 * Prepared models kept across loads, keyed by the caller's `modelKey`.
 *
 * Bounded, because a prepared model is the triangulated mesh plus its adjacency
 * — tens of megabytes on a large crease pattern — so an unbounded cache would
 * simply move the memory problem rather than solve it. Four is enough to make
 * alternating between a handful of open windows feel instant.
 */
const preparedModels = new PreparedModelCache(4);

/**
 * Set when the live session's GL context is lost, and cleared by the next
 * successful load.
 *
 * A lost context does not throw — GL calls become no-ops and reads return
 * zeros — so the solver would go on "converging" a flat, motionless mesh and the
 * panel would show a settled fold that is simply wrong. Failing every subsequent
 * call with this message routes it to the runtime's error state instead, which
 * is the only honest thing to show.
 */
let sessionFailure: string | null = null;

/**
 * The surface the GPU solver's context lives on, and how its frames get out.
 *
 * `'canvas'` — the caller transferred its own canvas via
 * `transferControlToOffscreen`. The worker draws straight to it and nothing
 * crosses back. One canvas can only be transferred once, so it is held here and
 * reused across model reloads.
 *
 * `'bitmap'` — the worker owns a private OffscreenCanvas and hands each frame
 * out as an ImageBitmap. This costs one transfer per frame, and buys the thing
 * inline windows need: **one** GL context serving any number of on-screen
 * surfaces, because the receiving canvases take a `bitmaprenderer` context,
 * which is not a WebGL context and so does not count against the four a worker
 * gets. Measured at 0.011ms per 512px frame — see `__simCapabilityProbe`.
 */
type PresentMode = 'canvas' | 'bitmap';

let renderCanvas: OffscreenCanvas | null = null;
let presentMode: PresentMode = 'canvas';

export interface PerfSnapshot {
  windowMs: number;
  backend: SimulatorBackendId;
  gpuRender: boolean;
  /** GPU draws issued this window (settle/tick + every setCamera/setRenderSettings). */
  renders: number;
  renderAvgMs: number;
  renderMaxMs: number;
  /** setCamera calls this window — the orbit/zoom message rate. */
  cameraCalls: number;
  /** Solver ticks (budgeted frames) this window. */
  ticks: number;
  /** Models resident in the worker. Only the focused one ticks; the rest draw. */
  liveSessions: number;
  solveAvgMs: number;
  solveMaxMs: number;
  stepsTotal: number;
}

// Cheap counters, always on (a few adds per op). getPerfStats() reads and
// resets them; the runtime only polls when the debug flag is set.
const perf = {
  windowStart: 0,
  renders: 0,
  renderTotalMs: 0,
  renderMaxMs: 0,
  cameraCalls: 0,
  ticks: 0,
  solveTotalMs: 0,
  solveMaxMs: 0,
  stepsTotal: 0,
};

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function resetPerf(at: number): void {
  perf.windowStart = at;
  perf.renders = 0;
  perf.renderTotalMs = 0;
  perf.renderMaxMs = 0;
  perf.cameraCalls = 0;
  perf.ticks = 0;
  perf.solveTotalMs = 0;
  perf.solveMaxMs = 0;
  perf.stepsTotal = 0;
}

function requireSession(): Session {
  if (sessionFailure) throw new Error(sessionFailure);
  const latest = latestSession();
  if (!latest) throw new Error('Simulator worker: no model loaded');
  return latest;
}

/**
 * The live session, or null when `token` refers to one that has been replaced.
 *
 * Callers that quote a stale token get a no-op rather than an error: being
 * superseded is the normal outcome of moving focus between inline windows, not a
 * fault worth surfacing.
 */
function sessionFor(token: SimulatorSessionToken | undefined): Session | null {
  if (sessionFailure) throw new Error(sessionFailure);
  if (token === undefined) return latestSession();
  return sessions.get(token) ?? null;
}

/**
 * Pick the solver backend.
 *
 * When the panel transfers its canvas (`renderCanvas`) and the model uses the
 * standard uniform fold target, the GPU solver runs *on that canvas* and renders
 * to it in the worker — positions never touch the CPU. A fold profile (our
 * addition, which the GPU path does not express), a Verlet request,
 * `preferGpu: false`, or no canvas / no WebGL2 falls back to the reference
 * solver with main-thread canvas-2D rendering.
 */
function createBackend(
  model: OrigamiModel,
  options: SimulatorLoadOptions,
  renderCanvas: OffscreenCanvas | null
): { backend: SolverBackend; backendId: SimulatorBackendId; gpuSolver: WebglSolver | null } {
  const solverOptions = options.solver ?? {};
  const hasFoldProfile = Boolean(solverOptions.foldProfile?.ranges?.length);

  // Verlet used to force the CPU backend; the GPU solver implements it now, so
  // only a fold profile (segment/sequence-step simulation) still needs the
  // reference solver.
  if (renderCanvas && options.preferGpu !== false && !hasFoldProfile) {
    try {
      if (WebglSolver.isSupported(renderCanvas)) {
        const solver = new WebglSolver(renderCanvas, model, solverOptions);
        solver.onContextLost(() => {
          sessionFailure =
            'The graphics context was lost, so the simulation stopped. Reload the model to restart it.';
        });
        return { backend: solver, backendId: 'webgl2', gpuSolver: solver };
      }
    } catch {
      // Any GPU setup failure (driver bug, lost context) falls through to the
      // reference solver rather than breaking the simulator.
    }
  }
  return {
    backend: new ReferenceSolver(model, solverOptions),
    backendId: 'reference',
    gpuSolver: null,
  };
}

/**
 * Reuse the caller's returned buffer when it is the right size, otherwise
 * allocate. Steady state performs zero allocation; a resize costs one.
 */
function scratchFrom(recycled: ArrayBuffer | undefined, floats: number): Float32Array {
  if (recycled && recycled.byteLength === floats * 4) return new Float32Array(recycled);
  return new Float32Array(floats);
}

const api = {
  /**
   * Transfer a caller-owned canvas to the worker, once. The solver renders
   * straight to it and no pixels cross back.
   */
  attachCanvas(canvas: OffscreenCanvas): void {
    renderCanvas = canvas;
    presentMode = 'canvas';
  },

  /**
   * Render into a worker-private canvas and hand each frame back as an
   * ImageBitmap, instead of drawing to a transferred one.
   *
   * This is what lets many on-screen surfaces share a single GL context: the
   * receiving canvases hold `bitmaprenderer` contexts, which do not count
   * against the four WebGL contexts a worker is allowed. Resizing reuses the
   * same canvas, so switching size does not churn the context.
   */
  attachBitmapOutput(width: number, height: number): void {
    if (renderCanvas && presentMode === 'bitmap') {
      // Grow-only, like every other size request in this mode — see
      // {@link sizeRenderCanvas}. Shrinking here would hand the reallocation
      // back on the next window that wants the larger size.
      sizeRenderCanvas(width, height);
      return;
    }
    renderCanvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
    presentMode = 'bitmap';
  },

  load(fold: FoldDocument, options: SimulatorLoadOptions = {}): SimulatorModelInfo {
    // Carry the panel's camera and render settings across reloads. The panel
    // only pushes them when the GPU path first turns on, so a plain reset here
    // would make every segment switch snap back to the default view and the
    // default (blue) front colour until the next user interaction. Only the fit
    // (center/radius) is model-specific and recomputed by refitOnce.
    // Carried from the most recent session, not from one being replaced: a load
    // no longer displaces anything, so this is only about a new model opening
    // with the camera and palette already in use rather than the defaults.
    const previous = latestSession()?.gpuRender;
    // A fresh load gets a fresh context, so a previous loss is no longer the
    // truth about this session.
    sessionFailure = null;
    sessionToken += 1;

    // prepareFoldModel runs here rather than on the main thread: it is O(n)
    // heavy (earcut triangulation, edge indexing) and used to block the UI
    // before a single solver step had run. Prepared models are immutable, so a
    // keyed one is safe to share between loads; solver state is not cached and a
    // fresh backend is always built, so no fold state leaks across a switch.
    const prepareOptions = options.prepare ?? { triangulate: true };
    const prepared = options.modelKey
      ? preparedModels.get(options.modelKey, () => prepareFoldModel(fold, prepareOptions))
      : prepareFoldModel(fold, prepareOptions);
    const model = new OrigamiModel(prepared);
    const { backend, backendId, gpuSolver } = createBackend(model, options, renderCanvas);
    // The GPU tick is bounded by a fixed step COUNT, not a CPU-time budget. GPU
    // commands are async, so a CPU-time budget queues an unbounded pile of work
    // that the next convergence readback then has to flush in one synchronous
    // stall -- which was turning ~60 small ticks/s into ~4 giant ones. A modest
    // fixed count keeps each tick's GPU work small and the loop smooth. The CPU
    // reference solver keeps the time budget, which is correct for synchronous
    // work.
    const clock = new SimulationClock(
      gpuSolver
        ? {
            budgetMs: 1000, // effectively unlimited; the step cap is the real bound
            maxStepsPerFrame: options.gpuStepsPerTick ?? GPU_STEPS_PER_TICK,
            chunkSteps: 20,
            convergenceEpsilon: options.convergenceEpsilon,
          }
        : {
            budgetMs: options.budgetMs ?? 10,
            convergenceEpsilon: options.convergenceEpsilon,
          }
    );

    const created: Session = {
      model,
      backend,
      backendId,
      clock,
      positionScratch: new Float32Array(prepared.vertexCount * 3),
      colorScratch: new Float32Array(prepared.vertexCount * 3),
      foldPercent: options.solver?.foldPercent ?? 0,
      gpuRender:
        gpuSolver && renderCanvas
          ? {
              solver: gpuSolver,
              view: previous?.view ?? { yaw: 0, pitch: 0.38, zoom: 1 },
              width: previous?.width ?? renderCanvas.width,
              height: previous?.height ?? renderCanvas.height,
              settings: previous?.settings ?? DEFAULT_RENDER_SETTINGS,
              center: [0, 0, 0],
              radius: 1,
              fitted: false,
            }
          : null,
    };
    sessions.set(sessionToken, created);
    evictBeyondCap();

    const indices = prepared.indices.slice();

    const edgesVertices = new Int32Array(prepared.edgesVertices.length * 2);
    const edgesAssignment = new Uint8Array(prepared.edgesVertices.length);
    prepared.edgesVertices.forEach((edge, index) => {
      edgesVertices[index * 2] = edge[0];
      edgesVertices[index * 2 + 1] = edge[1];
      const code = EDGE_ASSIGNMENT_CODES.indexOf(
        prepared.edgesAssignment[index] ?? 'U'
      );
      edgesAssignment[index] = code < 0 ? EDGE_ASSIGNMENT_CODES.indexOf('U') : code;
    });

    const facesEdges = new Int32Array(prepared.faceCount * 3);
    facesEdges.fill(-1);
    prepared.facesEdges.forEach((face, faceIndex) => {
      for (let i = 0; i < 3 && i < face.length; i += 1) {
        facesEdges[faceIndex * 3 + i] = face[i] ?? -1;
      }
    });

    return transfer(
      {
        vertexCount: prepared.vertexCount,
        faceCount: prepared.faceCount,
        edgeCount: prepared.edgeCount,
        creaseCount: prepared.creaseParams.length,
        indices: indices.buffer as ArrayBuffer,
        edgesVertices: edgesVertices.buffer as ArrayBuffer,
        edgesAssignment: edgesAssignment.buffer as ArrayBuffer,
        facesEdges: facesEdges.buffer as ArrayBuffer,
        diagnostics: backend.readDiagnostics(),
        backend: backendId,
        token: sessionToken,
      },
      [
        indices.buffer as ArrayBuffer,
        edgesVertices.buffer as ArrayBuffer,
        edgesAssignment.buffer as ArrayBuffer,
        facesEdges.buffer as ArrayBuffer,
      ]
    );
  },

  setFoldPercent(percent: number, token?: SimulatorSessionToken): void {
    const active = sessionFor(token);
    if (!active) return;
    active.backend.setFoldPercent(percent);
    active.foldPercent = percent;
    // A converged clock spends no budget, so a new target must un-converge it
    // or the model would simply never move to it.
    active.clock.invalidate();
  },

  setFoldProfile(profile: FoldProfile | null, token?: SimulatorSessionToken): void {
    const active = sessionFor(token);
    if (!active) return;
    active.backend.setFoldProfile(profile);
    active.clock.invalidate();
  },

  setMaterial(options: Partial<SimulatorOptions>, token?: SimulatorSessionToken): void {
    const active = sessionFor(token);
    if (!active) return;
    active.backend.setMaterial(options);
    if (options.foldPercent !== undefined) active.foldPercent = options.foldPercent;
    active.clock.invalidate();
  },

  /**
   * Back to flat — the paper *and* the target it was heading for.
   *
   * Zeroing the target here rather than leaving it to the caller is what makes
   * this safe to call. Every caller means "flat" and every one of them followed
   * this with a separate `setFoldPercent(0)`, which is a second round-trip to
   * the worker: for the frames in between, a flat sheet sat under the old
   * target with the clock freshly un-converged, so the solver drove it straight
   * back where it came from. Pressing play on a fully folded window snapped to
   * folded instead of replaying from the start.
   */
  reset(token?: SimulatorSessionToken): void {
    const active = sessionFor(token);
    if (!active) return;
    active.backend.reset();
    active.backend.setFoldPercent(0);
    active.foldPercent = 0;
    active.clock.reset();
  },

  /**
   * Run one budgeted frame and return the resulting positions. The main thread
   * awaits this instead of doing the work itself, so its own frame stays free
   * regardless of how long the solve takes.
   */
  async tick(
    options: {
      withColors?: boolean;
      recycled?: ArrayBuffer;
      token?: SimulatorSessionToken;
    } = {}
  ): Promise<SimulatorFramePayload | null> {
    const active = sessionFor(options.token);
    if (!active) return null;
    const tick = active.clock.runFrame(active.backend);
    return readFrame(active, tick, options);
  },

  /**
   * Run to convergence ignoring the frame budget. Safe here in a way it never
   * was on the main thread; used for initial settle and for scrubbing to a new
   * fold target where an immediately-correct result beats an animated one.
   */
  async settle(
    maxSteps = 20_000,
    options: {
      withColors?: boolean;
      recycled?: ArrayBuffer;
      token?: SimulatorSessionToken;
    } = {}
  ): Promise<SimulatorFramePayload | null> {
    const active = sessionFor(options.token);
    if (!active) return null;
    const tick = active.clock.runToConvergence(active.backend, maxSteps);
    return readFrame(active, tick, options);
  },

  /**
   * The current folded geometry, for export. Positions are read on demand rather
   * than pushed with every frame: in GPU-render mode nothing crosses to the main
   * thread at all, so an exporter has no other way to see the fold. Triangles are
   * the solver's own (already triangulated) faces.
   */
  exportGeometry(): SimulatorExportGeometry {
    const active = requireSession();
    const positions = new Float32Array(active.model.prepared.vertexCount * 3);
    active.backend.readPositions(positions);
    const triangles = active.model.prepared.indices.slice();
    return transfer(
      {
        positions: positions.buffer as ArrayBuffer,
        triangles: triangles.buffer as ArrayBuffer,
        vertexCount: active.model.prepared.vertexCount,
        foldPercent: active.foldPercent,
      },
      [positions.buffer as ArrayBuffer, triangles.buffer as ArrayBuffer]
    );
  },

  diagnostics(): SimulatorDiagnostics {
    return requireSession().backend.readDiagnostics();
  },

  /**
   * Update the orbit camera (GPU-render mode only) and redraw. Called on every
   * orbit/zoom: it runs no solver work and no readback — just a re-draw with a
   * new view — which is what makes camera manipulation cheap at any model size.
   */
  async setCamera(
    camera: SimulatorCamera,
    token?: SimulatorSessionToken
  ): Promise<ImageBitmap | null> {
    const active = sessionFor(token);
    if (!active?.gpuRender) return null;
    perf.cameraCalls += 1;
    active.gpuRender.view = camera.view;
    active.gpuRender.width = camera.width;
    active.gpuRender.height = camera.height;
    const bitmap = await renderGpu(active.gpuRender);
    return bitmap ? transfer(bitmap, [bitmap]) : null;
  },

  /** Update render settings (colours, faces/edges/lighting, x-ray) and redraw. */
  async setRenderSettings(
    settings: RenderSettings,
    token?: SimulatorSessionToken
  ): Promise<ImageBitmap | null> {
    const active = sessionFor(token);
    if (!active?.gpuRender) return null;
    active.gpuRender.settings = settings;
    const bitmap = await renderGpu(active.gpuRender);
    return bitmap ? transfer(bitmap, [bitmap]) : null;
  },

  /**
   * Snapshot of timing counters since the last call, then reset them. Polled by
   * the runtime when `localStorage.simPerf === '1'` and logged to the console.
   * Everything is measured in the worker, where the solve and the GPU draw
   * actually happen, so it reflects real cost rather than main-thread overhead.
   */
  getPerfStats(): PerfSnapshot {
    const now = nowMs();
    const windowMs = now - perf.windowStart;
    const snapshot: PerfSnapshot = {
      windowMs,
      backend: latestSession()?.backendId ?? 'reference',
      gpuRender: Boolean(latestSession()?.gpuRender),
      liveSessions: sessions.size,
      renders: perf.renders,
      renderAvgMs: perf.renders ? perf.renderTotalMs / perf.renders : 0,
      renderMaxMs: perf.renderMaxMs,
      cameraCalls: perf.cameraCalls,
      ticks: perf.ticks,
      solveAvgMs: perf.ticks ? perf.solveTotalMs / perf.ticks : 0,
      solveMaxMs: perf.solveMaxMs,
      stepsTotal: perf.stepsTotal,
    };
    resetPerf(now);
    return snapshot;
  },

  /**
   * Drop one model. Called when a window is closed, so its textures go with it
   * rather than waiting to be evicted by something else loading.
   */
  release(token: SimulatorSessionToken): void {
    disposeSession(token);
  },

  dispose(): void {
    for (const token of [...sessions.keys()]) disposeSession(token);
  },
};

async function readFrame(
  active: Session,
  tick: { steps: number; elapsedMs: number; converged: boolean; maxVelocity: number },
  options: { withColors?: boolean; recycled?: ArrayBuffer }
): Promise<SimulatorFramePayload> {
  perf.ticks += 1;
  perf.solveTotalMs += tick.elapsedMs;
  perf.stepsTotal += tick.steps;
  if (tick.elapsedMs > perf.solveMaxMs) perf.solveMaxMs = tick.elapsedMs;

  const scalars = {
    step: active.backend.stepCount,
    stepsThisTick: tick.steps,
    elapsedMs: tick.elapsedMs,
    converged: tick.converged,
    maxVelocity: tick.maxVelocity,
    foldPercent: active.foldPercent,
    maxStrain: active.backend.readDiagnostics().maxNodalStrain ?? 0,
  };

  // GPU-render mode: the worker draws straight to the transferred canvas. No
  // positions cross to the main thread at all -- the whole point of this path.
  if (active.gpuRender) {
    refitOnce(active.gpuRender);
    const bitmap = await renderGpu(active.gpuRender);
    const payload = {
      positions: null,
      colors: null,
      renderedInWorker: true,
      bitmap,
      ...scalars,
    };
    return bitmap ? transfer(payload, [bitmap]) : payload;
  }

  const floats = active.model.positions.length;
  const positions = scratchFrom(options.recycled, floats);
  active.backend.readPositions(positions);

  let colors: Float32Array | null = null;
  if (options.withColors) {
    colors = active.colorScratch;
    active.backend.readColors(colors);
    colors = colors.slice();
  }

  const transferables: ArrayBuffer[] = [positions.buffer as ArrayBuffer];
  if (colors) transferables.push(colors.buffer as ArrayBuffer);

  return transfer(
    {
      positions: positions.buffer as ArrayBuffer,
      colors: colors ? (colors.buffer as ArrayBuffer) : null,
      renderedInWorker: false,
      bitmap: null,
      ...scalars,
    },
    transferables
  );
}

/**
 * Draw the current GPU state. No readback in either mode: the mesh is drawn from
 * the solver's position texture, so nothing crosses to the CPU.
 *
 * Returns an ImageBitmap in bitmap-present mode and null when drawing straight
 * to a transferred canvas. This is the single fork between the two paths —
 * solver, camera, settings and MeshRenderer are identical either side of it.
 */
/**
 * Size the shared drawing buffer for a render.
 *
 * Resizing a drawing buffer reallocates it, which costs ~2.2ms and stalls on the
 * GPU process. Sizing it to each request meant paying that on *every* render:
 * once per frame while a window zooms, and once per message when two windows of
 * different sizes take turns — measured at 78% worker occupancy with only ~95ms
 * of actual GL command submission behind it.
 *
 * In bitmap mode the canvas is scratch, not the frame, so it grows to the
 * largest render anyone has asked for and stays there; each render takes the
 * corner it needs and is cropped out. Window size stops being a performance
 * variable. See `implementation-plans/inline-simulation-performance.md`.
 *
 * In canvas mode it stays exact: the transferred canvas *is* the visible
 * surface, and a buffer larger than the drawing would be stretched across it by
 * the compositor.
 */
/**
 * Ceiling on a bitmap-mode render, in device pixels.
 *
 * Not a quality choice — a correctness one. A browser silently clamps the
 * drawing buffer when it cannot back the size asked for: a canvas set to 16384
 * came back with a 5760 buffer, `isContextLost()` false and no GL error. Past
 * that point the render lands outside the buffer and the crop reads nothing, so
 * every window goes transparent at once and, with a grow-only canvas, stays that
 * way. Well under the observed clamp, and ~9ms to allocate once.
 *
 * A window larger than this renders at the cap and is scaled up slightly by the
 * time it reaches the screen. That is a window filling most of a large display,
 * where mild softness is a better outcome than a blank one.
 */
export const MAX_BITMAP_RENDER_EDGE = 2048;

/** Floor, so a window measured mid-collapse still renders something usable. */
const MIN_BITMAP_RENDER_EDGE = 128;

/**
 * Quantised edge for the *canvas*, which is the expensive thing to change.
 *
 * Grow-only alone does nothing for a monotonically increasing sequence, and
 * zooming in is exactly that — every frame wants a few more pixels than the
 * last, so the buffer reallocated every frame regardless, at 3.6ms when small
 * and 95ms by the time it reached 8192. Snapped to powers of two there are at
 * most four growth events in a session.
 *
 * Deliberately *not* used for the render viewport. Quantising each axis
 * separately changes the aspect ratio — a 257x255 window would render 512x256
 * and be stretched to twice its width on the way to the screen — and setting a
 * viewport costs nothing, so there is nothing to buy by rounding it.
 */
export function bitmapCanvasEdge(edge: number): number {
  const wanted = Math.max(MIN_BITMAP_RENDER_EDGE, Math.ceil(edge));
  if (wanted >= MAX_BITMAP_RENDER_EDGE) return MAX_BITMAP_RENDER_EDGE;
  return 2 ** Math.ceil(Math.log2(wanted));
}

/**
 * Scale a requested render down to fit a limit, keeping its shape.
 *
 * Uniform, never per-axis: the bitmap is stretched to the window's box when it
 * is presented, so any difference between its aspect and the window's shows up
 * as a squashed fold.
 */
export function fitRenderWithin(
  requested: { width: number; height: number },
  limit: { width: number; height: number }
): { width: number; height: number } {
  const width = Math.max(1, Math.floor(requested.width));
  const height = Math.max(1, Math.floor(requested.height));
  const scale = Math.min(1, limit.width / width, limit.height / height);
  if (scale >= 1) return { width, height };
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

export function nextRenderCanvasSize(
  current: { width: number; height: number },
  requested: { width: number; height: number },
  mode: PresentMode
): { width: number; height: number } | null {
  if (mode === 'canvas') {
    const width = Math.max(1, Math.floor(requested.width));
    const height = Math.max(1, Math.floor(requested.height));
    if (current.width === width && current.height === height) return null;
    return { width, height };
  }
  const width = bitmapCanvasEdge(requested.width);
  const height = bitmapCanvasEdge(requested.height);
  if (current.width >= width && current.height >= height) return null;
  return {
    width: Math.max(current.width, width),
    height: Math.max(current.height, height),
  };
}

function sizeRenderCanvas(width: number, height: number): void {
  if (!renderCanvas) return;
  const next = nextRenderCanvasSize(renderCanvas, { width, height }, presentMode);
  if (!next) return;
  renderCanvas.width = next.width;
  renderCanvas.height = next.height;
}

async function renderGpu(state: GpuRenderState): Promise<ImageBitmap | null> {
  // Timed as a whole. It used to start after the resize, which is exactly the
  // work that turned out to dominate — the instrumentation meant to catch this
  // could not see it.
  const started = nowMs();
  // The canvas is quantised so it rarely reallocates; the viewport inside it is
  // the window's true shape, because changing a viewport is free and the bitmap
  // is stretched to the window's box when it is presented. Rounding the viewport
  // too is what squashed the fold: a 257x255 window rendered 512x256.
  sizeRenderCanvas(state.width, state.height);
  // What GL actually gave us, which is not always what the canvas was set to —
  // see {@link WebglSolver.drawingBufferSize}. Rendering or cropping past this
  // reads nothing back and shows an empty window with no error anywhere.
  const buffer = state.solver.drawingBufferSize;
  const { width, height } = fitRenderWithin(state, buffer);
  const camera = cameraUniforms(state.view, state.center, state.radius, width, height);
  state.solver.render(camera, state.settings);
  // The render fills the viewport at the buffer's bottom-left; a bitmap's origin
  // is top-left, so the crop is measured down from the top of the buffer.
  const bitmap =
    presentMode === 'bitmap' && renderCanvas
      ? await createImageBitmap(renderCanvas, 0, buffer.height - height, width, height)
      : null;
  // render() issues GL commands but they run async on the GPU; this measures the
  // CPU-side command cost, which is what would block the worker. A readPixels
  // would be needed to time actual GPU work, and that would itself stall.
  const elapsed = nowMs() - started;
  perf.renders += 1;
  perf.renderTotalMs += elapsed;
  if (elapsed > perf.renderMaxMs) perf.renderMaxMs = elapsed;
  return bitmap;
}

/**
 * Fit the camera once, from the first settled frame. Matches the canvas-2D
 * renderer, which also fits once (a folded model shrinks, and refitting every
 * frame makes it visibly "breathe"). A readback of positions here is a one-off
 * on load, not a per-frame cost.
 */
function refitOnce(state: GpuRenderState): void {
  if (state.fitted) return;
  const positions = new Float32Array(state.solver.vertexCount * 3);
  state.solver.readPositions(positions);
  const center = centroid(positions);
  state.center = center;
  state.radius = boundingRadius(positions, center);
  state.fitted = true;
}

export type SimulatorWorkerApi = typeof api;

/**
 * The worker API as a plain object, usable without a Worker.
 *
 * `simulatorWorker.ts` is a three-line comlink wrapper around this, which keeps
 * the session logic testable in jsdom (where `Worker` does not exist) and
 * runnable in Node.
 */
export function createSimulatorSession(): SimulatorWorkerApi {
  return api;
}
