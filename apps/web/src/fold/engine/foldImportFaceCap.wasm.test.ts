// @vitest-environment node
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createFoldReplayer } from '../document/foldReplay';
import { sequenceOf, step, valleyAt } from '../document/foldSequence.fixtures';
import type { FoldCpJumpOp, FoldPlainOp } from '../document/foldSequenceDocument';
import { FOLD_MAX_FACES } from '../foldFaceCap';
import { createFoldEngineCalls, type FoldEngineCalls } from './foldEngineCalls';
import { createFoldEngineIoCalls, type FoldEngineIoCalls } from './foldEngineIoCalls';
import { FOLD_SAMPLES, foldSampleSource } from './foldEngineIoSamples';
import { createFoldEnginePort, type FoldEngineSource } from './foldEnginePort';

/**
 * The face cap (`oristudio_layer_order::MAX_FACES`) over the real bridge, in
 * a fresh wasm instance each time so its heap is the call's alone: a crease
 * pattern over the cap is refused by its count before the layer order's
 * tables over every pair of faces are built — the tables that ran the worker
 * out of memory — and a saved sequence holding such a step opens with that
 * step broken and the rest of it folding.
 *
 * The stacking cap (`oristudio_layer_order::MAX_STACKED_TRIPLES`) the same
 * way: a pattern whose layers stack too deeply is refused by its count of
 * overlapping triples before any order is looked for, and so is a fold that
 * would stack them so; a saved sequence holding either opens with that step
 * broken and the rest of it folding.
 *
 * Below the CI tests is the measurement the face cap was chosen from, run
 * only with `FOLD_MEASURE=<file>` (rows are appended to the file; the `map`
 * family is the stacking cap's, every face on one stack):
 *
 *     FOLD_MEASURE=/tmp/rows.txt FOLD_MEASURE_SIZES=50,64,100 FOLD_MEASURE_FAMILIES=precrease,pleats \
 *       npm --workspace @treemaker/web exec -- vitest run src/fold/engine/foldImportFaceCap.wasm.test.ts
 *
 * Skipped when the bridge has not been built; CI builds it first.
 */
const ROOT = process.cwd();
const FOLD_WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const available = existsSync(FOLD_WASM);
const MB = 1024 * 1024;

/**
 * What a grid's interior lines are: valley precreases (nothing overlaps); a
 * map fold, every face stacked on one cell; or the columns pleated and the
 * rows precreased, each row a stack as deep as the columns.
 */
type Family = 'precrease' | 'map' | 'pleats';

/** A `cols × rows` grid on the unit square as a FOLD file, every line split at the grid's vertices. */
function grid(cols: number, rows: number, family: Family = 'precrease'): string {
  const vertices: [number, number][] = [];
  const id = (i: number, j: number) => j * (cols + 1) + i;
  for (let j = 0; j <= rows; j += 1) for (let i = 0; i <= cols; i += 1) vertices.push([i / cols, j / rows]);
  const edges: [number, number][] = [];
  const assignment: string[] = [];
  const hint: number[] = [];
  const add = (a: number, b: number, kind: string, h = 0) => {
    edges.push([a, b]);
    assignment.push(kind);
    hint.push(h);
  };
  const letter = (k: number) => (k % 2 === 0 ? 'M' : 'V');
  for (let j = 0; j <= rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      if (j === 0 || j === rows) add(id(i, j), id(i + 1, j), 'B');
      // A map fold's horizontal creases change letter column by column.
      else if (family === 'map') add(id(i, j), id(i + 1, j), letter(i + j));
      else add(id(i, j), id(i + 1, j), 'U', 2);
    }
  }
  for (let i = 0; i <= cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      if (i === 0 || i === cols) add(id(i, j), id(i, j + 1), 'B');
      else if (family === 'precrease') add(id(i, j), id(i, j + 1), 'U', 2);
      else add(id(i, j), id(i, j + 1), letter(i));
    }
  }
  return JSON.stringify({
    file_spec: 1.1,
    vertices_coords: vertices,
    edges_vertices: edges,
    edges_assignment: assignment,
    'oristudio:edges_fold_direction_hint': hint,
  });
}

