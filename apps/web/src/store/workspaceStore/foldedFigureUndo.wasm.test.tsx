import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useEffect, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OristudioCpCommandPayload,
  OristudioCpDocumentSnapshot,
  OristudioCpEstimationOrder,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureRenderOptions,
  OristudioCpLineSegment,
  OristudioCpSelectedLines,
} from '../../engine/oristudioCpTypes';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import type { FoldedFigureAuxStrokes } from '../../cp-workspace/adapters/cpFoldedToScene';
import { endOpenCanvasSessions } from '../../cp-workspace/canvasObjects/canvasSessions';
import { cpAuxLinesKey } from '../../cp-workspace/folded/foldedAuxSource';
import {
  foldedFigureHandleRefCount,
  resetFoldedFigureHandles,
} from '../../cp-workspace/folded/foldedFigureHandles';
import { foldedFigureGesture } from '../../cp-workspace/folded/foldedFigureGesture';
import {
  deleteFoldedFigure,
  setFoldedFigurePlacementAsEntry,
} from '../../cp-workspace/folded/foldedFigureVerbs';
import { pendingFoldedModelWrites } from '../../cp-workspace/folded/foldedModelWriteQueue';
import {
  resetFoldedFlatAuxFetches,
  useFoldedFlatAux,
} from '../../cp-workspace/folded/useFoldedFlatAux';
import i18n from '../../i18n';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { useSettingsStore } from '../settingsStore';

/**
 * A folded figure brought back by undo comes back with a kernel handle the
 * kernel still holds (ORI-STUDIO-M), against the real CP kernel in Node.
 *
 * The handle is how a flat figure draws the document's aux lines — the canvas
 * asks the kernel for the figure's paper scene on it — and how every verb on
 * the figure reaches the kernel. `foldedFigureHandles` counts who holds each
 * one, the live list and every undo entry with the figure in it, and frees the
 * kernel's slot when the last of them lets go. Delete, refold, undo and redo
 * all move figures between those holders, and the count has to follow, or the
 * slot is freed under a figure that is still on the canvas: its aux lines go
 * missing without a word, and the canvas reports the kernel's answer,
 * `invalid folded figure handle`.
 *
 * The kernel stands in for the worker as an in-process client over the same
 * wasm calls, as in `cpSelectionCommands.wasm.test.ts`, and the canvas's aux
 * fetch is the real hook. Skipped when the bridge has not been built; CI
 * builds it first.
 */
const WASM = resolve(process.cwd(), 'src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm');
const wasmAvailable = existsSync(WASM);
type CpWasm = typeof import('../../generated/oristudio-cp-wasm/oristudio_cp_wasm');

const kernel = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('../../engines/engineHost', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engines/engineHost')>();
  return {
    ...actual,
    connectEngine: async () => kernel.client,
    isEngineConnected: () => kernel.client !== null,
  };
});

/** What the canvas's aux fetch reported, as Sentry would have received it. */
const reported = vi.hoisted(() => [] as Array<{ error: unknown; surface?: string }>);

vi.mock('../../monitoring', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../monitoring')>()),
  reportError: (error: unknown, context: { surface?: string } = {}) => {
    reported.push({ error, surface: context.surface });
  },
}));

// The hook renders on the scheduler, as it does in the app; nothing here is
// wrapped in `act`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

/** Calls the in-process kernel has run and not yet answered. */
let unanswered = 0;

/**
 * As the worker does: a call reaches the kernel the moment it is made, so calls
 * run in the order they are made, and its answer arrives in a later task.
 */
function answerLater<T>(call: () => T): Promise<T> {
  let outcome: { value: T } | { error: unknown };
  try {
    outcome = { value: call() };
  } catch (error) {
    outcome = { error };
  }
  unanswered += 1;
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      unanswered -= 1;
      if ('error' in outcome) reject(outcome.error);
      else resolve(outcome.value);
    }, 0)
  );
}

