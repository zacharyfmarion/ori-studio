import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  OristudioCpDocumentSummary,
  OristudioCpFoldedFigureResult,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldSource,
  OristudioCpFoldWithOrderResult,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import { encodeLayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
import { kernelFoldSourceOf, layerOrderSourceOf } from '../../lib/layerOrder/layerOrderSource';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import type { LayerOrderBackend } from '../../workers/layerOrderWorkerApi';
import { createLayerOrderBridgeBackend } from '../../workers/layerOrderBridgeBackend';
import { inProcessLayerOrderWorkers } from '../engine/layerOrderEngine.fixtures';
import { LAYER_ORDER_LIMITS, constraintSeen, type LayerConstraint } from '../engine/layerOrderEngine';
import { createLayerOrderRuntime } from '../engine/layerOrderRuntime';
import { createLayerOrderResolveBatch } from './layerOrderHostEngine';
import { createLayerOrderSolutionCursor } from './layerOrderSolutionCursor';
import type { LayerOrderResolution } from './layerOrderResolution';

/**
 * The host engine over the built Fold bridge, in Node (`implementation-plans/layer-order-dialog.md`,
 * row H2): the worker's own backend behind the worker shell, through comlink,
 * under the host engine's batch. Only the `Worker` is a stand-in.
 *
 * On kabuto, folded by the CP bridge as Edit folds it, a record of two
 * constraints is saved through the dialog's engine: one on the corner flap,
 * one elsewhere. Then the host engine resolves it against
 *
 * - **the same creases:** applied, on the same relations, with the same record;
 * - **the flap split by an added crease** (E5's synthetic split: a crease
 *   across the flap, parallel to its fold, 0.4 of the way from the sheet's
 *   corner, as `steer_session.rs` cuts it): the flap's constraint ambiguous,
 *   the other intact and applied, the ambiguous one carried and flagged; the
 *   CP bridge folds the answer;
 * - **a forged digest:** refused;
 * - **a node budget its open runs out of:** timed out, and with a later
 *   budget as a retry, applied on the same worker.
 *
 * All on one batch's one worker. Then a host's solutions cursor (row H6)
 * steps a record of one constraint through every picture that fits it from
 * the front, in its fixed order, each step's order folding flat through the
 * CP bridge with a record of its own, and the last step's record restores
 * whole to the place it was saved at.
 *
 * Skipped when either bridge has not been built; CI builds them first.
 */
const ROOT = process.cwd();
const FOLD_WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const CP_WASM = resolve(ROOT, 'src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm');
const KABUTO = resolve(ROOT, '../../tests/fixtures/flat-folder/kabuto.fold');
const available = existsSync(FOLD_WASM) && existsSync(CP_WASM);

type FoldWasm = typeof import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
type CpWasm = typeof import('../../generated/oristudio-cp-wasm/oristudio_cp_wasm');

const monitoring = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../../monitoring', () => ({ reportError: monitoring.reportError }));

afterEach(() => {
  expect(monitoring.reportError).not.toHaveBeenCalled();
});

const tag = (value: unknown) => Object.prototype.toString.call(value);

function expectOutcome<K extends LayerOrderResolution['outcome']>(
  resolution: LayerOrderResolution,
  outcome: K
): asserts resolution is Extract<LayerOrderResolution, { outcome: K }> {
  if (resolution.outcome !== outcome) throw new Error(`expected ${outcome}: ${JSON.stringify(resolution)}`);
}

/** Twice a ring's signed area. */
function doubleArea(ring: readonly Point[]): number {
  let sum = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    sum += p.x * q.y - q.x * p.y;
  });
  return sum;
}

const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9;
const joins = (s: OristudioCpLineSegment, p: Point, q: Point) => (near(s.a, p) && near(s.b, q)) || (near(s.a, q) && near(s.b, p));

/**
 * Kabuto's corner flap, as `steer_session.rs`'s `corner_flap` finds it: the
 * first face that is a triangle of 1/32 of the sheet with a corner of the
 * sheet, and its three corners, the sheet's first.
 */
