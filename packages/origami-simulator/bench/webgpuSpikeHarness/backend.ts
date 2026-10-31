/// <reference types="@webgpu/types" />
// Parity and behaviour checks for WebgpuSolver, run in a real browser by
// webgpuSpike.bench.ts or by hand from the harness page.
//
// The parity rows hold it to the same gate as WebglSolver (gpuParity.bench.ts):
// ReferenceSolver's positions within Tier C after the same steps from flat.
import { prepareFoldModel } from '../../src/prepare.js';
import { OrigamiModel } from '../../src/model.js';
import { ReferenceSolver } from '../../src/referenceSolver.js';
import { SimulationClock } from '../../src/simulationClock.js';
import { WebglSolver } from '../../src/webgl/webglSolver.js';
import type { GpuCore } from '../../src/webgpu/gpuCore.js';
import { WebgpuSolver } from '../../src/webgpu/webgpuSolver.js';
import { FIXTURES } from '../fixtures.js';
import type { BackendReport, BackendRow, IntegratorRow, PullRow, ShapeRow } from './report.js';
import { createSolverShape } from '../../src/solverBackend.js';

const FOLD_PERCENT = 60;
const STEP_COUNTS = [1, 10, 100];
/** A mid-run change: what the UI does when the fold slider or a material moves. */
const RETARGET = { foldPercent: 90, axialStiffness: 30, creaseStiffness: 1 };
/**
 * Settling to rest takes up to 20,000 steps, which is minutes per solver on a
 * software adapter at the largest sizes. The parity rows cover those; the
 * settle check runs on the rest.
 */
const SETTLE_MAX_VERTICES = 1100;

type Fixture = (typeof FIXTURES)[number];

function modelOf(fixture: Fixture): OrigamiModel {
  return new OrigamiModel(prepareFoldModel(fixture.build(), { triangulate: true }));
}

function maxAbs(a: Float32Array, b: Float32Array): number {
  let max = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const delta = Math.abs(a[i]! - b[i]!);
    if (!(delta <= max)) max = Number.isNaN(delta) ? Number.POSITIVE_INFINITY : delta;
  }
  return max;
}

function referencePositions(fixture: Fixture, run: (solver: ReferenceSolver) => void): Float32Array {
  const model = modelOf(fixture);
  const solver = new ReferenceSolver(model, { foldPercent: FOLD_PERCENT });
  run(solver);
  return model.positions.slice(0, model.prepared.vertexCount * 3);
}

function webglSolver(fixture: Fixture): WebglSolver {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  return new WebglSolver(canvas, modelOf(fixture), { foldPercent: FOLD_PERCENT });
}

function releaseWebgl(solver: WebglSolver): void {
  const gl = (solver as unknown as { gl: { gl: WebGL2RenderingContext } }).gl.gl;
  solver.dispose();
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}

async function gpuPositions(core: GpuCore, fixture: Fixture, run: (solver: WebgpuSolver) => void): Promise<Float32Array> {
  const model = modelOf(fixture);
  const solver = await WebgpuSolver.create(model, { foldPercent: FOLD_PERCENT }, core);
  try {
    run(solver);
    const out = new Float32Array(model.prepared.vertexCount * 3);
    await solver.readPositionsAsync(out);
    return out;
  } finally {
    solver.dispose();
  }
}

/** Steps a second, `perSolve` steps per call, synced every 8 calls. */
async function stepsPerSecond(perSolve: number, durationMs: number, run: () => void, sync: () => unknown): Promise<number> {
  for (let i = 0; i < 3; i += 1) run();
  await sync();
  let solves = 0;
  const start = performance.now();
  while (performance.now() - start < durationMs) {
    for (let i = 0; i < 8; i += 1) run();
    await sync();
    solves += 8;
  }
  return (solves * perSolve * 1000) / (performance.now() - start);
}

/** Settle the fixture to rest on both GPU solvers, recording the steps each took. */
async function settleBoth(core: GpuCore, fixture: Fixture, row: BackendRow): Promise<void> {
  const settling = await WebgpuSolver.create(modelOf(fixture), { foldPercent: FOLD_PERCENT }, core);
  try {
    const tick = await new SimulationClock({ chunkSteps: 100 }).settle(settling, 20_000);
    row.settle.gpu = tick.converged ? tick.steps : -1;
  } finally {
    settling.dispose();
  }
  const webglSettling = webglSolver(fixture);
  try {
    const tick = new SimulationClock({ chunkSteps: 100 }).runToConvergence(webglSettling, 20_000);
    row.settle.webgl = tick.converged ? tick.steps : -1;
  } finally {
    releaseWebgl(webglSettling);
  }
}

