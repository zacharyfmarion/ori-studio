import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TFunction } from 'i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { initCpWasm } from '../../engine/oristudioCpTestSupport';
import { document_snapshot, free_document, load_fold_file } from '../../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import type { FileService } from '../../platform/fileService';
import type { PaperExportTarget } from '../../paperExport/paperExportTarget';
import { createFoldEngineCalls } from '../engine/foldEngineCalls';
import { createFoldEngineIoCalls } from '../engine/foldEngineIoCalls';
import { FOLD_SAMPLES } from '../engine/foldEngineIoSamples';
import { initialFoldReaderState, withFoldCursor } from '../document/foldReaderState';
import { updateFoldCollapse } from '../document/foldSequenceEdits';
import { readFoldSequence, writeFoldSequence } from '../document/foldSequenceFile';
import { createFoldSequence, type FoldPaperShape, type FoldSequenceDocument } from '../document/foldSequenceDocument';
import { createFoldStartingSheetFlow } from './foldStartingSheet';
import { createFoldSession, type FoldSession } from '../session/foldSession';
import { inProcessFoldRuntime, memoryFoldDocument, settle } from '../session/foldSession.fixtures';
import { selectFoldCursorNode } from '../session/foldSessionState';
import { foldImportFileSource } from './foldImportFiles';
import { createFoldImportFlow, type FoldImportFlow, type FoldImportFlowState } from './foldImportFlow';
import { exportFoldSequence, openFoldStepsExport, sendFoldSequenceToEdit, type FoldHandOffDeps } from './foldHandOffs';
import { foldStatePictureUrl } from '../canvas/foldStatePicture';

/**
 * Import CP and the hand-offs over the real bridge, in-process: the flow and
 * the hand-offs exactly as the app runs them, over the session and the
 * engine the worker runs — samples and a fixture `.cp` imported into an
 * empty sequence and committed as they landed, a pattern with several orders
 * pictured and chosen, a refusal said, then the sequence sent to Edit (which
 * the CP kernel's own loader reads back), exported as FOLD and as pages.
 *
 * Skipped when either bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds them before the web tests run.
 */
const ROOT = process.cwd();
const FOLD_WASM = resolve(ROOT, 'src/generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const CP_WASM = resolve(ROOT, 'src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm');
const FIXTURES = resolve(ROOT, '../../tests/fixtures');
const available = existsSync(FOLD_WASM) && existsSync(CP_WASM);

const t = ((_key: string, english: string, values?: Record<string, unknown>) =>
  english.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))) as unknown as TFunction;

/** A square creased with a plus, neither crease's letter known: several orders. */
const PLUS = JSON.stringify({
  vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5], [0.5, 0.5]],
  edges_vertices: [[0, 4], [4, 1], [1, 5], [5, 2], [2, 6], [6, 3], [3, 7], [7, 0], [4, 8], [8, 6], [7, 8], [8, 5]],
  edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'U', 'U', 'U', 'U'],
});

let sessions: FoldSession[] = [];
let flows: FoldImportFlow[] = [];
afterEach(() => {
  for (const flow of flows) flow.dispose();
  for (const session of sessions) session.dispose();
  flows = [];
  sessions = [];
});

async function setup() {
  const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
  wasm.initSync({ module: readFileSync(FOLD_WASM) });
  const runtime = inProcessFoldRuntime(() => {
    const engine = new wasm.FoldEngine();
    return { ...createFoldEngineCalls(engine), ...createFoldEngineIoCalls(engine) };
  }, wasm.fold_engine_version());
  const source = memoryFoldDocument();
  const session = createFoldSession({ document: source, runtime });
  sessions.push(session);
  const flow = createFoldImportFlow({ session, editFoldedFigure: async () => null });
  flows.push(flow);
  return { runtime, source, session, flow };
}

/** Wait for the flow to stop working. */
async function settled(flow: FoldImportFlow): Promise<FoldImportFlowState> {
  for (let round = 0; round < 200; round += 1) {
    const state = flow.store.getState();
    if (state.phase !== 'working') {
      if (state.phase !== 'choosing' || [...state.previews.values()].every((p) => p.status !== 'working')) {
        await settle();
        return flow.store.getState();
      }
    }
    await settle(1);
  }
  return flow.store.getState();
}

