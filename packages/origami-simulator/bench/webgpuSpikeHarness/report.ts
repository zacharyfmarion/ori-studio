// The spike's result shapes and their text form, shared by the page (main.ts)
// and the Node driver (../webgpuSpike.bench.ts). Kept apart from main.ts, which
// touches the DOM as it loads.
import type { MotionSample } from '../../src/webgpu/motionReduction.js';

export interface SpikeOptions {
  foldPercent: number;
  steps: number;
  /** Passes per timed batch. */
  batch: number;
  /** Calls averaged for each readback timing. */
  samples: number;
}

export interface SpikeRow {
  fixture: string;
  vertices: number;
  faces: number;
  /** Largest per-component difference between the two normals passes. */
  normalsMaxAbs: number;
  webgl: MotionSample;
  webgpu: MotionSample;
  /** Both motion figures identical, NaN included. */
  motionExact: boolean;
  /** A NaN velocity and an infinite strain each reported as NaN. */
  nonFiniteCaught: boolean;
  /** Mean ms for WebglSolver.maxVelocity(): a whole-texture readPixels and a CPU scan. */
  webglMaxVelocityMs: number;
  /** Mean ms from MotionReduction.sample() to its 12 bytes landing. */
  webgpuSampleMs: number;
  /** ms for `batch` normal passes and one read of the result, each API. */
  webglNormalsBatchMs: number;
  webgpuNormalsBatchMs: number;
  error?: string;
}

export interface SpikeReport {
  adapter: string;
  webglRenderer: string;
  rows: SpikeRow[];
  error?: string;
}

/** The report as the text the bench prints and the page shows. */
export function formatReport(report: SpikeReport): string {
  const head = [`WebGPU adapter: ${report.adapter}`, `WebGL2 renderer: ${report.webglRenderer}`];
  if (report.error) return [...head, `ERROR: ${report.error}`].join('\n');
  const fmt = (value: number) => (Number.isFinite(value) ? value.toFixed(3).padStart(9) : String(value).padStart(9));
  const lines = report.rows.map((row) =>
    row.error
      ? `${row.fixture.padEnd(14)} ERROR: ${row.error}`
      : `${row.fixture.padEnd(14)} v=${String(row.vertices).padStart(5)} f=${String(row.faces).padStart(5)} | ` +
        `normals Δ ${row.normalsMaxAbs.toExponential(1)}  motion ${row.motionExact ? 'exact' : 'DIFFERS'}  ` +
        `non-finite ${row.nonFiniteCaught ? 'caught' : 'MISSED'} | ` +
        `maxVelocity gl ${fmt(row.webglMaxVelocityMs)} gpu ${fmt(row.webgpuSampleMs)} ms | ` +
        `normals×batch gl ${fmt(row.webglNormalsBatchMs)} gpu ${fmt(row.webgpuNormalsBatchMs)} ms`
  );
  return [...head, ...lines].join('\n');
}

export interface FullStepOptions {
  foldPercent: number;
  /** Steps per solve: what the app runs per displayed frame. */
  stepsPerSolve: number;
  /** Solves queued between syncs, as the WebGPU port's own benchmark does. */
  solvesPerSync: number;
  /** Timed milliseconds per solver per fixture. */
  durationMs: number;
}

/** One fixture's full-step comparison; see fullStep.ts. */
export interface FullStepRow {
  fixture: string;
  vertices: number;
  /** Largest displacement difference from WebglSolver after `stepsPerSolve` steps from flat. */
  maxAbs: number;
  /** Steps per second, each solver alone, synced every `solvesPerSync` solves. */
  webgl: number;
  /**
   * WebglSolver as the original Origami Simulator drives it: the whole position
   * texture read back after every solve, so the CPU waits for each frame.
   */
  webglReadback: number;
  asWritten: number;
  cached: number;
  error?: string;
}

export interface FullStepReport {
  adapter: string;
  options: FullStepOptions;
  rows: FullStepRow[];
  error?: string;
}