async function runFixture(core: GpuCore, fixture: Fixture, durationMs: number): Promise<BackendRow> {
  const vertices = modelOf(fixture).prepared.vertexCount;
  const row: BackendRow = {
    fixture: fixture.name,
    vertices,
    vsReference: {},
    vsWebgl: Number.NaN,
    retarget: Number.NaN,
    resetExact: false,
    arrestStill: false,
    settle: { gpu: null, webgl: null },
    stepsPerSecond: { gpu: 0, webgl: 0 },
  };
  try {
    for (const steps of STEP_COUNTS) {
      const reference = referencePositions(fixture, (solver) => solver.step(steps));
      row.vsReference[steps] = maxAbs(await gpuPositions(core, fixture, (solver) => solver.step(steps)), reference);
    }

    const last = STEP_COUNTS[STEP_COUNTS.length - 1]!;
    const webgl = webglSolver(fixture);
    try {
      webgl.step(last);
      const webglOut = new Float32Array(vertices * 3);
      webgl.readPositions(webglOut);
      row.vsWebgl = maxAbs(await gpuPositions(core, fixture, (solver) => solver.step(last)), webglOut);
    } finally {
      releaseWebgl(webgl);
    }

    const retarget = (solver: ReferenceSolver | WebgpuSolver) => {
      solver.step(50);
      solver.setMaterial(RETARGET);
      solver.step(50);
    };
    row.retarget = maxAbs(await gpuPositions(core, fixture, retarget), referencePositions(fixture, retarget));

    // Reset puts every node back on the flat sheet, bit for bit.
    const model = modelOf(fixture);
    const flat = model.originalPositions.slice(0, vertices * 3);
    const solver = await WebgpuSolver.create(model, { foldPercent: FOLD_PERCENT }, core);
    try {
      solver.step(100);
      solver.reset();
      const out = new Float32Array(vertices * 3);
      await solver.readPositionsAsync(out);
      row.resetExact = maxAbs(out, flat) === 0 && solver.stepCount === 0;

      solver.step(40);
      solver.arrestDynamics();
      row.arrestStill = (await solver.sampleMotion()).maxVelocity === 0;
    } finally {
      solver.dispose();
    }

    // The clock drives it to rest as it does WebglSolver.
    if (vertices <= SETTLE_MAX_VERTICES) await settleBoth(core, fixture, row);

    const timed = await WebgpuSolver.create(modelOf(fixture), { foldPercent: FOLD_PERCENT }, core);
    try {
      row.stepsPerSecond.gpu = await stepsPerSecond(100, durationMs, () => timed.step(100), () => timed.sampleMotion());
    } finally {
      timed.dispose();
    }
    const timedWebgl = webglSolver(fixture);
    try {
      row.stepsPerSecond.webgl = await stepsPerSecond(100, durationMs, () => timedWebgl.step(100), () => timedWebgl.sampleMotion());
    } finally {
      releaseWebgl(timedWebgl);
    }
  } catch (error) {
    row.error = error instanceof Error ? error.message : String(error);
  }
  return row;
}

const INTEGRATORS = ['euler', 'verlet'] as const;
type Integrator = (typeof INTEGRATORS)[number];
/** Pinned rows fix nodes part-way through the fold, as gpuParityHarness does: a node fixed at rest would hide a snap back to rest. */
const PIN_AFTER_STEPS = 20;

/** The first triangle's nodes and every seventh node: a held face plus scattered pins (gpuParityHarness pinMask). */
function pinMask(model: OrigamiModel): Uint8Array {
  const { indices, vertexCount } = model.prepared;
  const mask = new Uint8Array(vertexCount);
  for (let corner = 0; corner < 3; corner += 1) mask[indices[corner]!] = 1;
  for (let node = 0; node < vertexCount; node += 7) mask[node] = 1;
  return mask;
}

