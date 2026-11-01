import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  OristudioCpDocumentSummary,
  OristudioCpFoldedFigureResult,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldSource,
  OristudioCpFoldWithOrderResult,
} from '../../engine/oristudioCpTypes';
import { NEWER } from '../../lib/documentFile';
import { readLayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import { kernelFoldSourceOf, layerOrderSourceOf } from '../../lib/layerOrder/layerOrderSource';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import { createLayerOrderBridgeBackend } from '../../workers/layerOrderBridgeBackend';
import { inProcessLayerOrderWorkers } from './layerOrderEngine.fixtures';
import {
  LAYER_ORDER_LIMITS,
  type LayerConstraint,
  type LayerOrderLimits,
  type LayerSolutionCount,
  type LayerStacks,
  type LayerStepBy,
} from './layerOrderEngine';
import { createLayerOrderRuntime, type LayerOrderRuntime } from './layerOrderRuntime';
import { layerOrderSceneRelations } from './layerOrderSceneRelations';

/**
 * The Layer order engine over the built Fold bridge, in Node, as the dialog
 * asks it (`implementation-plans/layer-order-dialog.md`, row U6): the worker's
 * own backend (`workers/layerOrderBridgeBackend.ts`) behind the worker shell,
 * through comlink, under the dialog's runtime, which counts the solutions in
 * slices between the calls. Only the `Worker` is a stand-in
 * (`InProcessLayerOrderWorker`), so what crosses is cloned as a worker
 * clones it.
 *
 * On kabuto and `solution_sample_1`, folded by the CP bridge as Edit folds
 * them: the dialog opens on the order Edit shows, held whole, with Edit's
 * stacks on every spot; a preview, and Add by its token, adopted; the count
 * reaching E6's totals in slices, kept by a step and started again by Add;
 * a clash explained; a save, restored by the hosts' engine onto the same
 * order, which the CP bridge folds.
 *
 * Skipped when either bridge has not been built; CI builds them first.
 */
const ROOT = process.cwd();
const FOLD_WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const CP_WASM = resolve(ROOT, 'src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm');
const FIXTURES = resolve(ROOT, '../../tests/fixtures');
const available = existsSync(FOLD_WASM) && existsSync(CP_WASM);

type FoldWasm = typeof import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
type CpWasm = typeof import('../../generated/oristudio-cp-wasm/oristudio_cp_wasm');

/** One search node a slice: the smallest slice, so the count takes as many as it can. */
const ONE_NODE_SLICE: LayerOrderLimits = { maxNodes: 1, fastNodes: 0, deadlineMs: 50 };

/** E6's totals, brute-force checked natively (`crates/oristudio-fold/tests/steer_solutions.rs`). */
const CASES = [
  { name: 'kabuto', relative: 'flat-folder/kabuto.fold', front: 9, back: 1, orders: 9 },
  { name: 'solution_sample_1', relative: 'oriedita/solution_sample_1.cp', front: 1, back: 16, orders: 16 },
] as const;

const tag = (value: unknown) => Object.prototype.toString.call(value);

function spot(stacks: LayerStacks, i: number): number[] {
  return Array.from(stacks.faces.subarray(stacks.offsets[i], stacks.offsets[i + 1]));
}

function pairsOf(flat: Uint32Array): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) pairs.push([flat[i]!, flat[i + 1]!]);
  return pairs;
}

/** "`subject` in front of `object`", read from the front. */
function inFrontOf(subject: number, object: number, frontUp: Uint8Array): LayerConstraint {
  return [subject, object, frontUp[object] === 1 ? 1 : -1];
}

const counted = (runtime: LayerOrderRuntime) =>
  vi.waitFor(() => expect(runtime.count()?.done).toBe(true), { timeout: 30_000, interval: 2 });