interface Engine {
  calls: FoldEngineCalls;
  io: FoldEngineIoCalls;
  version: number;
  /** The instance's wasm heap, in MB: it only ever grows. */
  heap: () => number;
  free: () => void;
}

const module = available ? new WebAssembly.Module(readFileSync(FOLD_WASM)) : null;

/** A fresh wasm instance, its heap its own. */
async function freshEngine(): Promise<Engine> {
  vi.resetModules();
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  const out = wasm.initSync({ module: module! });
  const fold = new wasm.FoldEngine();
  return {
    calls: createFoldEngineCalls(fold),
    io: createFoldEngineIoCalls(fold),
    version: wasm.fold_engine_version(),
    heap: () => out.memory.buffer.byteLength / MB,
    free: () => fold.free(),
  };
}

function sourceOf(calls: FoldEngineCalls): FoldEngineSource {
  return {
    generation: () => 0,
    sheet: async (paper) => calls.sheet(paper),
    step: async (state, op, choices) => calls.step(state, op, choices),
    release: async (states) => calls.release(states),
  };
}

/** 65 columns by 64 rows: 4,160 faces, 64 over the cap. */
const OVER = { cols: 65, rows: 64, faces: 65 * 64 };

describe.skipIf(!available)('the face cap over the built bridge', () => {
  it('mirrors the engine’s cap, which the grid just over it is over', () => {
    expect(FOLD_MAX_FACES).toBe(4096);
    expect(OVER.faces).toBeGreaterThan(FOLD_MAX_FACES);
  });

  it('refuses an import over the cap by its count, before its tables, and keeps answering', async () => {
    const engine = await freshEngine();
    const { calls, io } = engine;
    const sheet = calls.sheet({ shape: { kind: 'square' }, startSide: 'front' });
    if (sheet.status !== 'ok') throw new Error('no sheet');
    // Into an empty sequence, and after a state, as a replay imports it.
    for (const target of [{ kind: 'empty' } as const, { kind: 'after', state: sheet.state } as const]) {
      const opened = io.importCp({ format: 'fold', text: grid(OVER.cols, OVER.rows) }, target);
      if (opened.status !== 'refused') throw new Error('imported');
      expect(opened.refusal).toEqual({ code: 'import_too_many_faces', face_count: OVER.faces, limit: FOLD_MAX_FACES });
    }
    // 4,160 faces would have taken about 7 × 4,160² bytes, 120 MB; the
    // refusal leaves the heap where the loader and the faces put it.
    expect(engine.heap()).toBeLessThan(32);
    expect(io.liveImports()).toBe(0);
    // The same engine still imports.
    const sample = FOLD_SAMPLES[0]!;
    const fine = io.importCp(foldSampleSource(sample), { kind: 'empty' });
    expect(fine.status).toBe('ok');
    engine.free();
  });

  it('opens a saved sequence whose import step is over the cap: that step broken by its count, the rest folding', async () => {
    const engine = await freshEngine();
    const over: FoldCpJumpOp = {
      kind: 'cp-jump',
      cpJson: grid(OVER.cols, OVER.rows),
      orderJson: JSON.stringify({ faces: [], orders: [] }),
      origin: 'fold',
    };
    const sequence = sequenceOf([
      step('fstep-1', null, over),
      step('fstep-2', 'fstep-1', valleyAt(0.5)),
      // A branch beside it, from the flat sheet.
      step('fstep-3', null, valleyAt(0.5)),
    ]);
    const replayer = createFoldReplayer(createFoldEnginePort(sourceOf(engine.calls), engine.version));
    const done = await replayer.run({ loadId: 1, sequence });
    expect(done?.done).toBe(true);
    expect(done?.sheet.status).toBe('ok');
    expect(done?.steps.get('fstep-1')).toMatchObject({
      status: 'broken',
      refusal: {
        at: 'fstep-1',
        code: 'import_too_many_faces',
        cap: { kind: 'faces', faceCount: OVER.faces, limit: FOLD_MAX_FACES },
      },
    });
    // Below it, broken from above; beside it, folded.
    expect(done?.steps.get('fstep-2')).toMatchObject({ status: 'broken', refusal: { at: 'fstep-1' } });
    expect(done?.steps.get('fstep-3')?.status).toBe('ok');
    expect(engine.heap()).toBeLessThan(32);
    engine.free();
  });
});

