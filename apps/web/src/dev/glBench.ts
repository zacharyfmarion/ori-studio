/**
 * Which GL context attribute is charging ~8ms a frame in WebKit.
 *
 * `implementation-plans/inline-simulation-performance.md` established that a
 * render's cost tracks the *shared drawing buffer* rather than the window being
 * drawn: a 783x783 crop out of a 2048x2048 buffer costs the same as a
 * 2048x2048 one, and ten times what the same crop costs at a 512x512 buffer.
 * What it did not establish is why, and there are two candidates that scale
 * identically — buffer area times sample count — so no measurement that varies
 * buffer size alone can separate them:
 *
 *   - `preserveDrawingBuffer: false`, which leaves the buffer's contents
 *     undefined after a read and is satisfied by clearing the whole thing.
 *   - `antialias: true`, which makes the buffer multisampled, so every read
 *     resolves 4 samples down to 1.
 *
 * There is a third candidate the plan states as fact rather than as a finding:
 * that `createImageBitmap` triggers the implicit clear at all. Compositing does,
 * per spec; reading a canvas is not compositing, and whether it counts is
 * implementation-defined. So that causal story is under test here too.
 *
 * This crosses the two attributes, which is the only way to tell them apart:
 * if the row moves it is the clear, if the column moves it is the resolve, if
 * both move we learn the split, and if neither moves both hypotheses are dead
 * and the cost is somewhere nobody has looked.
 *
 * Runs headless and unattended — no gesture, no animation frame. The cost is
 * per-render, so N sequential renders measure it exactly, and a scripted loop
 * pins the camera, buffer and crop that a hand-driven orbit would drift. That
 * is what lets it run inside the desktop shell, which is the engine that
 * matters and the one nobody can drive a console in.
 */

import { wrap, type Remote } from 'comlink';
import type { FoldDocument } from '@treemaker/origami-simulator';
import type { GlBenchResult, SimulatorWorkerApi } from '../workers/simulatorWorker';

/** The 2x2. `aa` is `antialias`, `pdb` is `preserveDrawingBuffer`. */
const ARMS = [
  { aa: true, pdb: false },
  { aa: true, pdb: true },
  { aa: false, pdb: false },
  { aa: false, pdb: true },
] as const;

/**
 * Cycled, not blocked: ABCD ABCD ABCD rather than AAA BBB CCC DDD.
 *
 * GPU clock and thermal state drift over a run lasting minutes, and running the
 * arms in blocks turns that drift into a difference between arms that looks
 * exactly like an effect.
 */
const REPEATS = 3;

const FRAMES = 200;
/** Discarded: the first renders after a context is made include shader compile
 * and texture upload, which have nothing to do with what is being measured. */
const WARMUP = 20;

/**
 * The window actually drawn, in device pixels — the observed real case.
 *
 * Small, and deliberately not what sets the buffer size.
 */
const DRAWN_EDGE = 783;

/**
 * A second, larger window, whose only job is to pin the shared buffer at its
 * 2048 cap.
 *
 * This is what makes the bench reproduce the bug rather than a tidier cousin of
 * it. Buffer size follows the largest request across *every* live session, so
 * in the real app one big window forces the buffer up and every small window
 * then pays for it. A single-session bench would sit at a 1024 buffer and
 * measure a problem nobody has.
 */
const PINNING_EDGE = 3648;

/**
 * Long enough to clear both `ACTIVE_RENDER_MS` (a window stops counting towards
 * the buffer's size) and `SHRINK_HOLD_MS` (the buffer is allowed to shrink).
 */
const IDLE_SETTLE_MS = 2000;

export interface GlBenchRun {
  label: string;
  repeat: number;
  meshTriangles: number;
  result: GlBenchResult;
}

/**
 * A flat triangulated grid.
 *
 * Every interior edge is a facet crease, so nothing folds and the sheet stays
 * flat and numerically dead still — a benchmark should not also be a physics
 * simulation. Trivial geometry is not a weakness here but the point: if a flat
 * sheet costs 8ms at a 2048 buffer, the cost is provably not the drawing. The
 * caller runs two sizes so that claim is tested rather than assumed.
 */
