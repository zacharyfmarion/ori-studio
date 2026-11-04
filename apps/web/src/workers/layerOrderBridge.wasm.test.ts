import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  OristudioCpDocumentSummary,
  OristudioCpFoldedFigureResult,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldSource,
  OristudioCpFoldWithOrderResult,
} from '../engine/oristudioCpTypes';
import { layerOrderSceneRelations } from '../layer-order/engine/layerOrderSceneRelations';
import type {
  LayerCommitted,
  LayerOpened,
  LayerOrderBridge,
  LayerPreviewed,
  LayerRestored,
} from '../layer-order/engine/layerOrderWire';
import { SAVED_FACE_INTACT, SAVED_PAIR_KEPT } from '../layer-order/engine/layerOrderWire';
import { encodeLayerOrderRecord, readLayerOrderRecord } from '../lib/layerOrder/layerOrderRecord';

/**
 * The Fold bridge's Layer order calls (`layer_*`,
 * `implementation-plans/layer-order-dialog.md` row E7) through the built
 * bridge, in Node, as the dialog's worker will make them: kabuto's source
 * from the CP bridge, handed over unchanged; open, preview, commit, save,
 * then a restore on a second engine (the host engine's path); typed arrays
 * out, the relations folded again by the CP bridge, the record read by the
 * TypeScript codec, refusals as values and mistakes thrown by code.
 * `crates/oristudio-fold-wasm/tests/layer_session.rs` holds the same calls
 * natively.
 *
 * Skipped when either bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds them before the web tests run.
 */
const ROOT = process.cwd();
const FOLD_WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const CP_WASM = resolve(ROOT, 'src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm');
const KABUTO = resolve(ROOT, '../../tests/fixtures/flat-folder/kabuto.fold');
const available = existsSync(FOLD_WASM) && existsSync(CP_WASM);

type FoldWasm = typeof import('../generated/oristudio-fold-wasm/oristudio_fold_wasm');
type CpWasm = typeof import('../generated/oristudio-cp-wasm/oristudio_cp_wasm');

/** `[a, b, a, b, …]` as pairs. */
function pairsOf(flat: Uint32Array): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) pairs.push([flat[i], flat[i + 1]]);
  return pairs;
}

/** "subject in front of object", read from the front, as the wire's sign rule makes it. */
function inFrontOf(subject: number, object: number, frontUp: Uint8Array): Int32Array {
  const nearerTheFront = true;
  return Int32Array.of(subject, object, nearerTheFront === (frontUp[object] === 1) ? 1 : -1);
}

/** The constraint the order on screen breaks on a pair: the lower face in front of the upper. */
function againstShown(relations: Uint32Array, [a, b]: [number, number], frontUp: Uint8Array): Int32Array {
  const shown = pairsOf(relations).find(([upper, lower]) => (upper === a && lower === b) || (upper === b && lower === a));
  if (!shown) throw new Error(`the order on screen does not relate ${a} and ${b}`);
  const [upper, lower] = shown;
  return inFrontOf(lower, upper, frontUp);
}

function spot(stacks: { offsets: Uint32Array; faces: Uint32Array }, i: number): number[] {
  return Array.from(stacks.faces.subarray(stacks.offsets[i], stacks.offsets[i + 1]));
}