/** `oristudio_layer_order::MAX_STACKED_TRIPLES`, as the engine declares it. */
const STACK_CAP = Number(
  /pub const MAX_STACKED_TRIPLES: u64 = ([\d_]+);/
    .exec(readFileSync(resolve(ROOT, '../../crates/oristudio-layer-order/src/problem.rs'), 'utf8'))?.[1]
    ?.replaceAll('_', '')
);
const choose3 = (d: number) => (d * (d - 1) * (d - 2)) / 6;
/** The shallowest single stack over the cap: every three of its layers overlap one another. */
const OVER_DEPTH = (() => {
  let d = 3;
  while (choose3(d) <= STACK_CAP) d += 1;
  return d;
})();

/** `strips` vertical strips folded back and forth along lines of alternating letters: one stack, `strips` deep. */
function accordion(strips: number): string {
  return grid(strips, 1, 'map');
}

/**
 * The square folded in half `folds` times through every layer along
 * horizontal lines, the part above moving down each time: one stack, `2^folds`
 * deep. The bottom strip never moves, so a sheet point just above each line
 * is on the moving side.
 */
function halvings(folds: number): FoldPlainOp[] {
  return Array.from({ length: folds }, (_, k): FoldPlainOp => {
    const y = 2 ** -(k + 1);
    return { kind: 'valley', line: { via: 'free', through: [[0, y], [1, y]] }, moving: [0.5, 1.5 * y], seed: { scope: 'all' } };
  });
}

describe.skipIf(!available)('the stacking cap over the built bridge', () => {
  it('is the engine’s, and a single stack goes over it at 418 layers', () => {
    expect(STACK_CAP).toBe(12_000_000);
    expect(OVER_DEPTH).toBe(418);
  });

  it('refuses a pattern stacked past it by its counts, before its order is looked for', async () => {
    const engine = await freshEngine();
    const { calls, io } = engine;
    const sheet = calls.sheet({ shape: { kind: 'square' }, startSide: 'front' });
    if (sheet.status !== 'ok') throw new Error('no sheet');
    // Into an empty sequence, and after a state, as a replay imports it.
    for (const target of [{ kind: 'empty' } as const, { kind: 'after', state: sheet.state } as const]) {
      const opened = io.importCp({ format: 'fold', text: accordion(OVER_DEPTH) }, target);
      if (opened.status !== 'refused') throw new Error('imported');
      expect(opened.refusal).toEqual({
        code: 'import_stacked_too_deep',
        deepest: OVER_DEPTH,
        triples: choose3(OVER_DEPTH),
        limit: STACK_CAP,
      });
    }
    expect(io.liveImports()).toBe(0);
    engine.free();
  });

  it('opens a saved sequence stacked past it: its import and its fold broken by their counts, the rest folding', async () => {
    const engine = await freshEngine();
    const over: FoldCpJumpOp = {
      kind: 'cp-jump',
      cpJson: accordion(OVER_DEPTH),
      orderJson: JSON.stringify({ faces: [], orders: [] }),
      origin: 'fold',
    };
    // Nine halvings: the eighth lands 256 layers deep, under the cap; the
    // ninth would land 512.
    const folds = halvings(9).map((op, k) => step(`fstep-h${k + 1}`, k === 0 ? null : `fstep-h${k}`, op));
    const sequence = sequenceOf([
      step('fstep-1', null, over),
      step('fstep-2', 'fstep-1', valleyAt(0.5)),
      ...folds,
      // A branch beside them, from the flat sheet.
      step('fstep-3', null, valleyAt(0.5)),
    ]);
    const replayer = createFoldReplayer(createFoldEnginePort(sourceOf(engine.calls), engine.version));
    const done = await replayer.run({ loadId: 1, sequence });
    expect(done?.done).toBe(true);
    expect(done?.steps.get('fstep-1')).toMatchObject({
      status: 'broken',
      refusal: {
        at: 'fstep-1',
        code: 'import_stacked_too_deep',
        cap: { kind: 'stack', deepest: OVER_DEPTH, triples: choose3(OVER_DEPTH), limit: STACK_CAP },
      },
    });
    expect(done?.steps.get('fstep-2')).toMatchObject({ status: 'broken', refusal: { at: 'fstep-1' } });
    expect(done?.steps.get('fstep-h8')?.status).toBe('ok');
    expect(done?.steps.get('fstep-h9')).toMatchObject({
      status: 'broken',
      refusal: {
        at: 'fstep-h9',
        code: 'stacked_too_deep',
        cap: { kind: 'stack', deepest: 512, triples: choose3(512), limit: STACK_CAP },
      },
    });
    expect(done?.steps.get('fstep-3')?.status).toBe('ok');
    engine.free();
  });
});

