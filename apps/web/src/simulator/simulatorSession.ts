import { transfer } from 'comlink';
import {
  OrigamiModel,
  ReferenceSolver,
  SimulationClock,
  WebglSolver,
  prepareFoldModel,
  type FoldDocument,
  type FoldProfile,
  type PrepareFoldOptions,
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
  /** xyz per vertex. Transferred; hand it back via `recycled` to avoid churn. */
  positions: ArrayBuffer;
  /** rgb per vertex, only present when colours were requested. */
  colors: ArrayBuffer | null;
  step: number;
  stepsThisTick: number;
  elapsedMs: number;
  converged: boolean;
  maxVelocity: number;
  foldPercent: number;
  /**
   * Peak edge strain for this frame. Computed once per frame rather than per
   * step -- it walks every edge, which is why it must not go in the step loop,
   * but once per published frame is cheap and the panel displays it live.
   */
  maxEdgeStrain: number;
}

interface Session {
  model: OrigamiModel;
  backend: SolverBackend;
  backendId: SimulatorBackendId;
  clock: SimulationClock;
  positionScratch: Float32Array;
  colorScratch: Float32Array;
  foldPercent: number;
}

let session: Session | null = null;

function requireSession(): Session {
  if (!session) throw new Error('Simulator worker: no model loaded');
  return session;
}

/**
 * Pick the solver backend. The GPU path is used whenever WebGL2 is available
 * and the model uses the standard uniform fold target; a fold profile (our
 * addition, which the GPU path does not express) or absent WebGL2 falls back to
 * the reference solver. A caller can force the reference path via
 * `preferGpu: false`, which the backend indicator in the UI also allows.
 */
function createBackend(
  model: OrigamiModel,
  options: SimulatorLoadOptions
): { backend: SolverBackend; backendId: SimulatorBackendId } {
  const solverOptions = options.solver ?? {};
  const hasFoldProfile = Boolean(solverOptions.foldProfile?.ranges?.length);
  const wantsVerlet = solverOptions.integrationType === 'verlet';

  if (options.preferGpu !== false && !hasFoldProfile && !wantsVerlet && canUseWebgl()) {
    try {
      const canvas = acquireGlCanvas();
      if (canvas && WebglSolver.isSupported(canvas)) {
        return { backend: new WebglSolver(canvas, model, solverOptions), backendId: 'webgl2' };
      }
    } catch {
      // Any GPU setup failure (driver bug, lost context) falls through to the
      // reference solver rather than breaking the simulator.
    }
  }
  return { backend: new ReferenceSolver(model, solverOptions), backendId: 'reference' };
}

let glCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;

function canUseWebgl(): boolean {
  return typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined';
}

/**
 * One canvas reused across model loads. Each WebglSolver owns its own GL context
 * on it; disposing a solver frees the context, and the next load makes a new
 * one. A 2x2 canvas is enough -- the solver only ever renders to its own
 * framebuffers, never to this canvas.
 */
function acquireGlCanvas(): OffscreenCanvas | HTMLCanvasElement | null {
  if (glCanvas) return glCanvas;
  if (typeof OffscreenCanvas !== 'undefined') glCanvas = new OffscreenCanvas(2, 2);
  else if (typeof document !== 'undefined') glCanvas = document.createElement('canvas');
  return glCanvas;
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
  load(fold: FoldDocument, options: SimulatorLoadOptions = {}): SimulatorModelInfo {
    session?.backend.dispose();

    // prepareFoldModel runs here rather than on the main thread: it is O(n)
    // heavy (earcut triangulation, edge indexing) and used to block the UI
    // before a single solver step had run.
    const prepared = prepareFoldModel(fold, options.prepare ?? { triangulate: true });
    const model = new OrigamiModel(prepared);
    const { backend, backendId } = createBackend(model, options);
    const clock = new SimulationClock({
      budgetMs: options.budgetMs ?? 10,
      convergenceEpsilon: options.convergenceEpsilon,
    });

    session = {
      model,
      backend,
      backendId,
      clock,
      positionScratch: new Float32Array(prepared.vertexCount * 3),
      colorScratch: new Float32Array(prepared.vertexCount * 3),
      foldPercent: options.solver?.foldPercent ?? 0,
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

  diagnostics(): SimulatorDiagnostics {
    return requireSession().backend.readDiagnostics();
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
      step: active.backend.stepCount,
      stepsThisTick: tick.steps,
      elapsedMs: tick.elapsedMs,
      converged: tick.converged,
      maxVelocity: tick.maxVelocity,
      foldPercent: active.foldPercent,
      maxEdgeStrain: active.backend.readDiagnostics().maxEdgeStrain ?? 0,
    },
    transferables
  );
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