function thrownCode(call: () => unknown): string | undefined {
  try {
    call();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe.skipIf(!available)('the Fold bridge’s layer calls, in Node', () => {
  let fold: FoldWasm;
  let cp: CpWasm;

  beforeAll(async () => {
    fold = await import('../generated/oristudio-fold-wasm/oristudio_fold_wasm');
    fold.initSync({ module: readFileSync(FOLD_WASM) });
    cp = await import('../generated/oristudio-cp-wasm/oristudio_cp_wasm');
    cp.initSync({ module: readFileSync(CP_WASM) });
  });

  /** Kabuto folded whole, as Edit's selection hands it over. */
  function kabuto(): OristudioCpFoldSource {
    const document = cp.load_fold(readFileSync(KABUTO, 'utf8'), '');
    const summary = cp.document_summary(document) as OristudioCpDocumentSummary;
    const lines = Array.from({ length: summary.line_segments }, (_, index) => index + 1);
    const source = cp.fold_source_of_selection(document, lines, 1) as OristudioCpFoldSource;
    cp.free_document(document);
    return source;
  }

  it('opens kabuto, previews, commits, saves and restores', () => {
    const source = kabuto();
    const engine = new fold.FoldEngine();
    const bridge: LayerOrderBridge = engine;

    // Open: the faces, which show their fronts, and the open pairs.
    const opened = bridge.layer_open(source, { deadlineMs: 10_000 });
    if (opened.status !== 'ok') throw new Error(`refused: ${JSON.stringify(opened.refusal)}`);
    const { session, front_up: frontUp } = opened satisfies LayerOpened;
    expect(opened.faces).toBe(18);
    expect(frontUp).toBeInstanceOf(Uint8Array);
    expect(frontUp).toHaveLength(18);
    expect(opened.open_pairs).toBeInstanceOf(Uint32Array);
    expect(opened.open_pairs).toHaveLength(2 * 36);
    expect(bridge.layer_open_pairs(session)).toEqual(opened.open_pairs);
    expect(bridge.layer_constraints(session)).toEqual(new Int32Array(0));
    expect(bridge.layer_live()).toBe(1);

    // The stacks number the kernel's paper scene's subfaces, from each side.
    for (const side of ['front', 'back'] as const) {
      const stacks = bridge.layer_stacks(session, side);
      expect(stacks.offsets).toBeInstanceOf(Uint32Array);
      expect(stacks.offsets).toHaveLength(opened.spots + 1);
      const scene = bridge.layer_scene(session, side, undefined);
      if (!scene) throw new Error('kabuto has subfaces');
      expect(scene.flipped).toBe(side === 'back');
      expect(scene.subfaces).toHaveLength(opened.spots);
      scene.subfaces.forEach((subface, i) => expect(spot(stacks, i)).toEqual(subface.faces_top_to_bottom));
    }

    // Preview an open pair's other order: it fits, and nothing is committed.
    const relations = bridge.layer_oriedita_relations(session);
    expect(relations).toBeInstanceOf(Uint32Array);
    const [pair] = pairsOf(opened.open_pairs);
    const candidate = againstShown(relations, pair, frontUp);
    const preview: LayerPreviewed = bridge.layer_preview(session, candidate, { deadlineMs: 3_000 });
    if (preview.verdict !== 'fits') throw new Error(`no fit: ${JSON.stringify(preview)}`);
    expect(preview.changed.front).toBeInstanceOf(Uint32Array);
    expect(preview.changed.front.length + preview.changed.back.length).toBeGreaterThan(0);
    expect(preview.stacks.back.offsets).toHaveLength(opened.spots + 1);
    expect(bridge.layer_constraints(session)).toHaveLength(0);
    expect(bridge.layer_oriedita_relations(session)).toEqual(relations);

    // Add: the commit lands on the previewed order.
    const committed: LayerCommitted = bridge.layer_commit(session, candidate, { deadlineMs: 3_000 });
    if (committed.verdict !== 'committed') throw new Error(`not committed: ${JSON.stringify(committed)}`);
    expect(committed.changed).toEqual(preview.changed);
    expect(committed.stacks).toEqual(preview.stacks);
    expect(committed.open_pairs.length).toBeLessThan(opened.open_pairs.length);
    expect(bridge.layer_constraints(session)).toEqual(candidate);

    // Apply: the CP bridge folds the order on screen into a solved figure.
    const shown = bridge.layer_oriedita_relations(session);
    const applied = cp.folded_figure_fold_with_order(source, shown, null, 0) as OristudioCpFoldWithOrderResult;
    if (applied.status !== 'folded') throw new Error(`refused: ${JSON.stringify(applied.refusal)}`);
    expect(applied.snapshot.outcome).toBe('Solved');
    cp.free_folded_figure(applied.handle);

    // Save: the TypeScript codec reads the record and writes the same bytes.
    const saved = bridge.layer_save(session);
    if (saved.status !== 'ok') throw new Error(`refused: ${JSON.stringify(saved.refusal)}`);
    const read = readLayerOrderRecord(saved.json);
    if (typeof read === 'symbol' || !read.ok) throw new Error(`the record does not read: ${String(read)}`);
    expect(read.json).toBe(saved.json);
    expect(read.record.constraints).toHaveLength(1);
    expect(encodeLayerOrderRecord(read.record)).toEqual({ ok: true, json: saved.json });

    // Restore on another engine, as the host engine reopens a figure.
    const hostEngine = new fold.FoldEngine();
    const host: LayerOrderBridge = hostEngine;
    const restored = host.layer_restore(source, saved.json, { deadlineMs: 10_000 });
    if (restored.status !== 'ok') throw new Error(`refused: ${JSON.stringify(restored.refusal)}`);
    expect(restored.outcome).toEqual({ kind: 'applied' });
    expect((restored satisfies LayerRestored).constraints).toEqual(candidate);
    expect(Array.from(restored.saved_faces.status).every((s) => s === SAVED_FACE_INTACT)).toBe(true);
    expect(restored.saved_constraints).toEqual([{ status: 'intact' }]);
    expect(Array.from(restored.saved_order).every((s) => s === SAVED_PAIR_KEPT)).toBe(true);
    expect(host.layer_oriedita_relations(restored.session)).toEqual(shown);
    const resaved = host.layer_save(restored.session);
    expect(resaved).toEqual(saved);

    engine.free();
    hostEngine.free();
  });

  it('answers a no, a timeout and a refusal as values, and keeps trying with a later deadline', () => {
    const source = kabuto();
    const engine = new fold.FoldEngine();
    const bridge: LayerOrderBridge = engine;
    const opened = bridge.layer_open(source);
    if (opened.status !== 'ok') throw new Error('kabuto opens');
    const { session, front_up: frontUp } = opened;
    const relations = bridge.layer_oriedita_relations(session);
    const open = new Set(pairsOf(opened.open_pairs).map(([a, b]) => `${a},${b}`));

    // Against what the creases force.
    const forced = pairsOf(relations)
      .map(([u, l]): [number, number] => [Math.min(u, l), Math.max(u, l)])
      .find(([a, b]) => !open.has(`${a},${b}`));
    if (!forced) throw new Error('kabuto forces pairs');
    const no = bridge.layer_preview(session, againstShown(relations, forced, frontUp));
    if (no.verdict !== 'cant_fit') throw new Error(`not a no: ${JSON.stringify(no)}`);
    expect(no.proof).toEqual({ kind: 'forced' });
    expect(no.faces).toBeInstanceOf(Uint32Array);
    expect(Array.from(no.constraints)).toEqual([0]);

    // Out of nodes, then out of time; the same call later answers.
    let timedOut = 0;
    for (const pair of pairsOf(opened.open_pairs)) {
      const candidate = againstShown(relations, pair, frontUp);
      for (const [limits, limit] of [
        [{ maxNodes: 0, fastNodes: 0 }, 'nodes'],
        [{ deadlineMs: 0 }, 'deadline'],
      ] as const) {
        const first = bridge.layer_preview(session, candidate, limits);
        if (first.verdict !== 'timed_out') continue;
        timedOut += 1;
        expect(first.limit).toBe(limit);
        const later = bridge.layer_preview(session, candidate, { deadlineMs: 60_000 });
        expect(later.verdict).not.toBe('timed_out');
        expect(bridge.layer_commit(session, candidate, limits).verdict).toBe('timed_out');
        expect(bridge.layer_constraints(session)).toHaveLength(0);
      }
    }
    expect(timedOut).toBeGreaterThan(10);

    // The open's own refusals.
    expect(bridge.layer_open({ ...source, digest: '0000000000000000' })).toEqual({
      status: 'refused',
      refusal: { code: 'source_digest_mismatch', expected: '0000000000000000', actual: source.digest },
    });
    expect(bridge.layer_open(source, { maxNodes: 0 })).toMatchObject({
      status: 'refused',
      refusal: { code: 'session_timed_out', limit: 'nodes' },
    });
    expect(bridge.layer_open(source, { deadlineMs: 0 })).toMatchObject({
      status: 'refused',
      refusal: { code: 'session_timed_out', limit: 'deadline' },
    });
    expect(bridge.layer_restore(source, 'not json')).toEqual({
      status: 'refused',
      refusal: { code: 'record_damaged', damage: 'not-json' },
    });

    // A caller's mistakes throw, by code.
    const [[a]] = pairsOf(opened.open_pairs);
    expect(thrownCode(() => bridge.layer_preview(session, Int32Array.of(a, a, 1)))).toBe('session_bad_constraint');
    expect(thrownCode(() => bridge.layer_preview(session, Int32Array.of(a, 1)))).toBe('invalid_input');
    expect(thrownCode(() => bridge.layer_stacks(session, 'up' as 'front'))).toBe('invalid_input');
    expect(thrownCode(() => bridge.layer_open(source, { deadline: 5 } as never))).toBe('invalid_input');

    // Close, then use.
    expect(bridge.layer_close(session)).toBe(true);
    expect(bridge.layer_close(session)).toBe(false);
    expect(thrownCode(() => bridge.layer_open_pairs(session))).toBe('unknown_layer_session');
    expect(thrownCode(() => bridge.layer_save(session))).toBe('unknown_layer_session');
    expect(bridge.layer_live()).toBe(0);
    engine.free();
  });

  it('opens on the order Edit shows, adds by its preview, and carries what a restore cannot apply', () => {
    // Kabuto as Edit folds and shows it, and the scene Edit holds of it.
    const document = cp.load_fold(readFileSync(KABUTO, 'utf8'), '');
    const summary = cp.document_summary(document) as OristudioCpDocumentSummary;
    const lines = Array.from({ length: summary.line_segments }, (_, index) => index + 1);
    const source = cp.fold_source_of_selection(document, lines, 1) as OristudioCpFoldSource;
    const figure = cp.folded_figure_fold_selected(document, lines, 1, 'Order5', null, 0) as OristudioCpFoldedFigureResult;
    const scene = cp.folded_figure_paper_scene(figure.handle) as OristudioCpFoldedPaperScene | null;
    if (!scene) throw new Error('kabuto has subfaces');
    expect(scene.flipped).toBe(false);
    cp.free_folded_figure(figure.handle);
    cp.free_document(document);

    const engine = new fold.FoldEngine();
    const bridge: LayerOrderBridge = engine;
    const first = bridge.layer_open(source);
    if (first.status !== 'ok') throw new Error('kabuto opens');
    expect(first.opened_on).toEqual({ kind: 'first', timed_out: null });

    // Open on Edit's order: the dialog shows what Edit shows, spot for spot.
    const showing = bridge.layer_open_showing(source, layerOrderSceneRelations(scene), { deadlineMs: 10_000 });
    if (showing.status !== 'ok') throw new Error(`refused: ${JSON.stringify(showing.refusal)}`);
    expect(showing.opened_on).toEqual({ kind: 'held', ignored: 0 });
    expect(bridge.layer_opened_on(showing.session)).toEqual({ kind: 'held', ignored: 0 });
    const front = bridge.layer_stacks(showing.session, 'front');
    scene.subfaces.forEach((subface, i) => expect(spot(front, i)).toEqual(subface.faces_top_to_bottom));
    expect(thrownCode(() => bridge.layer_open_showing(source, Uint32Array.of(1, 2, 3)))).toBe('invalid_input');

    // Add by the preview: adopted with no search.
    const { session, front_up: frontUp } = showing;
    const relations = bridge.layer_oriedita_relations(session);
    const open = pairsOf(showing.open_pairs);
    const candidate = againstShown(relations, open[0], frontUp);
    const preview: LayerPreviewed = bridge.layer_preview(session, candidate, { deadlineMs: 3_000 });
    if (preview.verdict !== 'fits') throw new Error(`no fit: ${JSON.stringify(preview)}`);
    expect(preview.token).toBeGreaterThan(0);
    const added: LayerCommitted = bridge.layer_commit_preview(session, preview.token, candidate, {
      maxNodes: 0,
      fastNodes: 0,
    });
    if (added.verdict !== 'committed') throw new Error(`not committed: ${JSON.stringify(added)}`);
    expect(added.adopted).toBe(true);
    expect(added.stacks).toEqual(preview.stacks);

    // A whole list previewed, then added by its token; a stale token searches.
    const second = againstShown(bridge.layer_oriedita_relations(session), pairsOf(added.open_pairs)[0], frontUp);
    const list = Int32Array.from([...candidate, ...second]);
    const listed = bridge.layer_preview_list(session, list, { deadlineMs: 3_000 });
    if (listed.verdict !== 'fits') throw new Error(`no fit: ${JSON.stringify(listed)}`);
    expect(bridge.layer_constraints(session)).toEqual(candidate);
    const stale = bridge.layer_commit_preview(session, listed.token + 1, list, { deadlineMs: 3_000 });
    expect(stale).toMatchObject({ verdict: 'committed', adopted: false });
    expect(bridge.layer_constraints(session)).toEqual(list);

    // Restore on the same session, a record whose first constraint is also
    // saved the other way: they clash, nothing is applied, and every saved
    // constraint is carried.
    const saved = bridge.layer_save(session);
    if (saved.status !== 'ok') throw new Error('it saves');
    const read = readLayerOrderRecord(saved.json);
    if (typeof read === 'symbol' || !read.ok) throw new Error('the record reads');
    const [f, g, sign] = read.record.constraints[0]!;
    const clashing = encodeLayerOrderRecord({
      ...read.record,
      constraints: [...read.record.constraints, [f, g, sign === 1 ? -1 : 1]],
    });
    if (!clashing.ok) throw new Error('it encodes');
    const restored = bridge.layer_restore_record(session, clashing.json, { deadlineMs: 10_000 });
    if (restored.status !== 'ok') throw new Error(`refused: ${JSON.stringify(restored.refusal)}`);
    expect(restored.session).toBe(session);
    expect(restored.outcome).toEqual({ kind: 'clash', constraints: [0, 2] });
    expect(restored.constraints).toEqual(new Int32Array(0));
    expect(restored.saved_constraints).toEqual([{ status: 'clashing' }, { status: 'intact' }, { status: 'clashing' }]);
    expect(restored.carried.map((row) => [row.index, row.status, row.constraint])).toEqual([
      [0, 'clashing', Array.from(candidate)],
      [1, 'intact', Array.from(second)],
      [2, 'clashing', [candidate[0], candidate[1], -candidate[2]!]],
    ]);
    expect(bridge.layer_carried(session)).toEqual(restored.carried);
    expect(bridge.layer_opened_on(session)).toEqual(restored.opened_on);

    // A save writes every carried row back, or those `keep` names by record index; the session keeps them all.
    const constraintsSaved = (keep?: number[]) => {
      const again = bridge.layer_save(session, keep ? Uint32Array.from(keep) : undefined);
      if (again.status !== 'ok') throw new Error('it saves');
      const record = readLayerOrderRecord(again.json);
      if (typeof record === 'symbol' || !record.ok) throw new Error('the record reads');
      return record.record.constraints.length;
    };
    expect(constraintsSaved()).toBe(3);
    expect(constraintsSaved([2])).toBe(1);
    expect(constraintsSaved([])).toBe(0);
    expect(bridge.layer_carried(session)).toHaveLength(3);
    // A removal names its row by record index, never its place: index 2 is found after index 0 goes.
    expect(bridge.layer_remove_carried(session, 0)).toBe(true);
    expect(bridge.layer_remove_carried(session, 2)).toBe(true);
    expect(bridge.layer_remove_carried(session, 9)).toBe(false);
    expect(bridge.layer_carried(session).map((row) => row.index)).toEqual([1]);
    expect(constraintsSaved()).toBe(1);
    // Committing the rows applies them, and they leave the carried rows.
    const rows = bridge.layer_preview_list(session, list, { deadlineMs: 3_000 });
    if (rows.verdict !== 'fits') throw new Error('the two rows fit');
    expect(bridge.layer_commit_preview(session, rows.token, list)).toMatchObject({ verdict: 'committed', adopted: true });
    expect(bridge.layer_carried(session)).toEqual([]);
    bridge.layer_clear_carried(session);
    expect(constraintsSaved()).toBe(2);
    engine.free();
  });

  /** A fixture folded whole, as Edit's selection hands it over. */
  function sourceOf(relative: string): OristudioCpFoldSource {
    const text = readFileSync(resolve(ROOT, '../../tests/fixtures', relative), 'utf8');
    const document = relative.endsWith('.cp') ? cp.load_cp(text, '') : cp.load_fold(text, '');
    const summary = cp.document_summary(document) as OristudioCpDocumentSummary;
    const lines = Array.from({ length: summary.line_segments }, (_, index) => index + 1);
    const source = cp.fold_source_of_selection(document, lines, 1) as OristudioCpFoldSource;
    cp.free_document(document);
    return source;
  }

  /** The count advanced in small slices to its end, as the dialog's worker does between calls. */
  function countInSlices(bridge: LayerOrderBridge, session: number, cursor: number) {
    for (let slices = 1; slices < 100_000; slices += 1) {
      const count = bridge.layer_solutions_advance(session, cursor, { maxNodes: 1, deadlineMs: 50 });
      if (count.done) return { count, slices };
    }
    throw new Error('the count never ends');
  }

  it('counts the solutions in slices, walks the stepper through each once, and explains a clash', () => {
    const engine = new fold.FoldEngine();
    const bridge: LayerOrderBridge = engine;
    const fixtures = [
      { relative: 'flat-folder/kabuto.fold', front: 9, back: 1, orders: 9 },
      { relative: 'oriedita/solution_sample_1.cp', front: 1, back: 16, orders: 16 },
    ];
    for (const { relative, front, back, orders } of fixtures) {
      const opened = bridge.layer_open(sourceOf(relative), { deadlineMs: 10_000 });
      if (opened.status !== 'ok') throw new Error(`${relative} opens`);
      const cursor = bridge.layer_solutions_start(opened.session);
      const { count } = countInSlices(bridge, opened.session, cursor);
      expect(count, relative).toEqual({
        front: { n: front, exact: true },
        back: { n: back, exact: true },
        orders: { n: orders, exact: true },
        done: true,
      });
      // The stepper, by the pictures from the side with more of them, from
      // the first to the last: each once, 1 to N.
      const by = { picture: front >= back ? 'front' : 'back' } as const;
      const total = Math.max(front, back);
      while (bridge.layer_step(opened.session, cursor, by, 'previous').verdict === 'moved');
      const tops = () => {
        const stacks = bridge.layer_stacks(opened.session, by.picture);
        return Array.from(stacks.offsets.subarray(0, -1), (start, i) =>
          start < stacks.offsets[i + 1]! ? stacks.faces[start] : -1
        ).join(',');
      };
      const seen = [{ index: bridge.layer_solutions_position(opened.session, cursor, by).index, tops: tops() }];
      for (;;) {
        const stepped = bridge.layer_step(opened.session, cursor, by, 'next', { deadlineMs: 3_000 });
        if (stepped.verdict === 'end') break;
        if (stepped.verdict !== 'moved') throw new Error(`no step: ${JSON.stringify(stepped)}`);
        expect(stepped.changed.front).toBeInstanceOf(Uint32Array);
        expect(stepped.position.total).toEqual({ n: total, exact: true });
        seen.push({ index: stepped.position.index, tops: tops() });
      }
      expect(seen.map((s) => s.index), relative).toEqual(Array.from({ length: total }, (_, i) => i + 1));
      expect(new Set(seen.map((s) => s.tops)).size, relative).toBe(total);
      // With X-ray: every layer order, each once.
      const xray = bridge.layer_solutions_position(opened.session, cursor, 'layer_order');
      expect(xray.total).toEqual({ n: orders, exact: true });
      expect(bridge.layer_solutions_close(opened.session, cursor)).toBe(true);
      expect(thrownCode(() => bridge.layer_solutions_advance(opened.session, cursor))).toBe('unknown_layer_cursor');
    }

    // Kabuto: a commit makes a cursor stale; a step keeps it good.
    const opened = bridge.layer_open(sourceOf('flat-folder/kabuto.fold'));
    if (opened.status !== 'ok') throw new Error('kabuto opens');
    const { session, front_up: frontUp } = opened;
    const cursor = bridge.layer_solutions_start(session, { storedBits: 1 << 20 });
    countInSlices(bridge, session, cursor);
    expect(bridge.layer_step(session, cursor, 'layer_order', 'next').verdict).toBe('moved');
    expect(bridge.layer_solutions_advance(session, cursor).done).toBe(true);
    const [a, b] = pairsOf(opened.open_pairs)[0]!;
    const first = inFrontOf(a, b, frontUp);
    expect(bridge.layer_commit(session, first, { deadlineMs: 3_000 }).verdict).toBe('committed');
    expect(thrownCode(() => bridge.layer_solutions_advance(session, cursor))).toBe('session_stale_solutions');
    expect(thrownCode(() => bridge.layer_step(session, cursor, { picture: 'front' }, 'next'))).toBe(
      'session_stale_solutions'
    );
    const fewer = bridge.layer_solutions_start(session);
    expect(countInSlices(bridge, session, fewer).count.front.n).toBeLessThan(9);
    expect(thrownCode(() => bridge.layer_solutions_start(session, { orders: 1 } as never))).toBe('invalid_input');
    expect(thrownCode(() => bridge.layer_solutions_position(session, fewer, 'up' as never))).toBe('invalid_input');

    // Explain: the committed constraint's pair the other way clashes with
    // it, both needed; a candidate that fits has nothing to explain.
    const reversed = Int32Array.of(first[0]!, first[1]!, -first[2]!);
    const explained = bridge.layer_explain(session, reversed, { deadlineMs: 3_000 });
    if (explained.verdict !== 'clash') throw new Error(`no clash: ${JSON.stringify(explained)}`);
    expect(Array.from(explained.constraints)).toEqual([0, 1]);
    expect(explained.minimal).toBe(true);
    expect(Array.from(explained.faces)).toEqual([Math.min(a, b), Math.max(a, b)]);
    expect(explained.proof).toEqual({ kind: 'opposed' });
    expect(bridge.layer_explain(session, first)).toEqual({ verdict: 'fits' });
    const listed = bridge.layer_explain_list(session, Int32Array.from([...reversed, ...first]));
    expect(listed).toMatchObject({ verdict: 'clash', minimal: true });
    expect(bridge.layer_constraints(session)).toEqual(first);
    engine.free();
  });

  /** A stacking cap as the engine declares it: `name` in `file` under `crates/`. */
  function capOf(file: string, name: string): number {
    const text = readFileSync(resolve(ROOT, '../../crates', file), 'utf8');
    return Number(new RegExp(`pub const ${name}: u64 = ([\\d_]+);`).exec(text)?.[1]?.replaceAll('_', ''));
  }

  const choose3 = (d: number) => (d * (d - 1) * (d - 2)) / 6;
  /** The fewest layers one stack needs to hold more than `cap` triples. */
  function deepestOver(cap: number): number {
    let d = 3;
    while (choose3(d) <= cap) d += 1;
    return d;
  }

  /** `strips` vertical strips folded back and forth along creases of alternating letters: one stack, `strips` deep. */
  function accordionCp(strips: number): string {
    const x = (k: number) => -200 + (400 * k) / strips;
    const lines = ['1 200 -200 200 200', '1 -200 200 -200 -200'];
    for (let k = 0; k < strips; k += 1) lines.push(`1 ${x(k)} -200 ${x(k + 1)} -200`, `1 ${x(k)} 200 ${x(k + 1)} 200`);
    for (let k = 1; k < strips; k += 1) lines.push(`${k % 2 === 0 ? 2 : 3} ${x(k)} -200 ${x(k)} 200`);
    return `${lines.join('\n')}\n`;
  }

  function accordionSource(strips: number): OristudioCpFoldSource {
    const document = cp.load_cp(accordionCp(strips), '');
    const summary = cp.document_summary(document) as OristudioCpDocumentSummary;
    const lines = Array.from({ length: summary.line_segments }, (_, index) => index + 1);
    const source = cp.fold_source_of_selection(document, lines, 1) as OristudioCpFoldSource;
    cp.free_document(document);
    return source;
  }

  it('takes stacks deeper than Fold’s cap, up to its own, and says how deep one past it stacks', () => {
    const dialogCap = capOf('oristudio-fold/src/steer/source.rs', 'LAYER_ORDER_MAX_STACKED_TRIPLES');
    const foldCap = capOf('oristudio-layer-order/src/problem.rs', 'MAX_STACKED_TRIPLES');
    expect(foldCap).toBe(12_000_000);
    expect(dialogCap).toBeGreaterThan(foldCap);
    const engine = new fold.FoldEngine();
    const bridge: LayerOrderBridge = engine;

    // One layer past the deepest stack Fold takes: the source is built and
    // admitted (an open given no time runs out only after building it),
    // while Fold's Import CP refuses the same pattern by its counts.
    const between = deepestOver(foldCap);
    expect(choose3(between)).toBeLessThanOrEqual(dialogCap);
    expect(bridge.layer_open(accordionSource(between), { deadlineMs: 0 })).toMatchObject({
      status: 'refused',
      refusal: { code: 'session_timed_out', limit: 'deadline' },
    });
    const bytes = new TextEncoder().encode(accordionCp(between));
    expect(engine.import_cp({ format: 'cp', sample: false }, bytes, { kind: 'empty' }, undefined)).toMatchObject({
      status: 'refused',
      refusal: { code: 'import_stacked_too_deep', deepest: between, triples: choose3(between), limit: foldCap },
    });

    // One layer past the dialog's own: refused with how deep it stacks.
    const over = deepestOver(dialogCap);
    expect(bridge.layer_open(accordionSource(over))).toEqual({
      status: 'refused',
      refusal: { code: 'source_stacked_too_deep', deepest: over, triples: choose3(over), limit: dialogCap },
    });
    expect(bridge.layer_live()).toBe(0);
    engine.free();
  });
});
