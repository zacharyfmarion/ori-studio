import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  OristudioCpDocumentSummary,
  OristudioCpFoldedFigureResult,
  OristudioCpFoldSource,
} from '../../engine/oristudioCpTypes';
import { layerOrderSourceOf } from '../../lib/layerOrder/layerOrderSource';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import { createLayerOrderBridgeBackend } from '../../workers/layerOrderBridgeBackend';
import { inProcessLayerOrderWorkers } from './layerOrderEngine.fixtures';
import { LAYER_ORDER_LIMITS } from './layerOrderEngine';
import { createLayerOrderRuntime } from './layerOrderRuntime';

/**
 * The two kernels name the same faces (`implementation-plans/layer-order-dialog.md`,
 * approach 2 and "Risks"): the CP bridge, which folds what the host shows, and
 * the Fold bridge, which the dialog analyses on, are two builds of the same
 * kernel in two wasm modules, and the face-ring digest is what says they
 * traced the same faces from the same segments.
 *
 * On every file fixture the native kernel's digests are recorded for
 * (`tests/fixtures/oristudio-cp/face-ring-digests.json`,
 * `crates/oristudio-cp/tests/fold_with_order.rs`), the CP bridge's digest of
 * a whole-sheet selection, of the figure it folds and of that figure's
 * source are the recorded one; the Fold bridge, handed the same segments
 * under a forged digest, refuses the open and names the digest it traced,
 * which is that same one; and handed the true digest, it does not refuse on
 * it. The refusal reaches the dialog's runtime as an answer, not a failure.
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

/** The kernel test's `FILE_FIXTURES`, in its order (also `engine/oristudioCpFoldWithOrder.wasm.test.ts`'s). */
const FILE_FIXTURES: [string, string][] = [
  ['solution_sample_1', 'oriedita/solution_sample_1.cp'],
  ['failing_global_flat_fold', 'oriedita/failing_global_flat_fold.ori'],
  ['holed_sheet_spiral', 'oriedita/holed_sheet_spiral.ori'],
  ['holed_frame_collinear', 'oriedita/holed_frame_collinear.ori'],
  ['kabuto', 'flat-folder/kabuto.fold'],
  ['bad_twist', 'flat-folder/bad_twist.fold'],
  ['r069-s07', 'flat-folder/r069-s07.fold'],
  ['r271-s03', 'flat-folder/r271-s03.fold'],
  ['pleat-in-eighths', 'fold-samples/pleat-in-eighths.fold'],
  ['preliminary-base', 'fold-samples/preliminary-base.fold'],
  ['waterbomb-base', 'fold-samples/waterbomb-base.fold'],
];

const RECORDED: { fixture: string; faces: number; digest: string }[] = JSON.parse(
  readFileSync(resolve(FIXTURES, 'oristudio-cp/face-ring-digests.json'), 'utf8')
);

/** Sixteen hex digits that are no fixture's digest. */
const FORGED = '0000000000000000';

