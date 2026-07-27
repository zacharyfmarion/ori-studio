import { transfer } from 'comlink';
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

let session: Session | null = null;

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
 * The panel's canvas, transferred once via `transferControlToOffscreen`. A
 * canvas can only be transferred a single time, so it is held here and reused
 * across model reloads — each new WebglSolver renders to the same canvas.
 */
let renderCanvas: OffscreenCanvas | null = null;

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
  if (!session) throw new Error('Simulator worker: no model loaded');
  return session;
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
  /** Transfer the panel's canvas to the worker, once. */
  attachCanvas(canvas: OffscreenCanvas): void {
    renderCanvas = canvas;
  },

  load(fold: FoldDocument, options: SimulatorLoadOptions = {}): SimulatorModelInfo {
    // Carry the panel's camera and render settings across reloads. The panel
    // only pushes them when the GPU path first turns on, so a plain reset here
    // would make every segment switch snap back to the default view and the
    // default (blue) front colour until the next user interaction. Only the fit
    // (center/radius) is model-specific and recomputed by refitOnce.
    const previous = session?.gpuRender;
    session?.backend.dispose();
    // A fresh load gets a fresh context, so a previous loss is no longer the
    // truth about this session.
    sessionFailure = null;

    // prepareFoldModel runs here rather than on the main thread: it is O(n)
    // heavy (earcut triangulation, edge indexing) and used to block the UI
    // before a single solver step had run.
    const prepared = prepareFoldModel(fold, options.prepare ?? { triangulate: true });
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

    session = {
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
      },
      [
        indices.buffer as ArrayBuffer,
        edgesVertices.buffer as ArrayBuffer,
        edgesAssignment.buffer as ArrayBuffer,
        facesEdges.buffer as ArrayBuffer,
      ]
    );
  },

  setFoldPercent(percent: number): void {
    const active = requireSession();
    active.backend.setFoldPercent(percent);
    active.foldPercent = percent;
    // A converged clock spends no budget, so a new target must un-converge it
    // or the model would simply never move to it.
    active.clock.invalidate();
  },

  setFoldProfile(profile: FoldProfile | null): void {
    const active = requireSession();
    active.backend.setFoldProfile(profile);
    active.clock.invalidate();
  },

  setMaterial(options: Partial<SimulatorOptions>): void {
    const active = requireSession();
    active.backend.setMaterial(options);
    if (options.foldPercent !== undefined) active.foldPercent = options.foldPercent;
    active.clock.invalidate();
  },

  reset(): void {
    const active = requireSession();
    active.backend.reset();
    active.clock.reset();
  },

  /**
   * Run one budgeted frame and return the resulting positions. The main thread
   * awaits this instead of doing the work itself, so its own frame stays free
   * regardless of how long the solve takes.
   */
  tick(options: { withColors?: boolean; recycled?: ArrayBuffer } = {}): SimulatorFramePayload {
    const active = requireSession();
    const tick = active.clock.runFrame(active.backend);
    return readFrame(active, tick, options);
  },

  /**
   * Run to convergence ignoring the frame budget. Safe here in a way it never
   * was on the main thread; used for initial settle and for scrubbing to a new
   * fold target where an immediately-correct result beats an animated one.
   */
  settle(maxSteps = 20_000, options: { withColors?: boolean; recycled?: ArrayBuffer } = {}): SimulatorFramePayload {
    const active = requireSession();
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
  setCamera(camera: SimulatorCamera): void {
    const active = requireSession();
    if (!active.gpuRender) return;
    perf.cameraCalls += 1;
    active.gpuRender.view = camera.view;
    active.gpuRender.width = camera.width;
    active.gpuRender.height = camera.height;
    renderGpu(active.gpuRender);
  },

  /** Update render settings (colours, faces/edges/lighting, x-ray) and redraw. */
  setRenderSettings(settings: RenderSettings): void {
    const active = requireSession();
    if (!active.gpuRender) return;
    active.gpuRender.settings = settings;
    renderGpu(active.gpuRender);
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
      backend: session?.backendId ?? 'reference',
      gpuRender: Boolean(session?.gpuRender),
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

  dispose(): void {
    session?.backend.dispose();
    session = null;
  },
};

function readFrame(
  active: Session,
  tick: { steps: number; elapsedMs: number; converged: boolean; maxVelocity: number },
  options: { withColors?: boolean; recycled?: ArrayBuffer }
): SimulatorFramePayload {
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
    renderGpu(active.gpuRender);
    return { positions: null, colors: null, renderedInWorker: true, ...scalars };
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
      ...scalars,
    },
    transferables
  );
}

/** Draw the current GPU state to the transferred canvas. No readback. */
function renderGpu(state: GpuRenderState): void {
  // The drawing-buffer size lives on the canvas, not the GL viewport; keep it in
  // step with the requested render size so a panel resize is not stretched.
  if (renderCanvas && (renderCanvas.width !== state.width || renderCanvas.height !== state.height)) {
    renderCanvas.width = state.width;
    renderCanvas.height = state.height;
  }
  const camera = cameraUniforms(state.view, state.center, state.radius, state.width, state.height);
  const started = nowMs();
  state.solver.render(camera, state.settings);
  // render() issues GL commands but they run async on the GPU; this measures the
  // CPU-side command cost, which is what would block the worker. A readPixels
  // would be needed to time actual GPU work, and that would itself stall.
  const elapsed = nowMs() - started;
  perf.renders += 1;
  perf.renderTotalMs += elapsed;
  if (elapsed > perf.renderMaxMs) perf.renderMaxMs = elapsed;
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