function gridFold(cells: number): FoldDocument {
  const vertices: number[][] = [];
  for (let row = 0; row <= cells; row += 1) {
    for (let col = 0; col <= cells; col += 1) {
      vertices.push([col / cells, row / cells]);
    }
  }
  const index = (row: number, col: number) => row * (cells + 1) + col;
  const faces: number[][] = [];
  const edges = new Map<string, [number, number]>();
  const addEdge = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (!edges.has(key)) edges.set(key, a < b ? [a, b] : [b, a]);
  };
  for (let row = 0; row < cells; row += 1) {
    for (let col = 0; col < cells; col += 1) {
      const tl = index(row, col);
      const tr = index(row, col + 1);
      const bl = index(row + 1, col);
      const br = index(row + 1, col + 1);
      faces.push([tl, tr, br], [tl, br, bl]);
      addEdge(tl, tr);
      addEdge(tr, br);
      addEdge(br, bl);
      addEdge(bl, tl);
      addEdge(tl, br);
    }
  }
  const edgeList = [...edges.values()];
  const onBoundary = ([a, b]: [number, number]) => {
    const ar = Math.floor(a / (cells + 1));
    const ac = a % (cells + 1);
    const br = Math.floor(b / (cells + 1));
    const bc = b % (cells + 1);
    return (
      (ar === 0 && br === 0) ||
      (ar === cells && br === cells) ||
      (ac === 0 && bc === 0) ||
      (ac === cells && bc === cells)
    );
  };
  return {
    vertices_coords: vertices,
    edges_vertices: edgeList,
    edges_assignment: edgeList.map((edge) => (onBoundary(edge) ? 'B' : 'F')),
    faces_vertices: faces,
  } as unknown as FoldDocument;
}

/** A fresh worker, and therefore a fresh GL context, per arm. */
function spawn(): { worker: Worker; client: Remote<SimulatorWorkerApi> } {
  const worker = new Worker(new URL('../workers/simulatorWorker.ts', import.meta.url), {
    type: 'module',
  });
  return { worker, client: wrap<SimulatorWorkerApi>(worker) };
}

async function runArm(
  arm: (typeof ARMS)[number],
  repeat: number,
  cells: number,
  pinBuffer: boolean
): Promise<GlBenchRun | null> {
  const { worker, client } = spawn();
  try {
    // Before anything can make a context. This is the whole experiment.
    await client.configureGl({ antialias: arm.aa, preserveDrawingBuffer: arm.pdb });
    await client.attachBitmapOutput(64, 64);
    const fold = gridFold(cells);

    if (pinBuffer) {
      // Loaded and given a large camera purely so the shared buffer grows. It is
      // never rendered in the measured loop.
      const big = await client.load(fold, { prepare: { triangulate: true }, preferGpu: true });
      await client.setCamera(
        { view: { yaw: 0.7, pitch: -0.9, zoom: 1.4 }, width: PINNING_EDGE, height: PINNING_EDGE },
        big.token
      );
      // Left to go idle before anything is measured. `setCamera` draws, so
      // without this the neighbour is still a window *in use* for the first
      // second of the measured loop and the run would time a mixture of two
      // buffer sizes. The wait is what makes "idle neighbour" mean it.
      await new Promise((resolve) => setTimeout(resolve, IDLE_SETTLE_MS));
    }

    const drawn = await client.load(fold, { prepare: { triangulate: true }, preferGpu: true });
    const result = await client.glBench({
      token: drawn.token,
      frames: FRAMES,
      warmup: WARMUP,
      request: { width: DRAWN_EDGE, height: DRAWN_EDGE },
    });
    if (!result) return null;
    return {
      label: `aa=${arm.aa ? 1 : 0},pdb=${arm.pdb ? 1 : 0}${pinBuffer ? '' : ',unpinned'}`,
      repeat,
      meshTriangles: cells * cells * 2,
      result,
    };
  } finally {
    worker.terminate();
  }
}

function line(run: GlBenchRun): string {
  const { result } = run;
  const size = (v: { width: number; height: number }) => `${v.width}x${v.height}`;
  const stat = (s: { p50: number; p95: number; max: number }) =>
    `p50 ${s.p50.toFixed(2)} p95 ${s.p95.toFixed(2)} max ${s.max.toFixed(2)}`;
  return (
    `[glbench] ${run.label} r${run.repeat} tris ${run.meshTriangles} | ` +
    `buffer ${size(result.buffer)} crop ${size(result.crop)} canvas ${size(result.canvas)} | ` +
    // First, because a run with zero coverage rendered nothing and the timings
    // that follow it are meaningless however good they look.
    `painted ${(result.coverage * 100).toFixed(1)}% | ` +
    `draw ${stat(result.draw)} | snapshot ${stat(result.snapshot)} | ` +
    `resize ${stat(result.resize)} | total ${stat(result.total)}`
  );
}

/**
 * Phase two: what the buffer actually costs, and what sizing it to the caller
 * would cost instead.
 *
 * Runs only once the 2x2 has shown the attributes to be irrelevant, because
 * that is what makes buffer size the only remaining variable and therefore the
 * only thing worth a curve.
 *
 * The crop is held at 256 throughout, well under the smallest buffer, so the
 * buffer is varied against a fixed amount of actual drawing. Anything that
 * moves is the buffer.
 */
