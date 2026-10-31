/// <reference types="@webgpu/types" />
// The backend benchmark: WebgpuSolver, WebglSolver and ReferenceSolver on the
// same models, measured the way the app runs them. Driven headless by
// backendBench.bench.ts, or opened by hand on real hardware, where the numbers
// mean something:
//
//   npm run bench:backends:serve -w @treemaker/origami-simulator
//
// The query string narrows a run: `?fixtures=miura-32x32,bird-base&backends=webgpu,webgl2&duration=4000`.
//
// Three numbers per backend and model:
//
// - steps/s in the live loop: `stepsPerTick` steps then one motion sample, as
//   the worker ticks. WebGPU's sample is a promise, and the loop keeps up to
//   two in flight, as SimulationClock does, rather than waiting on each.
// - settle: SimulationClock.settle from the flat sheet to the fold target, the
//   app's load-time settle. WebGPU waits on a sample per chunk here, so this is
//   where its readback latency shows.
// - frame time: one 512px frame of the fold, drawn and waited for.
import { prepareFoldModel } from '../../src/prepare.js';
import { OrigamiModel } from '../../src/model.js';
import { ReferenceSolver } from '../../src/referenceSolver.js';
import { SimulationClock } from '../../src/simulationClock.js';
import type { MotionSample, SolverBackend } from '../../src/solverBackend.js';
import { WebglSolver } from '../../src/webgl/webglSolver.js';
import type { GlCore } from '../../src/webgl/glCore.js';
import { boundingRadius, cameraUniforms, centroid } from '../../src/webgl/camera.js';
import type { RenderSettings } from '../../src/webgl/meshRenderer.js';
import { GpuCore } from '../../src/webgpu/gpuCore.js';
import { WebgpuSolver } from '../../src/webgpu/webgpuSolver.js';
import { FIXTURES } from '../fixtures.js';
import {
  BACKEND_BENCH_DEFAULTS,
  BACKENDS,
  formatBackendBench,
  type BackendBenchOptions,
  type BackendBenchReport,
  type BackendBenchRow,
  type BackendName,
} from './report.js';

declare global {
  interface Window {
    runBackendBench: (options?: Partial<BackendBenchOptions>) => Promise<BackendBenchReport>;
    runTrajectory: typeof runTrajectory;
  }
}

const SETTINGS: RenderSettings = {
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
  edgeWidthPx: 3,
  mountainWidthPx: 3,
  valleyWidthPx: 3,
  faceAlpha: 1,
  creaseDash: { border: null, mountain: [6, 3], valley: [2, 2] },
};

/** The worker's clocks (simulatorSession.ts): a step count bounds a GPU tick, a time budget a CPU one. */
function clockFor(backend: BackendName, options: BackendBenchOptions): SimulationClock {
  return backend === 'reference'
    ? new SimulationClock({ budgetMs: 10 })
    : new SimulationClock({ budgetMs: 1000, maxStepsPerFrame: options.stepsPerTick, chunkSteps: 20 });
}

interface Built {
  solver: SolverBackend;
  /** Draw one frame and wait for the GPU to finish it. */
  frame: ((size: number) => Promise<void>) | null;
  dispose(): void;
}

function modelFor(fixture: (typeof FIXTURES)[number]): OrigamiModel {
  return new OrigamiModel(prepareFoldModel(fixture.build(), { triangulate: true }));
}

function cameraFor(solver: WebglSolver | WebgpuSolver, size: number) {
  const positions = new Float32Array(solver.vertexCount * 3);
  solver.readPositions(positions);
  const center = centroid(positions);
  return cameraUniforms({ yaw: 0.6, pitch: 0.5, zoom: 1 }, center, boundingRadius(positions, center), size, size);
}