/** Steps per second as the bench prints and the page shows them. */
export function formatFullStep(report: FullStepReport): string {
  const { stepsPerSolve, solvesPerSync } = report.options;
  const head = [
    `Full Euler step, steps per second (${stepsPerSolve} steps per solve, synced every ${solvesPerSync} solves)`,
    `WebGPU adapter: ${report.adapter}`,
  ];
  if (report.error) return [...head, `ERROR: ${report.error}`].join('\n');
  const rate = (value: number) => String(Math.round(value)).padStart(8);
  const ratio = (value: number, base: number) => `${(value / base).toFixed(2)}x`.padStart(6);
  const lines = report.rows.map((row) =>
    row.error
      ? `${row.fixture.padEnd(14)} ERROR: ${row.error}`
      : `${row.fixture.padEnd(14)} v=${String(row.vertices).padStart(5)} | Δ ${row.maxAbs.toExponential(1)} | ` +
        `WebGL2 ${rate(row.webgl)} | WebGL2 + readback ${rate(row.webglReadback)} ${ratio(row.webglReadback, row.webgl)} | port as written ${rate(row.asWritten)} ${ratio(row.asWritten, row.webgl)} | ` +
        `port, cached ${rate(row.cached)} ${ratio(row.cached, row.webgl)}`
  );
  return [...head, ...lines].join('\n');
}

/** One fixture's checks of WebgpuSolver; see backend.ts. */
export interface BackendRow {
  fixture: string;
  vertices: number;
  /** Largest position difference from ReferenceSolver, by steps from flat. */
  vsReference: Record<number, number>;
  /** Largest position difference from WebglSolver after the most steps. */
  vsWebgl: number;
  /** From ReferenceSolver, through a fold and material change mid-run. */
  retarget: number;
  /** reset() put every node back on the flat sheet, exactly. */
  resetExact: boolean;
  /** arrestDynamics() left the paper with zero velocity. */
  arrestStill: boolean;
  /** Steps SimulationClock took to settle; -1 for no convergence, null if not run. */
  settle: { gpu: number | null; webgl: number | null };
  /** Steps a second, synced on a motion sample every 8 solves of 100 steps, as the clock does. */
  stepsPerSecond: { gpu: number; webgl: number };
  error?: string;
}

/** One integrator, pinned or not, against ReferenceSolver after `steps` from flat. */
export interface IntegratorRow {
  fixture: string;
  integrator: 'euler' | 'verlet';
  pinned: boolean;
  steps: number;
  maxAbs: number;
  /** Pinned rows: how far a node told to hold moved. */
  heldDrift: number;
  error?: string;
}

/** One phase of a scripted pull, against ReferenceSolver. */
export interface PullRow {
  fixture: string;
  integrator: 'euler' | 'verlet';
  phase: 'pulling' | 'kept' | 'cancelled' | 'released';
  maxAbs: number;
  heldDrift: number;
  movedCreases?: { reference: number; gpu: number };
  error?: string;
}

/** A shape read back, written into a fresh solver, and read again. */
export interface ShapeRow {
  fixture: string;
  integrator: 'euler' | 'verlet';
  /** Every byte of the shape the same after the trip. */
  roundTrip: boolean;
  /** The restored solver's positions are the source's, exactly. */
  positionsMatch: boolean;
  error?: string;
}

export interface BackendReport {
  rows: BackendRow[];
  integrators: IntegratorRow[];
  pulls: PullRow[];
  shapes: ShapeRow[];
}