async function runBufferCurve(): Promise<GlBenchRun[]> {
  const runs: GlBenchRun[] = [];
  const CROP = 256;
  // Chosen to land in distinct quantisation buckets: bitmapCanvasEdge rounds up
  // to a power of two and caps at 2048.
  const PINS: Array<[string, number]> = [
    ['buf512', 400],
    ['buf1024', 800],
    ['buf2048', 1600],
  ];
  for (let repeat = 1; repeat <= REPEATS; repeat += 1) {
    for (const [label, pin] of PINS) {
      const { worker, client } = spawn();
      try {
        await client.attachBitmapOutput(64, 64);
        const fold = gridFold(100);
        const big = await client.load(fold, { prepare: { triangulate: true }, preferGpu: true });
        await client.setCamera(
          { view: { yaw: 0.7, pitch: -0.9, zoom: 1.4 }, width: pin, height: pin },
          big.token
        );
        const drawn = await client.load(fold, { prepare: { triangulate: true }, preferGpu: true });
        const result = await client.glBench({
          token: drawn.token,
          frames: FRAMES,
          warmup: WARMUP,
          request: { width: CROP, height: CROP },
        });
        if (result) runs.push({ label, repeat, meshTriangles: 20000, result });
      } finally {
        worker.terminate();
      }
    }

    // The worst case for caller-sized buffers: two windows in different buckets
    // alternating, so every single render reallocates. If even this beats the
    // standing cost of a pinned 2048 buffer, the policy question is settled.
    const { worker, client } = spawn();
    try {
      await client.attachBitmapOutput(64, 64);
      const fold = gridFold(100);
      const drawn = await client.load(fold, { prepare: { triangulate: true }, preferGpu: true });
      const result = await client.glBench({
        token: drawn.token,
        frames: FRAMES,
        warmup: WARMUP,
        request: { width: CROP, height: CROP },
        alternateWith: { width: 1600, height: 1600 },
      });
      if (result) runs.push({ label: 'alternating', repeat, meshTriangles: 20000, result });
    } finally {
      worker.terminate();
    }
  }
  for (const run of runs) report([line(run)]);
  return runs;
}

/**
 * Which engine a line came from, on *every* line rather than only in a header.
 *
 * Both engines post to one dev-server log, and they interleave: leaving the
 * engine to a `=== start` banner and inferring the rest by position silently
 * mixed a Chromium re-run into a WebKit sweep, and the two differ by three
 * orders of magnitude. A per-line tag makes that unrepresentable.
 *
 * Read from the Tauri global rather than the user agent, because a WKWebView
 * and Safari report nearly the same string and telling those apart is the whole
 * point. Same rule as `simulatorPerfProbe.engineTag`.
 */
function engineTag(): string {
  const tauri = '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
  const ua = navigator.userAgent;
  const engine = /\bChrome\//.test(ua)
    ? 'chromium'
    : /\bAppleWebKit\//.test(ua)
      ? 'webkit'
      : 'other';
  return tauri ? `${engine}-tauri` : engine;
}

function report(lines: readonly string[]): void {
  const tagged = lines.map((text) => text.replace('[glbench]', `[glbench:${engineTag()}]`));
  for (const text of tagged) console.log(text);
  void fetch('/__sim-perf', {
    method: 'POST',
    body: `${tagged.join('\n')}\n`,
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * The whole grid, start to finish. Resolves when every arm has been measured.
 *
 * Two mesh sizes, because "the cost is the buffer, not the drawing" is a claim
 * this bench is supposed to test rather than inherit — a 200x and a 20000x
 * triangle count that time the same is what makes it evidence.
 */
export async function runGlBench(onProgress?: (text: string) => void): Promise<GlBenchRun[]> {
  const runs: GlBenchRun[] = [];
  const emit = (text: string) => {
    onProgress?.(text);
  };
  const engine = navigator.userAgent;
  report([
    `[glbench] === start | ${ARMS.length} arms x ${REPEATS} repeats | ` +
      `frames ${FRAMES} warmup ${WARMUP} | dpr ${window.devicePixelRatio} | ${engine}`,
  ]);

  for (let repeat = 1; repeat <= REPEATS; repeat += 1) {
    for (const arm of ARMS) {
      // Two mesh sizes on the first pass only. A 100x difference in triangle
      // count that changes nothing is established after one clean pass; paying
      // for it three times over just makes the sweep too slow to iterate on.
      for (const cells of repeat === 1 ? [10, 100] : [100]) {
        const run = await runArm(arm, repeat, cells, true);
        if (!run) continue;
        runs.push(run);
        const text = line(run);
        report([text]);
        emit(text);
      }
    }
  }

  // The comparison the fix is judged on. Identical in every respect except
  // whether a second, larger window exists beside the one being drawn — which
  // under the old sizing policy was worth 3x on every frame, and under the new
  // one should be worth nothing, because that window is not drawing.
  report(['[glbench] --- idle neighbour ---']);
  for (const repeat of [1, 2, 3]) {
    for (const pinned of [true, false]) {
      const run = await runArm(ARMS[0], repeat, 100, pinned);
      if (!run) continue;
      runs.push(run);
      const text = line(run);
      report([text]);
      emit(text);
    }
  }

  report(['[glbench] --- buffer curve ---']);
  runs.push(...(await runBufferCurve()));

  report(['[glbench] === done']);
  return runs;
}
