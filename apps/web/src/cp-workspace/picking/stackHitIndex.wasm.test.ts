/**
 * The stack hit index over Oriedita's own subfaces: the cells the Layer order
 * dialog's folded pane will hit-test, folded by the CP kernel in this process
 * (`folded_figure_fold`, `folded_figure_paper_scene`, as the worker calls
 * them) — the Oriedita solution sample, the kabuto, `glitch.cp` and two
 * sheets with a window cut in them, front and back. Their cells are convex
 * but for the folded frame's, which bends round its window: the even-odd test
 * on a real cell, held to a brute force with the rest.
 *
 * Query times are reported, not asserted.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { OristudioCpFoldedFigureResult, OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { initCpWasm } from '../../engine/oristudioCpTestSupport';
import {
  folded_figure_fold,
  folded_figure_paper_scene,
  folded_figure_set_model,
  free_document,
  free_folded_figure,
  load_cp,
  load_fold_file,
  load_ori,
} from '../../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import { StackHitIndex } from './stackHitIndex';
import { bruteForceCell, onAnOutline, queryTimes, samplePoints } from './stackHitIndex.fixtures';

const CP_WASM = resolve(process.cwd(), 'src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm');
const FIXTURES = resolve(process.cwd(), '../../tests/fixtures');
const ORIEDITA_TEST_RESOURCES = resolve(process.cwd(), '../../third_party/oriedita/oriedita-data/src/test/resources');

interface KernelScene {
  name: string;
  scene: OristudioCpFoldedPaperScene;
}

/** A document's paper scenes, front and back, as the kernel draws them. */
function foldThroughKernel(name: string, load: () => number): KernelScene[] {
  const document = load();
  const result = folded_figure_fold(document, 1, 'Order5', undefined, 0) as OristudioCpFoldedFigureResult;
  const front = folded_figure_paper_scene(result.handle) as OristudioCpFoldedPaperScene | null;
  folded_figure_set_model(result.handle, { ...result.snapshot.model, state: 'Back1' });
  const back = folded_figure_paper_scene(result.handle) as OristudioCpFoldedPaperScene | null;
  free_folded_figure(result.handle);
  free_document(document);
  if (!front || !back) throw new Error(`${name}: the kernel drew nothing`);
  return [
    { name: `${name} front`, scene: front },
    { name: `${name} back`, scene: back },
  ];
}

let scenes: KernelScene[] = [];

describe.skipIf(!existsSync(CP_WASM))('the stack hit index over Oriedita’s subfaces', () => {
  beforeAll(async () => {
    await initCpWasm();
    scenes = [
      ...foldThroughKernel('solution sample', () =>
        load_cp(readFileSync(resolve(FIXTURES, 'oriedita/solution_sample_1.cp'), 'utf8'), 'sample')
      ),
      ...foldThroughKernel('kabuto', () => load_fold_file(readFileSync(resolve(FIXTURES, 'flat-folder/kabuto.fold'), 'utf8'))),
      ...foldThroughKernel('glitch', () =>
        load_cp(readFileSync(resolve(ORIEDITA_TEST_RESOURCES, 'glitch.cp'), 'utf8'), 'glitch')
      ),
      ...['holed_sheet_spiral', 'holed_frame_collinear'].flatMap((name) =>
        foldThroughKernel(name, () => load_ori(readFileSync(resolve(FIXTURES, `oriedita/${name}.ori`), 'utf8'), false))
      ),
    ];
  }, 600_000);

  it('folds the fixtures, some of their cells non-convex', () => {
    expect(scenes.length).toBeGreaterThanOrEqual(6);
    const nonConvex = scenes.map(({ scene }) => new StackHitIndex(scene.subfaces).cells.filter((cell) => !cell.convex).length);
    expect(nonConvex.some((count) => count > 0)).toBe(true);
  });

  it('finds the cell a brute force finds, first in order, grid and linear', () => {
    const rows: string[] = [];
    for (const { name, scene } of scenes) {
      const cells = scene.subfaces;
      // A thousandth of a millionth of the sheet: where an outline is, rounding decides.
      const tolerance = scene.sheet * 1e-9;
      const points = samplePoints(cells, 10000, 21);
      for (const grid of [true, false]) {
        const index = new StackHitIndex(cells, { grid });
        let onOutline = 0;
        for (const p of points) {
          const expected = bruteForceCell(cells, p);
          const actual = index.stackAt(p)?.cell ?? -1;
          if (actual === expected) continue;
          expect(onAnOutline(cells, [expected, actual], p, tolerance), `${name}: at ${p.x}, ${p.y}`).toBe(true);
          onOutline += 1;
        }
        const { p50, p99, max } = queryTimes(index, points);
        rows.push(
          `${name}: ${cells.length} cells, ${index.cells.filter((cell) => !cell.convex).length} non-convex, ${grid ? 'grid' : 'linear'}: ` +
            `p50 ${p50.toFixed(1)} µs, p99 ${p99.toFixed(1)} µs, max ${max.toFixed(1)} µs; ${onOutline} of 10,000 on an outline`
        );
        expect(onOutline).toBeLessThanOrEqual(2);
      }
    }
    console.info(`stackAt over Oriedita's subfaces, 10,000 random points each:\n${rows.join('\n')}`);
  });
});