function handOffDeps(session: FoldSession) {
  const saved: string[] = [];
  const sent: string[] = [];
  const exported: PaperExportTarget[] = [];
  const deps: FoldHandOffDeps = {
    session,
    t,
    title: () => 'Imported',
    blocked: vi.fn(),
    sendToEdit: async (payload) => {
      sent.push(payload.text);
      return true;
    },
    sentToEdit: vi.fn(),
    fileService: () =>
      ({
        saveTextFile: async (options) => {
          saved.push(options.contents);
          return { name: options.suggestedName, path: null };
        },
      }) as FileService,
    exportStyle: () => DEFAULT_PAPER_STYLE,
    openPaperExport: (target) => exported.push(target),
  };
  return { deps, saved, sent, exported };
}

describe.skipIf(!available)('Import CP and the hand-offs over the built bridge', () => {
  beforeAll(async () => {
    await initCpWasm();
  });

  it('imports each sample into an empty sequence, committed as it landed and replayed to the same state', async () => {
    for (const sample of FOLD_SAMPLES) {
      const { flow, source, session } = await setup();
      await flow.open({ kind: 'sample', sample: sample.id });
      const state = await settled(flow);
      expect(state, sample.id).toMatchObject({ phase: 'done', origin: 'sample' });
      const document = source.read().held?.document as FoldSequenceDocument;
      expect(document.paper.shape).toEqual({ kind: 'square' });
      expect(document.steps).toHaveLength(1);
      const [jump] = document.steps;
      expect(jump && 'op' in jump ? jump.op?.kind : null).toBe('cp-jump');
      const node = selectFoldCursorNode(session.store.getState());
      expect(node.status, sample.id).toBe('ok');
      expect(node.fingerprint).toBe(jump && 'expect' in jump ? jump.expect : null);
      // The step on screen is the state the import landed after a sheet of its
      // own, since let go: its summary is the pattern it brings, which needs none.
      const summarised = await session.withCursor((engine, state) => engine.stepSummary(state));
      expect(summarised, sample.id).toMatchObject({
        status: 'answered',
        value: {
          status: 'ok',
          summary: {
            counts: { mountain: node.summary?.creases.mountain, valley: node.summary?.creases.valley },
            diff: { added: [], reversed: [], unfolded: [], refolded: [] },
            layers: null,
          },
        },
      });
    }
  });

  it('imports a crease pattern file from the fixtures', async () => {
    const { flow, source } = await setup();
    const bytes = new Uint8Array(readFileSync(resolve(FIXTURES, 'oriedita/solution_sample_1.cp')));
    await flow.open({ kind: 'file', name: 'solution_sample_1.cp', source: foldImportFileSource('solution_sample_1.cp', bytes) });
    const state = await settled(flow);
    if (state.phase === 'choosing') {
      for (let guard = 0; guard < 64; guard++) {
        const next = await settled(flow);
        if (next.phase !== 'choosing') break;
        await flow.accept(next.component);
      }
      await settled(flow);
    }
    expect(flow.store.getState()).toMatchObject({ phase: 'done', origin: 'cp' });
    expect(source.read().held?.document.steps).toHaveLength(1);
  });

  it('pictures each of several orders and commits the one chosen, then hands the sequence off', async () => {
    const { flow, source, session } = await setup();
    await flow.open({ kind: 'file', name: 'plus.fold', source: { format: 'fold', text: PLUS } });
    const state = await settled(flow);
    if (state.phase !== 'choosing') throw new Error(`not choosing: ${state.phase}`);
    expect(state.opened.count.orders).toBeGreaterThan(1);
    const pictures = [...state.previews.values()];
    expect(pictures.length).toBe(1);
    for (const preview of pictures) {
      expect(preview.status).toBe('ready');
      if (preview.status === 'ready') expect(foldStatePictureUrl(preview.scene, DEFAULT_PAPER_STYLE)).toMatch(/^data:image\/svg\+xml/);
    }
    const last = state.opened.components.findIndex((component) => component.orders > 1);
    flow.choose(last, state.opened.components[last]!.orders - 1);
    await settled(flow);
    for (let guard = 0; guard < 64; guard++) {
      const next = await settled(flow);
      if (next.phase !== 'choosing') break;
      await flow.accept(next.component);
    }
    expect(await settled(flow)).toMatchObject({ phase: 'done', origin: 'fold' });
    expect(source.read().held?.document.steps).toHaveLength(1);

    const { deps, saved, sent, exported } = handOffDeps(session);
    await expect(sendFoldSequenceToEdit(deps)).resolves.toBe(true);
    const document = load_fold_file(sent[0]!);
    const snapshot = document_snapshot(document) as OristudioCpDocumentSnapshot;
    free_document(document);
    expect(snapshot.crease_pattern.line_segments.length).toBeGreaterThan(4);

    await expect(exportFoldSequence(deps)).resolves.toBe(true);
    const fold = JSON.parse(saved[0]!) as { file_title: string; file_frames: unknown[] };
    expect(fold.file_title).toBe('Imported');
    expect(fold.file_frames).toHaveLength(2);

    await expect(openFoldStepsExport(deps, 'all')).resolves.toBe(true);
    expect(exported[0]?.pages?.list.map((page) => page.label)).toEqual(['Step 1']);
    expect(deps.blocked).not.toHaveBeenCalled();
  });

  it('replays linked snapshots offline and marks affected descendants after an explicit update', async () => {
    const { source, session } = await setup();
    const half = JSON.stringify({ vertices_coords: [[0,0],[1,0],[1,1],[0,1],[.5,0],[.5,1]],
      edges_vertices: [[0,4],[4,1],[1,2],[2,5],[5,3],[3,0],[4,5]],
      edges_assignment: ['B','B','B','B','B','B','V'] });
    const link = { documentId: 'crease-pattern', revision: 'saved' };
    const flow = createFoldImportFlow({ session, editFoldedFigure: async () => null,
      projectCp: async () => ({ source: { format: 'fold', text: half }, link, current: () => true }),
    });
    flows.push(flow);
    await flow.open({ kind: 'project-cp' });
    expect((await settled(flow)).phase).toBe('done');
    const held = source.read().held!;
    const collapse = held.document.steps[0]!;
    if (collapse.op?.kind !== 'cp-jump') throw new Error('Expected linked collapse');
    expect(collapse.op.source).toEqual(link);
    const before = selectFoldCursorNode(session.store.getState()).fingerprint;
    // Reopen with no live source adapter. Replay uses only the embedded CP/order.
    const saved = readFoldSequence(JSON.parse(JSON.stringify(writeFoldSequence(held))))!;
    source.set({ held: saved, loadId: 2 });
    await settle(20);
    expect(selectFoldCursorNode(session.store.getState()).fingerprint).toBe(before);
    const child = source.commit({ parent: collapse.id, op: { kind: 'turn', axis: 'vertical' } }, 2)!;
    await settle(20);
    const childFingerprint = selectFoldCursorNode(session.store.getState()).fingerprint!;
    const branch = source.commit({ parent: collapse.id, op: { kind: 'unfold', crease: [.5, .25],
      direction: 'valley', seed: { scope: 'depth', at: [.25, .25], layers: 1 } } }, 2)!;
    await settle(20);
    expect(session.store.getState().nodes.get(branch)?.status).toBe('ok');
    const doc = source.read().held!.document;
    const expectedDoc = { ...doc, steps: doc.steps.map(node => node.id === child ? { ...node, expect: childFingerprint } : node) };
    source.set({ held: { document: expectedDoc, readOnlyRaw: null } });
    await settle(10);
    const simple = JSON.stringify({ vertices_coords: [[0,0],[1,0],[1,1],[0,1]],
      edges_vertices: [[0,1],[1,2],[2,3],[3,0]], edges_assignment: ['B','B','B','B'] });
    const update = createFoldImportFlow({ session, editFoldedFigure: async () => null,
      projectCp: async () => ({ source: { format: 'fold', text: simple }, link: { ...link, revision: 'new' },
        at: null, current: () => true, replace: (landed) => {
          const document = updateFoldCollapse(expectedDoc, collapse.id, collapse.op as import('../document/foldSequenceDocument').FoldCpJumpOp, landed.op, landed.fingerprint);
          source.set({ held: { document, readOnlyRaw: null } });
          return document !== expectedDoc;
        },
      }),
    });
    flows.push(update);
    await update.open({ kind: 'project-cp', stepId: collapse.id });
    expect(await settled(update)).toMatchObject({ phase: 'done', stepId: collapse.id });
    await settle(20);
    expect(source.read().held!.document.steps).toHaveLength(3);
    expect(source.read().held!.document.steps[1]).toMatchObject({ expect: childFingerprint });
    expect(session.store.getState().nodes.get(branch)).toMatchObject({ status: 'broken' });
    // The other branch remains in the document with its old expectation.
    source.set({ reader: withFoldCursor(source.read().reader!, source.read().held!.document, child) });
    await settle(20);
    expect(session.store.getState().nodes.get(child)).toMatchObject({ status: 'changed' });
  });

  it('says why a pattern that does not fold flat was refused', async () => {
    const { flow, source } = await setup();
    const bytes = new Uint8Array(readFileSync(resolve(FIXTURES, 'precrease/divergence-1.cp')));
    await flow.open({ kind: 'file', name: 'divergence-1.cp', source: foldImportFileSource('divergence-1.cp', bytes) });
    const state = await settled(flow);
    expect(state).toMatchObject({ phase: 'refused', refusal: { kind: 'engine' } });
    expect(source.commits).toEqual([]);
  });
});

