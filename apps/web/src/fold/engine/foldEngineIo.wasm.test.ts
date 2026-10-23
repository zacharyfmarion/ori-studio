import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedFigureResult,
  OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';
import { initCpWasm } from '../../engine/oristudioCpTestSupport';
import {
  document_snapshot,
  folded_figure_fold,
  folded_figure_paper_scene,
  folded_figure_set_model,
  free_document,
  free_folded_figure,
  load_fold_file,
} from '../../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import { SQUARE_PAPER } from '../document/foldSequenceDocument';
import { createFoldEngineCalls, type FoldEngineCalls } from './foldEngineCalls';
import { createFoldEngineIoCalls, type FoldEngineIoCalls } from './foldEngineIoCalls';
import { FOLD_SAMPLES, foldSampleSource, type FoldSampleId } from './foldEngineIoSamples';
import { foldSendToEditPayload } from './foldEngineIoSendToEdit';
import type { FoldImportFingerprinted } from './foldEngineIoWire';
import { FOLD_REFUSAL_CODES, type FoldEngineOutcome, type FoldEngineRefused } from './foldEngineWire';

/**
 * Import CP, Start from Edit's folded figure, Send to Edit and the FOLD
 * export over the real bridge, in-process: exactly what
 * `workers/foldSequenceWorker.ts` runs beside the step calls, on one engine.
 *
 * The crate's tests prove the behaviour natively; what they do not cover is
 * TypeScript's side of the boundary — a file's text crossing as bytes, the
 * samples as the app bundles them, the `cp-jump` op a pick returns going back
 * through the ordinary `step` call as the replay sends it, and Edit's folded
 * figure handed over as the CP kernel's own bridge produces it, folded by that
 * bridge in this process.
 *
 * Skipped when either bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds them before the web tests run.
 */
const ROOT = process.cwd();
const FOLD_WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const CP_WASM = resolve(ROOT, 'src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm');
const available = existsSync(FOLD_WASM) && existsSync(CP_WASM);

interface Engine {
  calls: FoldEngineCalls;
  io: FoldEngineIoCalls;
}

async function makeEngine(): Promise<Engine> {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(FOLD_WASM) });
  const fold = new wasm.FoldEngine();
  return { calls: createFoldEngineCalls(fold), io: createFoldEngineIoCalls(fold) };
}

function landed<T>(outcome: FoldEngineOutcome<T>): T {
  if (outcome.status !== 'ok') throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome;
}

function refused<T>(outcome: FoldEngineOutcome<T>): FoldEngineRefused {
  if (outcome.status !== 'refused') throw new Error('landed');
  return outcome;
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('did not throw');
}

function sample(id: FoldSampleId) {
  const found = FOLD_SAMPLES.find((s) => s.id === id);
  if (!found) throw new Error(`no sample ${id}`);
  return found;
}

/** A sample imported into an empty sequence, its one order picked. */
function importSample({ io }: Engine, id: FoldSampleId): FoldImportFingerprinted {
  const opened = landed(io.importCp(foldSampleSource(sample(id)), { kind: 'empty' }));
  return landed(io.importPick(opened.import, []));
}

/** Edit's folded figure of a FOLD text, front and rear, as the kernel's bridge folds it. */
function editFigure(text: string): OristudioCpFoldedPaperScene[] {
  const document = load_fold_file(text);
  const result = folded_figure_fold(document, 1, 'Order5', undefined, 0) as OristudioCpFoldedFigureResult;
  const front = folded_figure_paper_scene(result.handle) as OristudioCpFoldedPaperScene | null;
  folded_figure_set_model(result.handle, { ...result.snapshot.model, state: 'Back1' });
  const rear = folded_figure_paper_scene(result.handle) as OristudioCpFoldedPaperScene | null;
  free_folded_figure(result.handle);
  free_document(document);
  if (!front || !rear) throw new Error('the kernel folded nothing');
  return [front, rear];
}

/** A square creased with a plus, neither crease's letter known: an import with a choice. */
const PLUS = JSON.stringify({
  vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5], [0.5, 0.5]],
  edges_vertices: [[0, 4], [4, 1], [1, 5], [5, 2], [2, 6], [6, 3], [3, 7], [7, 0], [4, 8], [8, 6], [7, 8], [8, 5]],
  edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'U', 'U', 'U', 'U'],
});