function maxDriftOf(mask: Uint8Array, before: Float32Array, after: Float32Array): number {
  let max = 0;
  mask.forEach((fixed, node) => {
    if (!fixed) return;
    for (let axis = 0; axis < 3; axis += 1) max = Math.max(max, Math.abs(after[node * 3 + axis]! - before[node * 3 + axis]!));
  });
  return max;
}

/** Positions as the solver holds them now: after waiting for its reads to catch up. */
async function positionsOf(solver: WebgpuSolver, vertices: number): Promise<Float32Array> {
  const out = new Float32Array(vertices * 3);
  await solver.syncReads();
  solver.readPositions(out);
  return out;
}

/** Both integrators, unpinned and pinned, against ReferenceSolver: gpuParityHarness's runGpuParity. */
async function integratorRows(core: GpuCore, fixture: Fixture): Promise<IntegratorRow[]> {
  const rows: IntegratorRow[] = [];
  for (const integrationType of INTEGRATORS) {
    for (const pinned of [false, true]) {
      for (const steps of STEP_COUNTS) {
        const row: IntegratorRow = { fixture: fixture.name, integrator: integrationType, pinned, steps, maxAbs: Number.NaN, heldDrift: 0 };
        try {
          const referenceModel = modelOf(fixture);
          const reference = new ReferenceSolver(referenceModel, { foldPercent: FOLD_PERCENT, integrationType });
          const gpuModel = modelOf(fixture);
          const gpu = await WebgpuSolver.create(gpuModel, { foldPercent: FOLD_PERCENT, integrationType }, core);
          try {
            const vertices = referenceModel.prepared.vertexCount;
            const mask = pinned ? pinMask(referenceModel) : null;
            let held: Float32Array | null = null;
            if (mask) {
              reference.step(PIN_AFTER_STEPS);
              reference.setFixedNodes(mask);
              gpu.step(PIN_AFTER_STEPS);
              gpu.setFixedNodes(mask);
              held = await positionsOf(gpu, vertices);
            }
            reference.step(steps);
            gpu.step(steps);
            const now = await positionsOf(gpu, vertices);
            row.maxAbs = maxAbs(now, referenceModel.positions.slice(0, vertices * 3));
            if (mask && held) row.heldDrift = maxDriftOf(mask, held, now);
          } finally {
            gpu.dispose();
          }
        } catch (error) {
          row.error = error instanceof Error ? error.message : String(error);
        }
        rows.push(row);
      }
    }
  }
  return rows;
}