/**
 * Real designs, locally: `STACK_HIT_INDEX_CORPUS_DIR=<dir>` folds every
 * `<dir>/<case>/truth.fold` (the cpoogle layout) through the kernel, front
 * only, and holds each to the brute force, reporting the cells and the query
 * times. `STACK_HIT_INDEX_CORPUS_LIMIT` caps the designs. Never in CI: the
 * corpus is not committed.
 */
const CORPUS = process.env.STACK_HIT_INDEX_CORPUS_DIR;

describe.skipIf(!CORPUS || !existsSync(CP_WASM))('the stack hit index over a corpus of real designs', () => {
  it('finds the cell a brute force finds on every design that folds flat', async () => {
    await initCpWasm();
    const dir = CORPUS!;
    const limit = Number(process.env.STACK_HIT_INDEX_CORPUS_LIMIT ?? Infinity);
    const cases = readdirSync(dir)
      .filter((name) => existsSync(resolve(dir, name, 'truth.fold')))
      .sort()
      .slice(0, limit);
    const rows: { cells: number; nonConvex: number; p99: number; onOutline: number }[] = [];
    let refused = 0;
    for (const name of cases) {
      let scene: OristudioCpFoldedPaperScene | null;
      const document = load_fold_file(readFileSync(resolve(dir, name, 'truth.fold'), 'utf8'));
      try {
        const result = folded_figure_fold(document, 1, 'Order5', undefined, 0) as OristudioCpFoldedFigureResult;
        scene = folded_figure_paper_scene(result.handle) as OristudioCpFoldedPaperScene | null;
        free_folded_figure(result.handle);
      } catch {
        scene = null;
      } finally {
        free_document(document);
      }
      if (!scene || scene.subfaces.length === 0) {
        refused += 1;
        continue;
      }
      const cells = scene.subfaces;
      const index = new StackHitIndex(cells);
      const tolerance = scene.sheet * 1e-9;
      let onOutline = 0;
      for (const p of samplePoints(cells, 2000, 31)) {
        const expected = bruteForceCell(cells, p);
        const actual = index.stackAt(p)?.cell ?? -1;
        if (actual === expected) continue;
        expect(onAnOutline(cells, [expected, actual], p, tolerance), `${name}: at ${p.x}, ${p.y}`).toBe(true);
        onOutline += 1;
      }
      const { p99 } = queryTimes(index, samplePoints(cells, 10000, 32));
      rows.push({ cells: cells.length, nonConvex: index.cells.filter((cell) => !cell.convex).length, p99, onOutline });
    }
    const quantile = (values: number[], q: number) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    };
    const cells = rows.map((row) => row.cells);
    const p99s = rows.map((row) => row.p99);
    console.info(
      [
        `${cases.length} designs: ${rows.length} folded flat, ${refused} refused or empty`,
        `cells per design: p50 ${quantile(cells, 0.5)}, p95 ${quantile(cells, 0.95)}, max ${quantile(cells, 1)}`,
        `designs with a non-convex cell: ${rows.filter((row) => row.nonConvex > 0).length}; non-convex cells in all: ${rows.reduce((sum, row) => sum + row.nonConvex, 0)}`,
        `per-design p99 of stackAt (µs): p50 ${quantile(p99s, 0.5).toFixed(1)}, p95 ${quantile(p99s, 0.95).toFixed(1)}, max ${quantile(p99s, 1).toFixed(1)}`,
        `points on an outline where the answers differ: ${rows.reduce((sum, row) => sum + row.onOutline, 0)} of ${rows.length * 2000}`,
      ].join('\n')
    );
    expect(rows.length).toBeGreaterThan(0);
  }, 3_600_000);
});