/** The worker's API, the parts a fold, its verbs and its undo reach, over the worker's wasm calls. */
function inProcessClient(wasm: CpWasm) {
  return {
    operationDescriptors: () => answerLater(() => wasm.cp_operation_descriptors()),
    loadDocument: (document: OristudioCpDocumentSnapshot) =>
      answerLater(() => wasm.load_document(document)),
    restoreDocument: (handle: number, document: OristudioCpDocumentSnapshot) =>
      answerLater(() => wasm.restore_document(handle, document)),
    restoreFromCompact: (handle: number, geometry: CpGeometryTransport) =>
      answerLater(() => wasm.restore_from_compact(handle, geometry as unknown as object)),
    documentGeometry: (handle: number) => answerLater(() => wasm.document_geometry(handle)),
    summary: (handle: number) => answerLater(() => wasm.document_summary(handle)),
    sheetIndex: (handle: number) => answerLater(() => wasm.sheet_index(handle)),
    executeCommand: (
      handle: number,
      operationId: OristudioCpOperationId,
      payload: OristudioCpCommandPayload = {}
    ) => answerLater(() => wasm.execute_cp_command(handle, operationId, payload)),
    executeSelectionCommand: (
      handle: number,
      operationId: OristudioCpOperationId,
      payload: OristudioCpCommandPayload = {}
    ) => answerLater(() => wasm.execute_cp_selection_command(handle, operationId, payload)),
    setSelectedLines: (handle: number, lines: OristudioCpSelectedLines) =>
      answerLater(() => wasm.set_selected_lines(handle, lines.ids, lines.values)),
    freeDocument: (handle: number) => answerLater(() => wasm.free_document(handle)),
    foldFigure: (
      handle: number,
      startingFaceId = 1,
      order: OristudioCpEstimationOrder = 'Order5',
      model?: OristudioCpFoldedFigureModel,
      selectedLineIds: number[] = [],
      runId = 0
    ) =>
      answerLater(() =>
        selectedLineIds.length > 0
          ? wasm.folded_figure_fold_selected(
              handle,
              selectedLineIds,
              startingFaceId,
              order,
              model ?? null,
              runId
            )
          : wasm.folded_figure_fold(handle, startingFaceId, order, model ?? null, runId)
      ),
    foldedFigureRenderSnapshot: (
      handle: number,
      displayStyle?: OristudioCpFoldedFigureDisplayStyle,
      options?: OristudioCpFoldedFigureRenderOptions
    ) =>
      answerLater(() =>
        wasm.folded_figure_render_snapshot(handle, displayStyle ?? null, options ?? null)
      ),
    foldedFigurePaperScene: (handle: number, documentHandle?: number | null) =>
      answerLater(() => wasm.folded_figure_paper_scene(handle, documentHandle ?? undefined)),
    setFoldedFigureModel: (handle: number, model: OristudioCpFoldedFigureModel) =>
      answerLater(() => wasm.folded_figure_set_model(handle, model)),
    freeFoldedFigure: (handle: number) => answerLater(() => wasm.free_folded_figure(handle)),
  };
}

function segment(
  a: OristudioCpLineSegment['a'],
  b: OristudioCpLineSegment['b'],
  color: string
): OristudioCpLineSegment {
  return {
    a,
    b,
    active: 'Inactive0',
    color,
    selected: 0,
    customized: 0,
    customized_color: { red: 100, green: 200, blue: 200 },
  };
}

/**
 * A square folded in half along a valley, with an aux line on the half that
 * moves. The sides the valley ends on are split there, so the creases already
 * meet where they cross.
 */
function halfFoldWithAuxLine(): OristudioCpDocumentSnapshot {
  const document = createStarterOristudioCpDocument('Half fold');
  document.crease_pattern.line_segments = [
    segment({ x: -200, y: -200 }, { x: 200, y: -200 }, 'Black0'),
    segment({ x: 200, y: -200 }, { x: 200, y: 0 }, 'Black0'),
    segment({ x: 200, y: 0 }, { x: 200, y: 200 }, 'Black0'),
    segment({ x: 200, y: 200 }, { x: -200, y: 200 }, 'Black0'),
    segment({ x: -200, y: 200 }, { x: -200, y: 0 }, 'Black0'),
    segment({ x: -200, y: 0 }, { x: -200, y: -200 }, 'Black0'),
    segment({ x: -200, y: 0 }, { x: 200, y: 0 }, 'Blue2'),
    segment({ x: -100, y: 100 }, { x: 100, y: 100 }, 'Cyan3'),
  ];
  return document;
}

let reader: ((figure: OristudioCpFoldedFigureEntry) => FoldedFigureAuxStrokes | null) | null =
  null;

/** The canvas's half of it: the live figures' aux strokes, fetched as the canvas fetches them. */
function AuxProbe({ store }: { store: typeof import('./store').useWorkspaceStore }): null {
  const figures = store((state) => state.oristudioCpFoldedFigures);
  const cpDocument = store((state) => state.oristudioCpDocument);
  const source = useMemo(
    () => ({
      documentHandle: cpDocument?.handle ?? null,
      auxKey: cpAuxLinesKey(cpDocument?.geometry),
    }),
    [cpDocument]
  );
  const read = useFoldedFlatAux(figures, source);
  useEffect(() => {
    reader = read;
  });
  return null;
}