describe.skipIf(!available)('Import CP and the FOLD hand-offs through the built bridge', () => {
  beforeAll(async () => {
    await initCpWasm();
  });

  it('imports every sample to its one order, and the op it returns replays as a step', async () => {
    const { calls, io } = await makeEngine();
    expect(FOLD_SAMPLES.map((s) => s.id)).toEqual(['preliminary-base', 'waterbomb-base', 'pleat-in-eighths']);
    for (const { id } of FOLD_SAMPLES) {
      const opened = landed(io.importCp(foldSampleSource(sample(id)), { kind: 'empty', startSide: 'front' }));
      expect(opened.count, id).toEqual({ orders: 1, exact: true });
      expect(opened.paper, id).toEqual({ kind: 'square' });
      expect(opened.components).toEqual([]);
      const picked = landed(io.importPick(opened.import, []));
      expect(picked.op).toMatchObject({ kind: 'cp-jump', origin: 'sample' });
      expect(picked.summary.faces, id).toBe(8);
      expect(picked.fingerprint).toMatch(/^fs1:[0-9a-f]{16}$/);

      // The document stores the adopted paper and the op; a replay lands
      // the step from that paper's sheet to the same fingerprint.
      const sheet = landed(calls.sheet({ shape: opened.paper ?? { kind: 'square' }, startSide: 'front' })).state;
      const replayed = landed(calls.step(sheet, picked.op));
      expect(replayed.fingerprint, id).toBe(picked.fingerprint);
      expect(replayed.report).toBeNull();
      // A region link is provenance only. Offline replay reads the saved CP,
      // even with no Edit document or with that region moved/deleted.
      const linked = { ...picked.op, origin: 'project_cp' as const, source: {
        documentId: 'crease-pattern', revision: 'rc1:saved', region: {
          boundary: [[{ x: 500, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 400 }, { x: 500, y: 400 }]],
          bounds: { minX: 500, minY: 0, maxX: 900, maxY: 400 }, segmentIdHint: 2,
        },
      } };
      expect(landed(calls.step(sheet, linked)).fingerprint, id).toBe(picked.fingerprint);
      expect(io.releaseImports([opened.import])).toBe(1);
    }
    expect(io.liveImports()).toBe(0);
  });

  it('hands Edit a FOLD it opens, and Edit’s folded figure of it comes back as the same state', async () => {
    const engine = await makeEngine();
    const { io } = engine;
    // The pleat has no precrease, so Edit folds every crease Fold has.
    const pleat = importSample(engine, 'pleat-in-eighths');
    const text = io.sendToEdit(pleat.state, 'Pleat');
    for (const scene of editFigure(text)) {
      const figure = landed(io.importEditFoldedFigure(scene, { kind: 'after', state: pleat.state }));
      expect(figure.op.origin).toBe('edit_folded_figure');
      expect(figure.fingerprint).toBe(pleat.fingerprint);
    }

    // A precrease is written unassigned, remembering its letter; the
    // payload's flag, always set, asks Edit to make it an auxiliary line.
    const base = importSample(engine, 'preliminary-base');
    const sent = io.sendToEdit(base.state);
    const document = load_fold_file(sent);
    const snapshot = document_snapshot(document) as OristudioCpDocumentSnapshot;
    free_document(document);
    const unassigned = snapshot.crease_pattern.line_segments.filter((s) => s.color === 'None');
    expect(unassigned.length).toBeGreaterThan(0);
    expect(unassigned.every((s) => s.fold_direction_hint === 'Valley')).toBe(true);
    const payload = foldSendToEditPayload(sent, { label: 'Send to Edit', filename: 'fold.fold' });
    expect(payload).toEqual({
      text: sent,
      format: 'fold',
      label: 'Send to Edit',
      filename: 'fold.fold',
      unassignedAsAuxiliary: true,
    });

    // Send to Edit, then Import CP after the same state: the state again.
    const reopened = landed(io.importCp({ format: 'fold', text: sent }, { kind: 'after', state: base.state }));
    expect(landed(io.importPick(reopened.import, [])).fingerprint).toBe(base.fingerprint);
  });

  it('offers a true n of m after a state, and picks each order as its own step', async () => {
    const { calls, io } = await makeEngine();
    const sheet = landed(calls.sheet(SQUARE_PAPER)).state;
    const bytes = new TextEncoder().encode(PLUS);
    const opened = landed(io.importCp({ format: 'fold', bytes }, { kind: 'after', state: sheet }));
    expect(opened.paper).toBeNull();
    expect(opened.summary.unknown_letters).toBe(4);
    expect(opened.count.exact).toBe(true);
    const sizes = opened.components.map((c) => c.orders);
    expect(sizes.reduce((a, b) => a * b, 1)).toBe(opened.count.orders);
    expect(opened.count.orders).toBeGreaterThan(1);

    const first = landed(io.importPick(opened.import, sizes.map(() => 0)));
    const last = landed(io.importPick(opened.import, sizes.map((n) => n - 1)));
    expect(first.fingerprint).not.toBe(last.fingerprint);
    expect(first.op.cpJson).toBe(last.op.cpJson);
    expect(first.op.orderJson).not.toBe(last.op.orderJson);

    const expanded = landed(io.importSearch(opened.import, sizes.map((n) => n - 1), { perComponent: 4000 }));
    const preserved = landed(io.importPick(expanded.opened.import, expanded.choice));
    expect(preserved.op.orderJson).toBe(last.op.orderJson);
    expect(preserved.fingerprint).toBe(last.fingerprint);

    // Too small a budget is a refusal, and holds nothing.
    const tight = refused(io.importCp({ format: 'fold', text: PLUS }, { kind: 'after', state: sheet }, { maxNodes: 0 }));
    expect(tight.refusal.code).toBe('import_budget_exceeded');
    expect(JSON.stringify(tight)).not.toMatch(/"message"/);
    expect(io.liveImports()).toBe(1);
  });

  it('exports a path as one FOLD file, and refuses or throws as the Rust side does', async () => {
    const { calls, io } = await makeEngine();
    const sheet = landed(calls.sheet(SQUARE_PAPER)).state;
    const book = landed(
      calls.step(sheet, {
        kind: 'valley',
        line: { via: 'free', through: [[0.5, 0], [0.5, 1]] },
        moving: [0.75, 0.5],
        seed: { scope: 'all' },
      })
    );
    const exported = landed(io.exportFold([sheet, book.state], 'Book'));
    const fold = JSON.parse(exported.text) as { file_title: string; file_frames: unknown[] };
    expect(fold.file_title).toBe('Book');
    expect(fold.file_frames).toHaveLength(2);

    const codes: string[] = [];
    const unreadable = refused(io.importCp({ format: 'cp', text: '1 2 3' }, { kind: 'after', state: sheet }));
    expect(unreadable.refusal).toEqual({ code: 'import_unreadable', format: 'cp' });
    codes.push(unreadable.refusal.code);
    const mismatch = refused(
      io.importCp({ format: 'cp', text: '1 0 0 2 0\n1 2 0 2 1\n1 2 1 0 1\n1 0 1 0 0\n' }, { kind: 'after', state: sheet })
    );
    codes.push(mismatch.refusal.code);
    const broken = refused(
      calls.step(sheet, { kind: 'cp-jump', cpJson: 'not json', orderJson: '{}', origin: 'fold' })
    );
    expect(broken.refusal).toEqual({ code: 'import_stored_unreadable', field: 'cp_json' });
    codes.push(broken.refusal.code);
    const known: readonly string[] = FOLD_REFUSAL_CODES;
    expect(codes.filter((code) => !known.includes(code))).toEqual([]);

    expect(thrown(() => io.importPick(1.5, []))).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => io.importPick(40, [-1]))).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => io.importPick(40, []))).toMatchObject({ code: 'unknown_import' });
    expect(
      thrown(() => io.importCp({ format: 'cp', bytes: 'text' as unknown as Uint8Array }, { kind: 'empty' }))
    ).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => io.importCp({ format: 'svg' as 'cp', text: '' }, { kind: 'empty' }))).toMatchObject({
      code: 'invalid_input',
    });
    expect(thrown(() => io.exportFold([]))).toMatchObject({ code: 'invalid_input' });
    expect(thrown(() => io.sendToEdit(sheet + 100))).toMatchObject({ code: 'unknown_state' });
    expect(io.releaseImports([])).toBe(0);
  });
});
