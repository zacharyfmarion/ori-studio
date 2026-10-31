// Row types and the text table for the backend benchmark (bench/backendBench).
// Shared by the page, which prints the table, and backendBench.bench.ts, which
// prints the same table from a headless run.

export type BackendName = 'webgpu' | 'webgl2' | 'reference';

export const BACKENDS: readonly BackendName[] = ['webgpu', 'webgl2', 'reference'];

export interface BackendBenchOptions {
  /** Fixture names to run; empty runs every non-degenerate fixture. */
  fixtures: string[];
  backends: BackendName[];
  /** Fold target the settle runs to, and the live loop holds. */
  foldPercent: number;
  /** Steps per live tick, as the app's worker runs: GPU_STEPS_PER_TICK in simulatorSession.ts. */
  stepsPerTick: number;
  /** How long the live loop runs per backend. */
  durationMs: number;
  /** Step cap for the settle. */
  settleMaxSteps: number;
  /** Wall-time cap for the settle, so the CPU solver on a large model cannot hold up the run for minutes. */
  settleBudgetMs: number;
  /** Steps from the flat sheet at which each GPU backend's positions are compared with the CPU reference's. */
  accuracySteps: number;
  /** Frames timed per backend, after a few to warm. */
  frames: number;
  /** Square frame size in pixels. */
  frameSize: number;
}

export const BACKEND_BENCH_DEFAULTS: BackendBenchOptions = {
  fixtures: [],
  backends: [...BACKENDS],
  foldPercent: 60,
  stepsPerTick: 80,
  durationMs: 2000,
  settleMaxSteps: 20_000,
  settleBudgetMs: 30_000,
  accuracySteps: 500,
  frames: 60,
  frameSize: 512,
};

export interface BackendBenchRow {
  fixture: string;
  vertices: number;
  backend: BackendName;
  /** Live loop: steps per second with one motion sample per tick, samples pipelined as the clock does. */
  stepsPerSecond: number;
  /** Wall time for SimulationClock.settle from the flat sheet to the fold target. */
  settleMs: number;
  settleSteps: number;
  settled: boolean;
  /**
   * Largest distance of any node from where ReferenceSolver puts it after
   * `accuracySteps` steps from the same flat sheet, in model units. Null for
   * the reference itself. Above {@link ACCURACY_LIMIT} is a failure.
   */
  maxDeviation: number | null;
  /** Frame time, draw plus waiting for the GPU to finish it; null for the CPU backend, which does not draw. */
  frameMs: { p50: number; p95: number } | null;
  error?: string;
}

export interface BackendBenchReport {
  /** The WebGPU adapter and the WebGL2 renderer, as the browser names them. */
  webgpuAdapter: string;
  webglRenderer: string;
  userAgent: string;
  options: BackendBenchOptions;
  rows: BackendBenchRow[];
}

/**
 * The parity gate's Tier C: the float32 CPU-vs-GPU divergence of this
 * algorithm (bench/gpuParity.bench.ts). A backend past it computes a
 * different fold, however fast it is.
 */
export const ACCURACY_LIMIT = 1e-3;

function deviation(value: number | null): string {
  if (value === null) return '-';
  if (!Number.isFinite(value)) return 'NaN!';
  return `${value.toExponential(1)}${value > ACCURACY_LIMIT ? '!' : ''}`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function padStart(text: string, width: number): string {
  return text.length >= width ? text : ' '.repeat(width - text.length) + text;
}

function rate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '-';
  return value >= 10_000 ? `${(value / 1000).toFixed(0)}k` : value.toFixed(0);
}

function ms(value: number): string {
  return Number.isFinite(value) ? value.toFixed(value < 10 ? 2 : 0) : '-';
}

export function formatBackendBench(report: BackendBenchReport): string {
  const { options } = report;
  const lines = [
    `WebGPU adapter: ${report.webgpuAdapter}`,
    `WebGL2 renderer: ${report.webglRenderer}`,
    `Browser: ${report.userAgent}`,
    `Fold ${options.foldPercent}%, ${options.stepsPerTick} steps per tick, ${options.durationMs}ms live loop, ` +
      `${options.frames} frames at ${options.frameSize}px, accuracy after ${options.accuracySteps} steps`,
    '',
    [
      pad('fixture', 14),
      padStart('nodes', 6),
      pad('  backend', 11),
      padStart('steps/s', 9),
      padStart('vs CPU', 8),
      padStart('settle ms', 11),
      padStart('steps', 7),
      padStart('max dev', 10),
      padStart('frame p50', 11),
      padStart('p95', 7),
    ].join(''),
  ];
  const cpu = new Map(
    report.rows.filter((row) => row.backend === 'reference' && !row.error).map((row) => [row.fixture, row.stepsPerSecond])
  );
  for (const row of report.rows) {
    const head = pad(row.fixture, 14) + padStart(String(row.vertices), 6) + pad(`  ${row.backend}`, 11);
    if (row.error) {
      lines.push(`${head}  ERROR: ${row.error}`);
      continue;
    }
    const base = cpu.get(row.fixture);
    const speedup = base ? `${(row.stepsPerSecond / base).toFixed(1)}x` : '-';
    lines.push(
      head +
        padStart(rate(row.stepsPerSecond), 9) +
        padStart(speedup, 8) +
        padStart(ms(row.settleMs), 11) +
        padStart(`${row.settleSteps}${row.settled ? '' : '!'}`, 7) +
        padStart(deviation(row.maxDeviation), 10) +
        padStart(row.frameMs ? ms(row.frameMs.p50) : '-', 11) +
        padStart(row.frameMs ? ms(row.frameMs.p95) : '-', 7)
    );
  }
  lines.push(
    '',
    '"!" after steps: hit the step or time cap before settling. Frame time includes waiting for the GPU.',
    `max dev: furthest any node is from the CPU reference's position, model units; "!" past ${ACCURACY_LIMIT}.`
  );
  return lines.join('\n');
}