function cornerFlap(scene: OristudioCpFoldedPaperScene): { face: number; corner: Point; a: Point; b: Point } {
  const points = scene.sheet_points;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const side = Math.max(x1 - x0, y1 - y0);
  const isCorner = (p: Point) =>
    (Math.abs(p.x - x0) < 1e-9 || Math.abs(p.x - x1) < 1e-9) && (Math.abs(p.y - y0) < 1e-9 || Math.abs(p.y - y1) < 1e-9);
  for (const [face, { points: ring }] of scene.faces.entries()) {
    const at = ring.map((i) => points[i]!);
    if (at.length !== 3 || Math.abs(Math.abs(doubleArea(at)) / 2 / (side * side) - 1 / 32) > 1e-9) continue;
    const c = at.findIndex(isCorner);
    if (c < 0) continue;
    return { face, corner: at[c]!, a: at[(c + 1) % 3]!, b: at[(c + 2) % 3]! };
  }
  throw new Error('kabuto has its corner flap');
}

describe.skipIf(!available)('the host engine over the Fold bridge, on kabuto', () => {
  let fold: FoldWasm;
  let cp: CpWasm;

  beforeAll(async () => {
    fold = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
    fold.initSync({ module: readFileSync(FOLD_WASM) });
    cp = await import('../../generated/oristudio-cp-wasm/oristudio_cp_wasm');
    cp.initSync({ module: readFileSync(CP_WASM) });
  });

  /** Workers over the bridge, each with its own engine, and every call their backends answered. */
  function overTheBridge() {
    const calls: string[] = [];
    const workers = inProcessLayerOrderWorkers(() => {
      const backend = createLayerOrderBridgeBackend(new fold.FoldEngine());
      for (const name of Object.keys(backend) as (keyof LayerOrderBackend)[]) {
        const call = backend[name] as (...args: unknown[]) => unknown;
        (backend as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
          calls.push(name);
          return call(...args);
        };
      }
      return backend;
    });
    return { workers, calls };
  }

  /** Kabuto folded whole as Edit folds it, from starting face 1. */
  function kabuto() {
    const document = cp.load_fold(readFileSync(KABUTO, 'utf8'), '');
    const summary = cp.document_summary(document) as OristudioCpDocumentSummary;
    const lines = Array.from({ length: summary.line_segments }, (_, index) => index + 1);
    const figure = cp.folded_figure_fold_selected(document, lines, 1, 'Order5', null, 0) as OristudioCpFoldedFigureResult;
    const source = cp.folded_figure_source(figure.handle, document) as OristudioCpFoldSource;
    const scene = cp.folded_figure_paper_scene(figure.handle) as OristudioCpFoldedPaperScene | null;
    cp.free_folded_figure(figure.handle);
    cp.free_document(document);
    if (!scene) throw new Error('kabuto has subfaces');
    return { source, scene };
  }

  /**
   * Kabuto with a crease of `color` across its corner flap, `t` of the way
   * from the sheet's corner to the flap's fold, the paper's two edges split
   * where it meets them (`kabuto_cut`), as the CP kernel gives the fold
   * source of those creases: its own segments and digest.
   */
  function kabutoCut(t: number, color: 'Blue2' | 'Red1'): OristudioCpFoldSource {
    const { source, scene } = kabuto();
    const { corner, a, b } = cornerFlap(scene);
    const at = (p: Point): Point => ({ x: corner.x + t * (p.x - corner.x), y: corner.y + t * (p.y - corner.y) });
    const [pa, pb] = [at(a), at(b)];
    let split = 0;
    const segments = source.segments.flatMap((s) => {
      if (joins(s, a, corner)) {
        split += 1;
        return [{ ...s, a, b: pa }, { ...s, a: pa, b: corner }];
      }
      if (joins(s, b, corner)) {
        split += 1;
        return [{ ...s, a: b, b: pb }, { ...s, a: pb, b: corner }];
      }
      return [s];
    });
    expect(split).toBe(2);
    const flapFold = source.segments.find((s) => joins(s, a, b))!;
    segments.push({ ...flapFold, a: pa, b: pb, color });

    const document = cp.load_fold(readFileSync(KABUTO, 'utf8'), '');
    const before = (cp.document_summary(document) as OristudioCpDocumentSummary).line_segments;
    cp.replace_line_segments(document, Array.from({ length: before }, (_, i) => i + 1), segments);
    const after = (cp.document_summary(document) as OristudioCpDocumentSummary).line_segments;
    expect(after).toBe(segments.length);
    const cut = cp.fold_source_of_selection(document, Array.from({ length: after }, (_, i) => i + 1), 1) as OristudioCpFoldSource;
    cp.free_document(document);
    return cut;
  }

  /** {@link kabutoCut} with whichever letter Oriedita folds flat, as `split_kabuto` picks it. */
  function splitKabuto(t: number): OristudioCpFoldSource {
    for (const color of ['Blue2', 'Red1'] as const) {
      const cut = kabutoCut(t, color);
      const folded = cp.folded_figure_fold_with_order(cut, new Uint32Array(), null, 0) as OristudioCpFoldWithOrderResult;
      if (folded.status !== 'folded') continue;
      cp.free_folded_figure(folded.handle);
      if (folded.snapshot.outcome === 'Solved') return cut;
    }
    throw new Error('no letter folds kabuto’s split flap flat');
  }

  /** The CP bridge folds `relations` on `source`, as a host's Apply does. */
  function foldsFlat(source: LayerOrderSource, relations: Uint32Array): boolean {
    const folded = cp.folded_figure_fold_with_order(kernelFoldSourceOf(source), relations, null, 0) as OristudioCpFoldWithOrderResult;
    if (folded.status !== 'folded') return false;
    cp.free_folded_figure(folded.handle);
    return folded.snapshot.outcome === 'Solved';
  }

  /** A record of two constraints saved through the dialog's engine: one elsewhere, one on the flap. */
  async function savedOnKabuto(source: LayerOrderSource, flap: number) {
    const { workers } = overTheBridge();
    const dialog = createLayerOrderRuntime({ role: 'dialog', spawn: workers.spawn });
    const opened = await dialog.engine.open(source, LAYER_ORDER_LIMITS.open);
    if (opened.status !== 'ok') throw new Error(`refused: ${JSON.stringify(opened.refusal)}`);
    const pairs: [number, number][] = [];
    for (let i = 0; i < opened.open_pairs.length; i += 2) pairs.push([opened.open_pairs[i]!, opened.open_pairs[i + 1]!]);
    const elsewhere = pairs.find(([lo, hi]) => lo !== flap && hi !== flap)!;
    const atFlap = pairs.find(([lo, hi]) => lo === flap || hi === flap)!;
    const seen = ([lo, hi]: [number, number]): LayerConstraint =>
      constraintSeen(lo, 'in_front_of', hi, 'front', opened.front_up[hi] === 1);
    const constraints = [seen(elsewhere), seen(atFlap)];
    const committed = await dialog.engine.commit(constraints, LAYER_ORDER_LIMITS.commit);
    if (committed.verdict !== 'committed') throw new Error(`not committed: ${JSON.stringify(committed)}`);
    const saved = await dialog.engine.save();
    if (saved.status !== 'ok') throw new Error(`refused: ${JSON.stringify(saved.refusal)}`);
    const relations = await dialog.engine.relations();
    dialog.dispose();
    return { record: saved.record, json: saved.json, relations, constraints };
  }

  it(
    'resolves a saved record against the same creases, a split flap and a forged digest',
    async () => {
      const { source: kernelSource, scene } = kabuto();
      const source = layerOrderSourceOf(kernelSource, DEFAULT_FOLDED_MODEL);
      const { face: flap } = cornerFlap(scene);
      const saved = await savedOnKabuto(source, flap);
      expect(saved.record.constraints).toHaveLength(2);

      const { workers, calls } = overTheBridge();
      const batch = createLayerOrderResolveBatch({ spawn: workers.spawn });

      // (a) The same creases: applied, on the same relations, and the record saved again is the same.
      const same = await batch.resolve(source, saved.record);
      expectOutcome(same, 'applied');
      expect(same.found.saved_constraints).toEqual([{ status: 'intact' }, { status: 'intact' }]);
      expect(same.found.carried).toEqual([]);
      expect(same.found.opened_on).toEqual({ kind: 'held', ignored: 0 });
      expect(same.attention).toBeNull();
      expect(tag(same.applied.relations)).toBe('[object Uint32Array]');
      expect(Array.from(same.applied.relations)).toEqual(Array.from(saved.relations));
      expect(same.applied.source).toEqual(source);
      const again = encodeLayerOrderRecord(same.record);
      expect(again.ok && again.json).toBe(saved.json);
      expect(foldsFlat(source, same.applied.relations)).toBe(true);

      // (b) The flap split by a crease across it: its constraint ambiguous, never guessed; the other applied.
      const split = layerOrderSourceOf(splitKabuto(0.4), DEFAULT_FOLDED_MODEL);
      expect(split.digest).not.toBe(source.digest);
      const after = await batch.resolve(split, saved.record);
      expectOutcome(after, 'applied');
      expect(after.found.saved_constraints).toEqual([{ status: 'intact' }, { status: 'ambiguous' }]);
      expect(after.found.carried.map((row) => [row.index, row.status, row.constraint])).toEqual([[1, 'ambiguous', null]]);
      expect(after.attention).toEqual({ reason: 'unresolved', count: 1 });
      // Nothing dropped: the record of the order now shown carries the ambiguous row back as saved.
      expect(after.record.constraints).toHaveLength(2);
      expect(after.record.attention).toEqual({ reason: 'unresolved', count: 1 });
      const carried = after.record.constraints[1]!;
      expect(after.record.faces[carried[0]]).toEqual(saved.record.faces[saved.record.constraints[1]![0]]);
      expect(after.record.faces[carried[1]]).toEqual(saved.record.faces[saved.record.constraints[1]![1]]);
      expect(foldsFlat(split, after.applied.relations)).toBe(true);

      // (c) A forged digest: refused, the record kept and flagged.
      const forged = await batch.resolve({ ...source, digest: '0000000000000000' }, saved.record);
      expectOutcome(forged, 'refused');
      expect(forged.refusal).toEqual({ code: 'source_digest_mismatch', expected: '0000000000000000', actual: source.digest });
      expect(forged.record).toEqual({ ...saved.record, attention: { reason: 'unresolved', count: 2 } });

      // (d) Out of time, then asked again with later limits on the same worker. One node runs kabuto's open
      // out (from two up, every restore here applies), so the retry is a restore from the open.
      const short = { maxNodes: 1, fastNodes: 0, deadlineMs: 30_000 };
      const out = await batch.resolve(split, saved.record, short);
      expectOutcome(out, 'timed_out');
      expect(out).toMatchObject({ limit: 'nodes', found: null, attention: { reason: 'timeout', count: 2 } });
      const retried = await batch.resolve(split, saved.record, short, { retries: [LAYER_ORDER_LIMITS.restore] });
      expectOutcome(retried, 'applied');
      expect(Array.from(retried.applied.relations)).toEqual(Array.from(after.applied.relations));

      // One worker for them all; closing the batch ends it.
      expect(workers.workers).toHaveLength(1);
      expect(calls).toEqual([
        ...['restore', 'relations', 'save'],
        ...['restore', 'relations', 'save'],
        'restore',
        'restore',
        ...['restore', 'restore', 'relations', 'save'],
      ]);
      batch.close();
      expect(workers.workers[0]!.terminated).toBe(true);
    },
    60_000
  );

  /** A record of one constraint, saved through the dialog's engine, that leaves at least three pictures from the front. */
  async function savedLeavingSeveral(source: LayerOrderSource) {
    const { workers } = overTheBridge();
    const dialog = createLayerOrderRuntime({ role: 'dialog', spawn: workers.spawn });
    try {
      const opened = await dialog.engine.open(source, LAYER_ORDER_LIMITS.open);
      if (opened.status !== 'ok') throw new Error(`refused: ${JSON.stringify(opened.refusal)}`);
      for (let i = 0; i < opened.open_pairs.length; i += 2) {
        const [lo, hi] = [opened.open_pairs[i]!, opened.open_pairs[i + 1]!];
        const constraint = constraintSeen(lo, 'in_front_of', hi, 'front', opened.front_up[hi] === 1);
        const committed = await dialog.engine.commit([constraint], LAYER_ORDER_LIMITS.commit);
        if (committed.verdict !== 'committed') continue;
        const counted = await dialog.engine.countSlice(LAYER_ORDER_LIMITS.restore);
        if (!counted.count.done || counted.count.front.n < 3) continue;
        const saved = await dialog.engine.save();
        if (saved.status !== 'ok') throw new Error(`refused: ${JSON.stringify(saved.refusal)}`);
        return { record: saved.record, pictures: counted.count.front.n };
      }
      throw new Error('no one constraint on kabuto leaves three pictures');
    } finally {
      dialog.dispose();
    }
  }

  it(
    'steps a saved record through the solutions that fit, in a fixed order, each one folding flat with its own record (H6)',
    async () => {
      const { source: kernelSource } = kabuto();
      const source = layerOrderSourceOf(kernelSource, DEFAULT_FOLDED_MODEL);
      const { record, pictures } = await savedLeavingSeveral(source);
      const { workers, calls } = overTheBridge();
      const cursor = createLayerOrderSolutionCursor(source, record, { spawn: workers.spawn });
      const front = { picture: 'front' } as const;

      // Back to the first, then on to the last: every picture once, numbered in turn, of a final total.
      for (let step = await cursor.step('previous', front); step.outcome !== 'end'; step = await cursor.step('previous', front)) {
        if (step.outcome !== 'moved') throw new Error(`stepping back: ${JSON.stringify(step)}`);
      }
      const indices: number[] = [];
      const records: string[] = [];
      for (let step = await cursor.step('next', front); step.outcome !== 'end'; step = await cursor.step('next', front)) {
        if (step.outcome !== 'moved') throw new Error(`stepping on: ${JSON.stringify(step)}`);
        expect(step.counted).toBe(true);
        expect(step.position.total).toEqual({ n: pictures, exact: true });
        indices.push(step.position.index);
        // The CP bridge draws it, as the host's fold of it does, and the record names the same constraint.
        expect(foldsFlat(source, step.applied.relations)).toBe(true);
        expect(step.applied.record.constraints).toEqual(record.constraints);
        const encoded = encodeLayerOrderRecord(step.applied.record);
        if (!encoded.ok) throw new Error('a step’s record encodes');
        records.push(encoded.json);
      }
      expect(indices).toEqual(Array.from({ length: pictures - 1 }, (_, i) => i + 2));
      expect(new Set(records).size).toBe(records.length);
      // One worker throughout, kept between presses; closing the cursor ends it.
      expect(workers.workers).toHaveLength(1);
      expect(calls.filter((call) => call === 'restore')).toHaveLength(1);
      cursor.close();
      expect(workers.workers[0]!.terminated).toBe(true);

      // The last step's record, restored afresh (a reload, the next cursor), holds the order it saved.
      const batch = createLayerOrderResolveBatch({ spawn: overTheBridge().workers.spawn });
      const last = JSON.parse(records.at(-1)!) as typeof record;
      const reopened = await batch.resolve(source, last);
      expectOutcome(reopened, 'applied');
      expect(reopened.found.opened_on).toEqual({ kind: 'held', ignored: 0 });
      const again = createLayerOrderSolutionCursor(source, reopened.record, { spawn: overTheBridge().workers.spawn });
      await expect(again.step('next', front)).resolves.toMatchObject({
        outcome: 'end',
        position: { index: pictures, total: { n: pictures, exact: true } },
      });
      again.close();
      batch.close();
    },
    120_000
  );
});