describe.skipIf(!available || !process.env.FOLD_MEASURE)('Import CP cost by face count (measurement)', () => {
  const families = (process.env.FOLD_MEASURE_FAMILIES ?? 'precrease').split(',') as Family[];
  const sizes = (process.env.FOLD_MEASURE_SIZES ?? '20,40,60,80,100,120,140,160').split(',').map(Number);

  for (const family of families) {
    it(`${family} grids`, async () => {
      for (const n of sizes) {
        const { calls, io, heap, free } = await freshEngine();
        const text = grid(n, n, family);
        const row = [`${family} n=${n} faces=${n * n} bytes=${(text.length / MB).toFixed(1)}MB base=${heap().toFixed(0)}MB`];
        const seconds = (since: number) => `${((performance.now() - since) / 1000).toFixed(2)}s`;
        try {
          let t = performance.now();
          const opened = io.importCp({ format: 'fold', text }, { kind: 'empty' });
          row.push(`open ${seconds(t)} ${heap().toFixed(0)}MB ${opened.status === 'ok' ? 'ok' : opened.refusal.code}`);
          if (opened.status === 'ok') {
            t = performance.now();
            const picked = io.importPick(opened.import, opened.components.map(() => 0));
            row.push(`pick ${seconds(t)} ${heap().toFixed(0)}MB ${picked.status}`);
            io.releaseImports([opened.import]);
            if (picked.status === 'ok') {
              t = performance.now();
              calls.scene(picked.state);
              row.push(`scene ${seconds(t)} ${heap().toFixed(0)}MB`);
              const sheet = calls.sheet({ shape: { kind: 'square' }, startSide: 'front' });
              if (sheet.status === 'ok') {
                t = performance.now();
                const replayed = calls.step(sheet.state, picked.op);
                row.push(`replay ${seconds(t)} ${heap().toFixed(0)}MB ${replayed.status}`);
              }
            }
          }
        } catch (error) {
          row.push(`THREW ${error instanceof Error ? error.message : String(error)} at ${heap().toFixed(0)}MB`);
        }
        appendFileSync(process.env.FOLD_MEASURE!, `${row.join(' | ')}\n`);
        // A trapped instance cannot be freed; it is let go with its module.
        try {
          free();
        } catch {
          // ignore
        }
      }
    }, 3_600_000);
  }
});