describe.skipIf(!available)('Import starting sheet over the built bridge', () => {
  /** A FOLD file of `corners` as its border, with a crease across it no fold could make. */
  const outline = (corners: [number, number][]) =>
    JSON.stringify({
      vertices_coords: [...corners, [0.1, 0.1], [0.2, 0.9]],
      edges_vertices: [...corners.map((_, i) => [i, (i + 1) % corners.length]), [corners.length, corners.length + 1]],
      edges_assignment: [...corners.map(() => 'B'), 'M'],
    });

  it('takes a hexagon’s outline as a sheet the engine then starts a sequence on', async () => {
    const { session, source } = await setup();
    const adopted: FoldPaperShape[] = [];
    const flow = createFoldStartingSheetFlow({ session, adopt: (shape) => (adopted.push(shape), true) });
    const h = Math.sqrt(3) / 2;
    await flow.open({
      kind: 'file',
      name: 'hexagon.fold',
      source: { format: 'fold', text: outline([[-1, 0], [-0.5, -h], [0.5, -h], [1, 0], [0.5, h], [-0.5, h]]) },
    });
    await settle();
    expect(flow.store.getState()).toMatchObject({ phase: 'done', changed: true });
    const [shape] = adopted;
    expect(shape?.kind).toBe('polygon');
    if (shape?.kind !== 'polygon') throw new Error('a polygon sheet');
    expect(shape.points).toHaveLength(6);
    // The sheet replays: a sequence on it lands its flat sheet.
    const document = { ...createFoldSequence({ shape, startSide: 'front' }, 'Hexagon'), steps: [] };
    source.set({ held: { document, readOnlyRaw: null }, reader: withFoldCursor(initialFoldReaderState(document.id), document, null) });
    await settle(20);
    expect(session.store.getState().sheet.status).toBe('ok');
    flow.dispose();
  });

  it('refuses an L, which the engine folds no sheet of, before anything changes', async () => {
    const { session } = await setup();
    const adopt = vi.fn(() => true);
    const flow = createFoldStartingSheetFlow({ session, adopt });
    await flow.open({ kind: 'file', name: 'ell.fold', source: { format: 'fold', text: outline([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]) } });
    await settle();
    expect(flow.store.getState()).toMatchObject({ phase: 'refused', refusal: { code: 'sheet_not_convex' } });
    expect(adopt).not.toHaveBeenCalled();
    flow.dispose();
  });
});