describe.skipIf(!wasmAvailable)('a folded figure through delete, refold, undo and redo', () => {
  let wasm: CpWasm;
  let store: typeof import('./store').useWorkspaceStore;
  let runtime: typeof import('./oristudioCpRuntime');
  let root: Root | null = null;
  /** Every handle a figure has had, so one nothing holds can be checked freed. */
  const seen = new Set<number>();

  beforeAll(async () => {
    wasm = await import('../../generated/oristudio-cp-wasm/oristudio_cp_wasm');
    wasm.initSync({ module: readFileSync(WASM) });
    kernel.client = inProcessClient(wasm);
    store = (await import('./store')).useWorkspaceStore;
    runtime = await import('./oristudioCpRuntime');
  });

  beforeEach(async () => {
    // Off, so a fold never stops on Oriedita's "continue to fold?" dialog.
    useSettingsStore.getState().setFoldWarningEnabled(false);
    await resetFoldedFigureHandles();
    resetFoldedFlatAuxFetches();
    reported.length = 0;
    seen.clear();
    const documentState = await runtime.restoreOristudioCpDocument(halfFoldWithAuxLine(), {
      format: 'cp',
      filename: 'half-fold.cp',
      path: null,
    });
    store.setState({
      oristudioCpDocument: documentState,
      oristudioCpSelection: emptyOristudioCpSelection(),
      oristudioCpFoldedFigures: [],
      oristudioCpActiveFoldedFigureId: null,
      oristudioCpFocusedFoldedFigureId: null,
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      // The Edit canvas, which is what makes undo the crease pattern's.
      activePanelId: 'crease-pattern',
      dirty: false,
    });
    expect(store.getState().activeEditingContext).toBe('crease-pattern');
    root = createRoot(document.body.appendChild(document.createElement('div')));
    root.render(<AuxProbe store={store} />);
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    reader = null;
  });

  const state = () => store.getState();

  /** Let every call in flight land, and every model write it set off. */
  async function settle(): Promise<void> {
    for (let round = 0; round < 100; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await pendingFoldedModelWrites();
      if (unanswered === 0) {
        for (const figure of state().oristudioCpFoldedFigures) {
          if (figure.handle != null) seen.add(figure.handle);
        }
        return;
      }
    }
    throw new Error('the kernel never went quiet');
  }

  /** Each verb as the toolbar runs it: one bracket, one undo step. */
  async function fold(): Promise<string> {
    const before = new Set(state().oristudioCpFoldedFigures.map((figure) => figure.id));
    const lineIds = state().oristudioCpDocument!.document.crease_pattern.line_segments.map(
      (_, index) => index + 1
    );
    await foldedFigureGesture.run('verb', 'Fold model', () =>
      state().foldOristudioCpDocument({ startingFaceId: 1, lineIds })
    );
    await settle();
    const folded = state().oristudioCpFoldedFigures.find((figure) => !before.has(figure.id));
    if (!folded || folded.status !== 'ready') throw new Error('the fold produced no figure');
    return folded.id;
  }

  async function rotate(id: string): Promise<void> {
    await setFoldedFigurePlacementAsEntry(id, { rotation: 90 }, 'Rotate folded form');
    await settle();
  }

  async function remove(id: string): Promise<void> {
    await deleteFoldedFigure(id, i18n.t);
    await settle();
  }

  async function refold(id: string): Promise<void> {
    await foldedFigureGesture.run('verb', 'Refold folded model', () =>
      state().refoldOristudioCpFoldedFigure(id)
    );
    await settle();
  }

  /** A crease edit, whose entry holds the document: the valley made a mountain. */
  async function editCreases(): Promise<void> {
    await expect(
      state().executeOristudioCpCommand('CreaseMakeMountain', { line_ids: [7] })
    ).resolves.toBe(true);
    await settle();
  }

  /** A box select over the whole sheet, whose entry holds only the lines it replaced. */
  async function selectAll(): Promise<void> {
    await expect(
      state().executeOristudioCpCommand('CreaseSelect', {
        points: [
          { x: -250, y: -250 },
          { x: 250, y: 250 },
        ],
        replace_selection: true,
      })
    ).resolves.toBe(true);
    await settle();
  }

  /** As Edit ▸ Undo: an open canvas edit ends first. */
  async function undo(): Promise<void> {
    endOpenCanvasSessions('history');
    await state().undo();
    await settle();
  }

  async function redo(): Promise<void> {
    endOpenCanvasSessions('history');
    await state().redo();
    await settle();
  }

  function liveFigure(id: string): OristudioCpFoldedFigureEntry {
    const figure = state().oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
    if (!figure) throw new Error(`figure ${id} is not on the canvas`);
    return figure;
  }

  function kernelHolds(handle: number): boolean {
    try {
      wasm.folded_figure_snapshot(handle);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The ledger and the kernel agree: a handle is counted once for the live
   * list and once for each undo entry holding a figure with it, the kernel
   * holds every one of those, and has freed every handle nothing holds.
   */
  function expectLedgerToMatchKernel(): void {
    const holders = new Map<number, number>();
    const hold = (figures: readonly OristudioCpFoldedFigureEntry[]) => {
      for (const figure of figures) {
        if (figure.handle != null) holders.set(figure.handle, (holders.get(figure.handle) ?? 0) + 1);
      }
    };
    hold(state().oristudioCpFoldedFigures);
    for (const entry of [...state().oristudioCpHistoryPast, ...state().oristudioCpHistoryFuture]) {
      hold(entry.foldedFigures);
    }
    for (const [handle, count] of holders) {
      expect(foldedFigureHandleRefCount(handle), `references to handle ${handle}`).toBe(count);
      expect(kernelHolds(handle), `the kernel's slot for handle ${handle}`).toBe(true);
    }
    for (const handle of seen) {
      if (!holders.has(handle)) {
        expect(kernelHolds(handle), `handle ${handle}, which nothing holds`).toBe(false);
      }
    }
  }

  /**
   * The aux strokes the canvas draws over figure `id`, once its paper scene has
   * landed — or what it reported instead, which is what reached Sentry.
   */
  async function auxStrokes(id: string): Promise<FoldedFigureAuxStrokes | null> {
    await vi
      .waitFor(
        () => {
          if (reported.length > 0) return;
          expect(reader?.(liveFigure(id))?.segments.length ?? 0).toBeGreaterThan(0);
        },
        { timeout: 4000, interval: 20 }
      )
      .catch(() => undefined);
    expect(reported.map(({ error, surface }) => ({ error, surface }))).toEqual([]);
    return reader?.(liveFigure(id)) ?? null;
  }

  it('draws the aux lines of a figure folded from them', async () => {
    const id = await fold();

    expect((await auxStrokes(id))?.segments.length).toBeGreaterThan(0);
    expectLedgerToMatchKernel();
  });

  it('brings a deleted figure back with its aux lines', async () => {
    const id = await fold();
    await remove(id);
    expectLedgerToMatchKernel();

    await undo();

    expect((await auxStrokes(id))?.segments.length).toBeGreaterThan(0);
    expectLedgerToMatchKernel();
  });

  it('keeps a figure brought back by undo through the undos after it', async () => {
    // The trail in the reports: an edit to the figure, a delete, then a run of
    // undos.
    const id = await fold();
    await rotate(id);
    await remove(id);

    await undo();
    await undo();

    expect(liveFigure(id).placement.rotation).toBe(0);
    expect((await auxStrokes(id))?.segments.length).toBeGreaterThan(0);
    expectLedgerToMatchKernel();
  });

  it('brings back the figure a refold replaced', async () => {
    const id = await fold();
    const folded = liveFigure(id).handle;
    await refold(id);
    expect(liveFigure(id).handle).not.toBe(folded);

    await undo();

    expect(liveFigure(id).handle).toBe(folded);
    expect((await auxStrokes(id))?.segments.length).toBeGreaterThan(0);
    expectLedgerToMatchKernel();
  });

  it('keeps a figure through crease edits, selections and their undos', async () => {
    // An entry of each kind holds the figures beside it: an overlay step, a
    // crease edit holding the document, a selection holding its lines.
    const id = await fold();
    await editCreases();
    await selectAll();
    await remove(id);
    expectLedgerToMatchKernel();

    for (const step of [undo, undo, undo, redo, redo, redo, undo, undo, undo]) {
      await step();
      expectLedgerToMatchKernel();
    }

    expect(state().oristudioCpDocument?.document.crease_pattern.line_segments[6]?.color).toBe(
      'Blue2'
    );
    expect((await auxStrokes(id))?.segments.length).toBeGreaterThan(0);
  });

  it('frees a figure once no undo can reach it, and not before', async () => {
    const kept = await fold();
    const dropped = await fold();
    const droppedHandle = liveFigure(dropped).handle!;
    await rotate(kept);
    await remove(dropped);
    expectLedgerToMatchKernel();

    for (const step of [undo, undo, undo, redo, redo, undo, redo, redo]) {
      await step();
      expectLedgerToMatchKernel();
    }

    // Back past the second fold, so only redo holds that figure; then a new
    // step, which drops the redo stack and with it the last holder.
    for (const step of [undo, undo, undo]) await step();
    expect(state().oristudioCpFoldedFigures.map((figure) => figure.id)).toEqual([kept]);
    expect(kernelHolds(droppedHandle)).toBe(true);
    await rotate(kept);

    expect(kernelHolds(droppedHandle)).toBe(false);
    expectLedgerToMatchKernel();
    expect((await auxStrokes(kept))?.segments.length).toBeGreaterThan(0);
  });
});