async function build(
  backend: BackendName,
  model: OrigamiModel,
  options: BackendBenchOptions,
  core: GpuCore | null
): Promise<Built> {
  const solverOptions = { foldPercent: options.foldPercent };
  if (backend === 'reference') {
    const solver = new ReferenceSolver(model, solverOptions);
    return { solver, frame: null, dispose: () => solver.dispose() };
  }
  if (backend === 'webgl2') {
    const canvas = document.createElement('canvas');
    canvas.width = options.frameSize;
    canvas.height = options.frameSize;
    const solver = new WebglSolver(canvas, model, solverOptions);
    const { gl } = solver as unknown as { gl: GlCore };
    const pixel = new Uint8Array(4);
    return {
      solver,
      frame: async (size) => {
        solver.render(cameraFor(solver, size), SETTINGS);
        // A one-pixel read waits for the frame and nothing more.
        gl.gl.readPixels(0, 0, 1, 1, gl.gl.RGBA, gl.gl.UNSIGNED_BYTE, pixel);
      },
      dispose: () => {
        solver.dispose();
        // A page holds about 16 contexts; give this one back now.
        gl.gl.getExtension('WEBGL_lose_context')?.loseContext();
      },
    };
  }
  if (!core) throw new Error('no WebGPU device');
  const solver = WebgpuSolver.createNow(model, solverOptions, core);
  // Offscreen, in the canvas format: headless SwiftShader loses the device on presenting a canvas.
  const format = navigator.gpu.getPreferredCanvasFormat();
  const texture = core.device.createTexture({
    label: 'bench frame',
    size: [options.frameSize, options.frameSize],
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const target = { view: texture.createView(), width: options.frameSize, height: options.frameSize, format };
  return {
    solver,
    frame: async (size) => {
      solver.render(cameraFor(solver, size), SETTINGS, target);
      await core.device.queue.onSubmittedWorkDone();
    },
    dispose: () => {
      solver.dispose();
      texture.destroy();
    },
  };
}

/** The live loop: `stepsPerTick` steps and a sample per tick, at most two samples in flight. */
async function liveStepsPerSecond(solver: SolverBackend, options: BackendBenchOptions): Promise<number> {
  const inFlight: Array<MotionSample | Promise<MotionSample>> = [];
  // Warm: compile, allocate, fault in.
  solver.step(options.stepsPerTick);
  await solver.sampleMotion();
  let steps = 0;
  const started = performance.now();
  while (performance.now() - started < options.durationMs) {
    solver.step(options.stepsPerTick);
    steps += options.stepsPerTick;
    inFlight.push(solver.sampleMotion());
    if (inFlight.length > 2) await inFlight.shift();
    // The worker yields between ticks; so does this, or a sync backend would starve the page.
    if (steps % (options.stepsPerTick * 16) === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await Promise.all(inFlight);
  return (steps * 1000) / (performance.now() - started);
}

async function frameTimes(frame: (size: number) => Promise<void>, options: BackendBenchOptions) {
  for (let i = 0; i < 5; i += 1) await frame(options.frameSize);
  const samples: number[] = [];
  for (let i = 0; i < options.frames; i += 1) {
    const started = performance.now();
    await frame(options.frameSize);
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] ?? Number.NaN;
  return { p50: at(0.5), p95: at(0.95) };
}

/** Where ReferenceSolver puts every node after `accuracySteps` steps from the flat sheet. */
function referencePositions(fixture: (typeof FIXTURES)[number], options: BackendBenchOptions): Float32Array {
  const model = modelFor(fixture);
  const solver = new ReferenceSolver(model, { foldPercent: options.foldPercent });
  try {
    solver.step(options.accuracySteps);
    const positions = new Float32Array(model.prepared.vertexCount * 3);
    solver.readPositions(positions);
    return positions;
  } finally {
    solver.dispose();
  }
}

export interface TrajectoryRequest {
  fixture: string;
  backends: BackendName[];
  foldPercent: number;
  /** Step counts from the flat sheet, ascending. */
  checkpoints: number[];
}

/**
 * Every backend's positions at each checkpoint of one run from the flat
 * sheet, for comparison with upstream's own trajectory
 * (upstreamTrajectory.bench.ts). Plain arrays, so they cross to Node.
 */
async function runTrajectory(request: TrajectoryRequest): Promise<Record<string, number[][] | { error: string }>> {
  const fixture = FIXTURES.find((candidate) => candidate.name === request.fixture);
  if (!fixture) throw new Error(`no fixture ${request.fixture}`);
  const options: BackendBenchOptions = { ...BACKEND_BENCH_DEFAULTS, foldPercent: request.foldPercent };
  let core: GpuCore | null = null;
  if (request.backends.includes('webgpu')) {
    core = await GpuCore.create();
    await WebgpuSolver.validateShaders(core);
  }
  const out: Record<string, number[][] | { error: string }> = {};
  try {
    for (const backend of request.backends) {
      let built: Built | null = null;
      try {
        const model = modelFor(fixture);
        built = await build(backend, model, options, core);
        const positions = new Float32Array(model.prepared.vertexCount * 3);
        const path: number[][] = [];
        let done = 0;
        for (const checkpoint of request.checkpoints) {
          if (checkpoint > done) built.solver.step(checkpoint - done);
          done = Math.max(done, checkpoint);
          await built.solver.syncReads?.();
          built.solver.readPositions(positions);
          path.push(Array.from(positions));
        }
        out[backend] = path;
      } catch (error) {
        out[backend] = { error: error instanceof Error ? error.message : String(error) };
      } finally {
        built?.dispose();
      }
    }
  } finally {
    core?.dispose();
  }
  return out;
}

/** The same steps on `backend`, from its own flat sheet, against `reference`. */
async function maxDeviation(
  fixture: (typeof FIXTURES)[number],
  backend: BackendName,
  options: BackendBenchOptions,
  core: GpuCore | null,
  reference: Float32Array
): Promise<number> {
  const built = await build(backend, modelFor(fixture), options, core);
  try {
    built.solver.step(options.accuracySteps);
    await built.solver.syncReads?.();
    const positions = new Float32Array(reference.length);
    built.solver.readPositions(positions);
    let max = 0;
    for (let i = 0; i < reference.length; i += 1) {
      const delta = Math.abs(positions[i]! - reference[i]!);
      // A NaN is a failure, not a zero.
      if (!(delta <= max)) max = Number.isNaN(delta) ? Number.POSITIVE_INFINITY : delta;
    }
    return max;
  } finally {
    built.dispose();
  }
}

/**
 * SimulationClock.settle in chunks, stopping at the step cap, at
 * convergence, or past the time budget.
 */
async function settleWithin(clock: SimulationClock, solver: SolverBackend, options: BackendBenchOptions) {
  const started = performance.now();
  const chunk = 1000;
  let steps = 0;
  let converged = false;
  while (steps < options.settleMaxSteps && !converged && performance.now() - started < options.settleBudgetMs) {
    const tick = await clock.settle(solver, Math.min(chunk, options.settleMaxSteps - steps));
    steps += tick.steps;
    converged = tick.converged;
    if (tick.steps === 0) break;
  }
  return { steps, converged, ms: performance.now() - started };
}

async function runRow(
  fixture: (typeof FIXTURES)[number],
  backend: BackendName,
  options: BackendBenchOptions,
  core: GpuCore | null,
  reference: Float32Array
): Promise<BackendBenchRow> {
  const model = modelFor(fixture);
  const row: BackendBenchRow = {
    fixture: fixture.name,
    vertices: model.prepared.vertexCount,
    backend,
    stepsPerSecond: Number.NaN,
    settleMs: Number.NaN,
    settleSteps: 0,
    settled: false,
    maxDeviation: null,
    frameMs: null,
  };
  let built: Built | null = null;
  try {
    // Settle first, on a fresh solver from the flat sheet, so it is the app's load.
    built = await build(backend, model, options, core);
    const clock = clockFor(backend, options);
    const settle = await settleWithin(clock, built.solver, options);
    row.settleMs = settle.ms;
    row.settleSteps = settle.steps;
    row.settled = settle.converged;
    // Then the live loop and frames, on the folded model.
    row.stepsPerSecond = await liveStepsPerSecond(built.solver, options);
    await built.solver.syncReads?.();
    if (built.frame) row.frameMs = await frameTimes(built.frame, options);
    built.dispose();
    built = null;
    if (backend !== 'reference') row.maxDeviation = await maxDeviation(fixture, backend, options, core, reference);
  } catch (error) {
    row.error = error instanceof Error ? error.message : String(error);
  } finally {
    built?.dispose();
  }
  return row;
}

function webglRendererName(): string {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'no WebGL2';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'WebGL2';
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return name;
}

window.runTrajectory = runTrajectory;

window.runBackendBench = async (overrides = {}) => {
  const options: BackendBenchOptions = { ...BACKEND_BENCH_DEFAULTS, ...overrides };
  let core: GpuCore | null = null;
  let webgpuAdapter = 'none';
  if (options.backends.includes('webgpu')) {
    try {
      core = await GpuCore.create();
      await WebgpuSolver.validateShaders(core);
      const info = core.adapterInfo;
      webgpuAdapter = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' / ') || 'unknown';
    } catch (error) {
      webgpuAdapter = `unavailable: ${error instanceof Error ? error.message : String(error)}`;
      core = null;
    }
  }
  const fixtures = FIXTURES.filter(
    (fixture) => !fixture.degenerate && (options.fixtures.length === 0 || options.fixtures.includes(fixture.name))
  );
  const rows: BackendBenchRow[] = [];
  try {
    for (const fixture of fixtures) {
      const reference = referencePositions(fixture, options);
      for (const backend of options.backends) {
        rows.push(await runRow(fixture, backend, options, core, reference));
        progress?.(rows);
      }
    }
  } finally {
    core?.dispose();
  }
  return { webgpuAdapter, webglRenderer: webglRendererName(), userAgent: navigator.userAgent, options, rows };
};

/** Options from the page's query string. */
function queryOptions(): Partial<BackendBenchOptions> {
  const query = new URLSearchParams(location.search);
  const list = (key: string) => query.get(key)?.split(',').map((part) => part.trim()).filter(Boolean);
  const number = (key: string) => {
    const value = Number(query.get(key));
    return query.has(key) && Number.isFinite(value) ? value : undefined;
  };
  const options: Partial<BackendBenchOptions> = {};
  const fixtures = list('fixtures');
  if (fixtures) options.fixtures = fixtures;
  const backends = list('backends')?.filter((name): name is BackendName => (BACKENDS as string[]).includes(name));
  if (backends?.length) options.backends = backends;
  const duration = number('duration');
  if (duration !== undefined) options.durationMs = duration;
  const fold = number('fold');
  if (fold !== undefined) options.foldPercent = fold;
  const frames = number('frames');
  if (frames !== undefined) options.frames = frames;
  return options;
}

let progress: ((rows: BackendBenchRow[]) => void) | null = null;

const button = document.getElementById('run');
const out = document.getElementById('out');
if (button && out) {
  const options = { ...BACKEND_BENCH_DEFAULTS, ...queryOptions() };
  button.addEventListener('click', async () => {
    out.textContent = 'running…';
    progress = (rows) => {
      out.textContent = `${rows.length} rows so far…\n\n${formatBackendBench({ webgpuAdapter: '…', webglRenderer: '…', userAgent: navigator.userAgent, options, rows })}`;
    };
    try {
      out.textContent = formatBackendBench(await window.runBackendBench(options));
    } finally {
      progress = null;
    }
  });
}