export function formatBackend(report: BackendReport): string {
  const exp = (value: number) => (Number.isFinite(value) ? value.toExponential(1) : String(value));
  const lines = report.rows.map((row) => {
    if (row.error) return `${row.fixture.padEnd(14)} ERROR: ${row.error}`;
    const reference = Object.entries(row.vsReference)
      .map(([steps, delta]) => `${steps}:${exp(delta)}`)
      .join(' ');
    const rate = row.stepsPerSecond;
    return (
      `${row.fixture.padEnd(14)} v=${String(row.vertices).padStart(5)} | vs reference ${reference} | ` +
      `vs WebGL2 ${exp(row.vsWebgl)} | retarget ${exp(row.retarget)} | reset ${row.resetExact ? 'exact' : 'OFF'} | ` +
      `arrest ${row.arrestStill ? 'still' : 'MOVING'} | settle gpu ${row.settle.gpu} gl ${row.settle.webgl} | ` +
      `steps/s gpu ${Math.round(rate.gpu)} gl ${Math.round(rate.webgl)} ${(rate.gpu / rate.webgl).toFixed(2)}x`
    );
  });
  const integrators = report.integrators.map((row) =>
    row.error
      ? `${row.fixture.padEnd(14)} ${row.integrator.padEnd(6)} ERROR: ${row.error}`
      : `${row.fixture.padEnd(14)} ${row.integrator.padEnd(6)} ${row.pinned ? 'pinned' : '      '} steps=${String(row.steps).padStart(3)} | ` +
        `max ${exp(row.maxAbs)}${row.pinned ? `  held drift ${exp(row.heldDrift)}` : ''}`
  );
  const pulls = report.pulls.map((row) =>
    row.error
      ? `${row.fixture.padEnd(14)} ${row.integrator.padEnd(6)} ERROR: ${row.error}`
      : `${row.fixture.padEnd(14)} ${row.integrator.padEnd(6)} ${row.phase.padEnd(9)} | max ${exp(row.maxAbs)}  held drift ${exp(row.heldDrift)}` +
        (row.movedCreases ? `  moved creases ${row.movedCreases.reference}/${row.movedCreases.gpu}` : '')
  );
  const shapes = report.shapes.map((row) =>
    row.error
      ? `${row.fixture.padEnd(14)} ${row.integrator.padEnd(6)} ERROR: ${row.error}`
      : `${row.fixture.padEnd(14)} ${row.integrator.padEnd(6)} | round trip ${row.roundTrip ? 'exact' : 'DIFFERS'}  positions ${row.positionsMatch ? 'exact' : 'DIFFER'}`
  );
  return [
    'WebgpuSolver',
    ...lines,
    '',
    'WebgpuSolver integrators',
    ...integrators,
    '',
    'WebgpuSolver pull',
    ...pulls,
    '',
    'WebgpuSolver shapes',
    ...shapes,
  ].join('\n');
}

/** One fixture drawn by both renderers; see render.ts. */
export interface RenderRow {
  fixture: string;
  /** Share of the WebGPU frame that is not background. */
  coverage: number;
  /** Share of pixels where the two renderers differ past antialiasing noise: paper, strain, x-ray. */
  differs: number;
  differsStrain: number;
  differsXray: number;
  /** The highlight pass tints the frame that asks for it, and no other. */
  highlightTints: boolean;
  highlightOnlyWhenAsked: boolean;
  error?: string;
}

/** A WebGPU context on an OffscreenCanvas presents through createImageBitmap, as the session uses it. */
export interface CanvasRow {
  presents: boolean;
  /** The device was lost on presenting, which SwiftShader does. */
  deviceLost: boolean;
  error?: string;
}

export interface RenderReport {
  rows: RenderRow[];
  canvas: CanvasRow;
}

export function formatRender({ rows, canvas }: RenderReport): string {
  const pct = (value: number) => `${(value * 100).toFixed(2)}%`.padStart(7);
  const lines = rows.map((row) =>
    row.error
      ? `${row.fixture.padEnd(14)} ERROR: ${row.error}`
      : `${row.fixture.padEnd(14)} coverage ${pct(row.coverage)} | differs from WebGL2: paper ${pct(row.differs)} strain ${pct(row.differsStrain)} ` +
        `x-ray ${pct(row.differsXray)} | highlight ${row.highlightTints ? 'tints' : 'NONE'}/${row.highlightOnlyWhenAsked ? 'clean' : 'LEAKS'}`
  );
  const presented = canvas.presents
    ? 'presents'
    : `BLANK${canvas.deviceLost ? ' (device lost on presenting)' : ''}${canvas.error ? `: ${canvas.error}` : ''}`;
  return ['WebGPU renderer', ...lines, `OffscreenCanvas through createImageBitmap: ${presented}`].join('\n');
}