describe.skipIf(!available)('the CP and Fold bridges trace the same faces', () => {
  let fold: FoldWasm;
  let cp: CpWasm;

  beforeAll(async () => {
    fold = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
    fold.initSync({ module: readFileSync(FOLD_WASM) });
    cp = await import('../../generated/oristudio-cp-wasm/oristudio_cp_wasm');
    cp.initSync({ module: readFileSync(CP_WASM) });
  });

  /** A fixture opened as a host opens a file, every line selected: the CP bridge's three digests of it. */
  function cpDigests(relative: string) {
    const text = readFileSync(resolve(FIXTURES, relative), 'utf8');
    const extension = extname(relative);
    const document =
      extension === '.cp' ? cp.load_cp(text, '') : extension === '.ori' ? cp.load_ori(text, false) : cp.load_fold(text, '');
    const summary = cp.document_summary(document) as OristudioCpDocumentSummary;
    const lines = Array.from({ length: summary.line_segments }, (_, index) => index + 1);
    const selection = cp.fold_source_of_selection(document, lines, 1) as OristudioCpFoldSource;
    const figure = cp.folded_figure_fold_selected(document, lines, 1, 'Order5', null, 0) as OristudioCpFoldedFigureResult;
    const figureSource = cp.folded_figure_source(figure.handle, document) as OristudioCpFoldSource;
    const figureDigest = cp.folded_figure_digest(figure.handle);
    cp.free_folded_figure(figure.handle);
    cp.free_document(document);
    return { selection, figureSource, figureDigest };
  }

  it('on every file fixture: equal digests, a forged one refused naming the true one', () => {
    expect(RECORDED.map(({ fixture }) => fixture)).toEqual(FILE_FIXTURES.map(([name]) => name));
    const backend = createLayerOrderBridgeBackend(new fold.FoldEngine());
    const opens: Record<string, string> = {};

    for (const [name, relative] of FILE_FIXTURES) {
      const recorded = RECORDED.find(({ fixture }) => fixture === name)!.digest;
      const { selection, figureSource, figureDigest } = cpDigests(relative);
      expect(selection.digest, name).toBe(recorded);
      expect(figureDigest, name).toBe(recorded);
      expect(figureSource.digest, name).toBe(recorded);
      expect(figureSource.segments, name).toEqual(selection.segments);

      const source = layerOrderSourceOf(selection, DEFAULT_FOLDED_MODEL);
      expect(backend.open({ ...source, digest: FORGED }, LAYER_ORDER_LIMITS.open), name).toEqual({
        status: 'refused',
        refusal: { code: 'source_digest_mismatch', expected: FORGED, actual: recorded },
      });

      const opened = backend.open(source, LAYER_ORDER_LIMITS.open) as Awaited<ReturnType<typeof backend.open>>;
      opens[name] = opened.status === 'ok' ? 'ok' : opened.refusal.code;
      expect(opens[name], name).not.toBe('source_digest_mismatch');
    }

    // What the true digest opens to: past the digest, every refusal is the fold's own.
    expect(opens).toEqual({
      solution_sample_1: 'ok',
      // Creases that admit no flat order, as the names say.
      failing_global_flat_fold: 'session_no_order',
      bad_twist: 'session_no_order',
      holed_sheet_spiral: 'ok',
      // The frame's hole leaves a face with a reflex corner: refused in v1 (D4).
      holed_frame_collinear: 'source_non_convex_face',
      kabuto: 'ok',
      'r069-s07': 'ok',
      'r271-s03': 'ok',
      'pleat-in-eighths': 'ok',
      'preliminary-base': 'ok',
      'waterbomb-base': 'ok',
    });
  });

  it('the refusal reaches the dialog’s runtime as an answer, and leaves no session open', async () => {
    const workers = inProcessLayerOrderWorkers(() => createLayerOrderBridgeBackend(new fold.FoldEngine()));
    const runtime = createLayerOrderRuntime({ role: 'dialog', spawn: workers.spawn });
    const { selection } = cpDigests('flat-folder/kabuto.fold');
    const source = layerOrderSourceOf(selection, DEFAULT_FOLDED_MODEL);

    await expect(runtime.engine.open({ ...source, digest: FORGED }, LAYER_ORDER_LIMITS.open)).resolves.toEqual({
      status: 'refused',
      refusal: { code: 'source_digest_mismatch', expected: FORGED, actual: selection.digest },
    });
    await expect(runtime.engine.openPairs()).rejects.toMatchObject({ code: 'layer_order_session_not_open' });
    // A forged digest refuses the open on the host's order too.
    await expect(
      runtime.engine.openShowing({ ...source, digest: FORGED }, new Uint32Array(), LAYER_ORDER_LIMITS.open)
    ).resolves.toMatchObject({ status: 'refused', refusal: { code: 'source_digest_mismatch' } });
    expect(workers.workers[0]!.terminated).toBe(false);
    runtime.dispose();
  });
});