describe.skipIf(!available)('the Layer order engine over the Fold bridge, through its worker shell and runtime', () => {
  let fold: FoldWasm;
  let cp: CpWasm;

  beforeAll(async () => {
    fold = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
    fold.initSync({ module: readFileSync(FOLD_WASM) });
    cp = await import('../../generated/oristudio-cp-wasm/oristudio_cp_wasm');
    cp.initSync({ module: readFileSync(CP_WASM) });
  });

  /** A fixture folded whole as Edit folds it: the figure's source, and the scene Edit shows of it. */
  function asEditShowsIt(relative: string) {
    const text = readFileSync(resolve(FIXTURES, relative), 'utf8');
    const document = relative.endsWith('.cp') ? cp.load_cp(text, '') : cp.load_fold(text, '');
    const summary = cp.document_summary(document) as OristudioCpDocumentSummary;
    const lines = Array.from({ length: summary.line_segments }, (_, index) => index + 1);
    const figure = cp.folded_figure_fold_selected(document, lines, 1, 'Order5', null, 0) as OristudioCpFoldedFigureResult;
    const source = cp.folded_figure_source(figure.handle, document) as OristudioCpFoldSource;
    const scene = cp.folded_figure_paper_scene(figure.handle) as OristudioCpFoldedPaperScene | null;
    cp.free_folded_figure(figure.handle);
    cp.free_document(document);
    if (!scene) throw new Error(`${relative} has subfaces`);
    return { source: layerOrderSourceOf(source, DEFAULT_FOLDED_MODEL), scene };
  }

  /** A runtime whose workers each hold their own engine over the bridge, and how many slices they counted. */
  function overTheBridge(role: 'dialog' | 'host', count?: LayerOrderLimits) {
    let slices = 0;
    const workers = inProcessLayerOrderWorkers(() => {
      const backend = createLayerOrderBridgeBackend(new fold.FoldEngine());
      const countSlice = backend.countSlice;
      backend.countSlice = (limits) => {
        slices += 1;
        return countSlice(limits);
      };
      return backend;
    });
    const runtime = createLayerOrderRuntime({ role, spawn: workers.spawn, count });
    // The dialog counts when its owner says so (`setCounting`); this one, from the start.
    if (count) runtime.setCounting(true);
    return { runtime, slices: () => slices };
  }

  it.each(CASES)(
    '$name: opens on Edit’s order, counts in slices, steps, adds by its preview, explains a clash, saves and restores',
    async ({ relative, front, back, orders }) => {
      const { source, scene } = asEditShowsIt(relative);
      const dialog = overTheBridge('dialog', ONE_NODE_SLICE);
      const { engine } = dialog.runtime;
      const heard: (LayerSolutionCount | null)[] = [];
      dialog.runtime.onCount((count) => heard.push(count));

      // Open on the order Edit shows: held whole, Edit's stacks on every spot.
      const opened = await engine.openShowing(source, layerOrderSceneRelations(scene), LAYER_ORDER_LIMITS.open);
      if (opened.status !== 'ok') throw new Error(`refused: ${JSON.stringify(opened.refusal)}`);
      expect(opened.opened_on).toEqual({ kind: 'held', ignored: 0 });
      expect(opened).not.toHaveProperty('session');
      expect(tag(opened.open_pairs)).toBe('[object Uint32Array]');
      expect(opened.spots).toBe(scene.subfaces.length);
      const frontStacks = await engine.stacks('front');
      scene.subfaces.forEach((subface, i) => expect(spot(frontStacks, i)).toEqual(subface.faces_top_to_bottom));
      // The dialog's own scenes draw the stacks it answers, from each side.
      for (const side of ['front', 'back'] as const) {
        const drawn = await engine.scene(side);
        const stacks = await engine.stacks(side);
        expect(drawn?.flipped).toBe(side === 'back');
        drawn!.subfaces.forEach((subface, i) => expect(spot(stacks, i)).toEqual(subface.faces_top_to_bottom));
      }

      // The count, a node a slice, between the calls above and after them: E6's totals.
      await counted(dialog.runtime);
      const everything: LayerSolutionCount = {
        front: { n: front, exact: true },
        back: { n: back, exact: true },
        orders: { n: orders, exact: true },
        done: true,
      };
      expect(dialog.runtime.count()).toEqual(everything);
      expect(dialog.slices()).toBeGreaterThan(5);
      expect(heard.every((count) => count !== null)).toBe(true);

      // A step through the pictures from the side with more of them: the count stays.
      const by: LayerStepBy = { picture: front >= back ? 'front' : 'back' };
      const total = Math.max(front, back);
      const at = await engine.position(by);
      expect(at.total).toEqual({ n: total, exact: true });
      expect(at.index).toBeGreaterThanOrEqual(1);
      expect(at.index).toBeLessThanOrEqual(total);
      const direction = at.index < total ? 'next' : 'previous';
      const stepped = await engine.step(by, direction, LAYER_ORDER_LIMITS.step);
      if (stepped.verdict !== 'moved') throw new Error(`no step: ${JSON.stringify(stepped)}`);
      expect(stepped.position).toEqual({ index: at.index + (direction === 'next' ? 1 : -1), total: at.total });
      expect(tag(stepped.changed[by.picture])).toBe('[object Uint32Array]');
      expect(stepped.changed[by.picture].length).toBeGreaterThan(0);
      const heardBeforeAdd = heard.length;
      expect(dialog.runtime.count()).toEqual(everything);

      // Preview an open pair the other way from the order on screen, then Add it by its token.
      const shown = await engine.relations();
      const [a, b] = pairsOf(opened.open_pairs)[0]!;
      const [upper, lower] = pairsOf(shown).find(([u, l]) => (u === a && l === b) || (u === b && l === a))!;
      const candidate = inFrontOf(lower, upper, opened.front_up);
      const preview = await engine.preview(candidate, LAYER_ORDER_LIMITS.preview);
      if (preview.verdict !== 'fits') throw new Error(`no fit: ${JSON.stringify(preview)}`);
      expect(preview.token).toBeGreaterThan(0);
      expect(await engine.constraints()).toEqual([]);
      const added = await engine.commitPreview(preview.token, [candidate], { maxNodes: 0, fastNodes: 0, deadlineMs: 0 });
      if (added.verdict !== 'committed') throw new Error(`not added: ${JSON.stringify(added)}`);
      expect(added.adopted).toBe(true);
      expect(added.stacks).toEqual(preview.stacks);
      expect(await engine.constraints()).toEqual([candidate]);

      // Add changed what the count counts: it starts again, and the order on screen before is gone from it.
      expect(dialog.runtime.count()).toBeNull();
      await counted(dialog.runtime);
      const fewer = dialog.runtime.count()!;
      expect(fewer.orders.exact).toBe(true);
      expect(fewer.orders.n).toBeGreaterThanOrEqual(1);
      expect(fewer.orders.n).toBeLessThan(orders);
      expect(heard.slice(heardBeforeAdd)[0]).toBeNull();

      // The pair the other way again clashes with the constraint: both are needed.
      const explained = await engine.explain([candidate[0], candidate[1], candidate[2] === 1 ? -1 : 1], LAYER_ORDER_LIMITS.explain);
      if (explained.verdict !== 'clash') throw new Error(`no clash: ${JSON.stringify(explained)}`);
      expect(Array.from(explained.constraints)).toEqual([0, 1]);
      expect(explained.minimal).toBe(true);
      expect(explained.proof).toEqual({ kind: 'opposed' });
      expect(Array.from(explained.faces)).toEqual([Math.min(a, b), Math.max(a, b)]);
      expect(tag(explained.traced)).toBe('[object Uint32Array]');
      await expect(engine.explain(candidate, LAYER_ORDER_LIMITS.explain)).resolves.toEqual({ verdict: 'fits' });

      // Save: the record the codec reads back byte for byte.
      const saved = await engine.save();
      if (saved.status !== 'ok') throw new Error(`refused: ${JSON.stringify(saved.refusal)}`);
      const read = readLayerOrderRecord(saved.json);
      if (read === NEWER || !read.ok) throw new Error('the record reads');
      expect(read.json).toBe(saved.json);
      expect(read.record).toEqual(saved.record);
      expect(saved.record.constraints).toHaveLength(1);

      // The hosts' engine restores it onto the same creases, on the same order.
      const host = overTheBridge('host');
      const restored = await host.runtime.engine.restore(source, saved.record, LAYER_ORDER_LIMITS.restore);
      if (restored.status !== 'ok') throw new Error(`refused: ${JSON.stringify(restored.refusal)}`);
      expect(restored.outcome).toEqual({ kind: 'applied' });
      expect(restored.constraints).toEqual([candidate]);
      expect(restored.carried).toEqual([]);
      const relations = await engine.relations();
      expect(await host.runtime.engine.relations()).toEqual(relations);
      expect(host.slices()).toBe(0);

      // Apply: the CP bridge folds the order on screen.
      const applied = cp.folded_figure_fold_with_order(
        kernelFoldSourceOf(source),
        relations,
        null,
        0
      ) as OristudioCpFoldWithOrderResult;
      if (applied.status !== 'folded') throw new Error(`refused: ${JSON.stringify(applied.refusal)}`);
      expect(applied.snapshot.outcome).toBe('Solved');
      cp.free_folded_figure(applied.handle);

      dialog.runtime.dispose();
      host.runtime.dispose();
      expect(dialog.runtime.count()).toBeNull();
    },
    60_000
  );
});