/** A scripted pull on both solvers, phase by phase: gpuParityHarness's runPullParity. */
async function pullRows(core: GpuCore, fixture: Fixture): Promise<PullRow[]> {
  const rows: PullRow[] = [];
  for (const integrationType of INTEGRATORS) {
    const base = { fixture: fixture.name, integrator: integrationType };
    try {
      const referenceModel = modelOf(fixture);
      const reference = new ReferenceSolver(referenceModel, { foldPercent: FOLD_PERCENT, integrationType });
      const gpu = await WebgpuSolver.create(modelOf(fixture), { foldPercent: FOLD_PERCENT, integrationType }, core);
      try {
        const { indices, vertexCount } = referenceModel.prepared;
        const mask = new Uint8Array(vertexCount);
        for (let corner = 0; corner < 3; corner += 1) mask[indices[corner]!] = 1;
        const both = (act: (solver: ReferenceSolver | WebgpuSolver) => void) => {
          act(reference);
          act(gpu);
        };
        both((solver) => solver.step(40));
        both((solver) => solver.setFixedNodes(mask));
        const held = await positionsOf(gpu, vertexCount);

        // The grip: the triangle whose centre is farthest from the held one's.
        const centre = (positions: Float32Array, triangle: number): [number, number, number] => {
          const out: [number, number, number] = [0, 0, 0];
          for (let corner = 0; corner < 3; corner += 1) {
            const node = indices[triangle * 3 + corner]!;
            for (let axis = 0; axis < 3; axis += 1) out[axis] += positions[node * 3 + axis]! / 3;
          }
          return out;
        };
        const anchor = centre(referenceModel.positions, 0);
        let far = 0;
        let farthest = -1;
        for (let triangle = 0; triangle < indices.length / 3; triangle += 1) {
          const c = centre(referenceModel.positions, triangle);
          const d = Math.hypot(c[0] - anchor[0], c[1] - anchor[1], c[2] - anchor[2]);
          if (d > farthest) {
            farthest = d;
            far = triangle;
          }
        }
        const at = centre(referenceModel.positions, far);
        const direction: [number, number, number] = [Math.SQRT1_2, 0, Math.SQRT1_2];
        const rayThrough = (lift: number, side: number) => ({
          origin: [at[0] - direction[0] * 5 - side, at[1] + lift, at[2] - direction[2] * 5 + side] as [number, number, number],
          direction,
        });
        const grip = {
          nodes: [indices[far * 3]!, indices[far * 3 + 1]!, indices[far * 3 + 2]!] as [number, number, number],
          weights: [1 / 3, 1 / 3, 1 / 3] as [number, number, number],
          ray: rayThrough(0.25, 0),
        };
        const compareNow = async (phase: PullRow['phase'], movedCreases?: PullRow['movedCreases']) => {
          const now = await positionsOf(gpu, vertexCount);
          rows.push({
            ...base,
            phase,
            maxAbs: maxAbs(now, referenceModel.positions.slice(0, vertexCount * 3)),
            heldDrift: maxDriftOf(mask, held, now),
            ...(movedCreases ? { movedCreases } : {}),
          });
        };

        both((solver) => solver.beginPull(grip));
        both((solver) => solver.step(60));
        await compareNow('pulling');

        // The app refreshes the GPU's reads every tick; the script catches them up before letting go.
        await gpu.syncReads();
        const kept = { reference: reference.endPull('keep').movedCreases, gpu: gpu.endPull('keep').movedCreases };
        both((solver) => solver.step(40));
        await compareNow('kept', kept);

        await gpu.syncReads();
        both((solver) => solver.beginPull({ ...grip, ray: rayThrough(0.1, 0.2) }));
        both((solver) => solver.step(20));
        both((solver) => solver.endPull('cancel'));
        both((solver) => solver.step(20));
        await compareNow('cancelled');

        both((solver) => solver.releasePose());
        both((solver) => solver.step(40));
        await compareNow('released');
      } finally {
        gpu.dispose();
      }
    } catch (error) {
      rows.push({ ...base, phase: 'pulling', maxAbs: Number.NaN, heldDrift: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return rows;
}

/** Read a shape, write it into a fresh solver, read it again: gpuParityHarness's runShapeChecks. */
async function shapeRows(core: GpuCore, fixture: Fixture): Promise<ShapeRow[]> {
  const rows: ShapeRow[] = [];
  for (const integrationType of INTEGRATORS) {
    const row: ShapeRow = { fixture: fixture.name, integrator: integrationType, roundTrip: false, positionsMatch: false };
    try {
      const model = modelOf(fixture);
      const source = await WebgpuSolver.create(model, { foldPercent: FOLD_PERCENT, integrationType }, core);
      const target = await WebgpuSolver.create(modelOf(fixture), { foldPercent: FOLD_PERCENT, integrationType }, core);
      try {
        const vertices = model.prepared.vertexCount;
        const creases = model.prepared.creaseParams.length;
        source.step(120);
        const shape = createSolverShape(vertices, creases);
        await source.syncReads();
        source.readShape(shape);
        const before = await positionsOf(source, vertices);
        target.writeShape(shape, true);
        const again = createSolverShape(vertices, creases);
        target.readShape(again);
        const bytes = (s: typeof shape) => new Uint8Array([...new Uint8Array(s.offsets.buffer), ...new Uint8Array(s.theta.buffer)]);
        row.roundTrip = bytes(shape).join() === bytes(again).join();
        row.positionsMatch = maxAbs(await positionsOf(target, vertices), before) === 0;
      } finally {
        source.dispose();
        target.dispose();
      }
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error);
    }
    rows.push(row);
  }
  return rows;
}

export async function runBackendChecks(core: GpuCore, durationMs = 800): Promise<BackendReport> {
  const report: BackendReport = { rows: [], integrators: [], pulls: [], shapes: [] };
  for (const fixture of FIXTURES) {
    if (fixture.degenerate) continue;
    report.rows.push(await runFixture(core, fixture, durationMs));
    report.integrators.push(...(await integratorRows(core, fixture)));
    report.pulls.push(...(await pullRows(core, fixture)));
    report.shapes.push(...(await shapeRows(core, fixture)));
  }
  return report;
}
