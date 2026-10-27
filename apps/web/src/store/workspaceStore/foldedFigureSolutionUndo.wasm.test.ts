import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OristudioCpEstimationOrder,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureRenderOptions,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedPaperScene,
  OristudioCpSelectedLines,
} from '../../engine/oristudioCpTypes';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import { foldedFigureGesture } from '../../cp-workspace/folded/foldedFigureGesture';
import { useSettingsStore } from '../settingsStore';

/**
 * "Another solution", undone, against the real CP kernel in Node.
 *
 * The step moves the figure's kernel session in place, and undo puts back only
 * the web entry. This pins that the undo takes the kernel back too, so what is
 * drawn or exported from it next is the solution the user returned to: the one
 * the fold first found, replayed. The store tests cover the pictures; this
 * covers the kernel's half, a backwards `fold_to_case`.
 *
 * The kernel stands in for the worker as an in-process client over the same
 * wasm calls. Skipped when the bridge has not been built; CI builds it first.
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

/** As the worker does: run at once, in call order, and answer in a later task. */
function answerLater<T>(call: () => T): Promise<T> {
  let outcome: { value: T } | { error: unknown };
  try {
    outcome = { value: call() };
  } catch (error) {
    outcome = { error };
  }
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      if ('error' in outcome) reject(outcome.error);
      else resolve(outcome.value);
    }, 0)
  );
}

/** The worker's API, the parts a fold and its undo reach. */
function inProcessClient(wasm: CpWasm) {
  return {
    operationDescriptors: () => answerLater(() => wasm.cp_operation_descriptors()),
    loadCp: (text: string, title = '') => answerLater(() => wasm.load_cp(text, title)),
    documentGeometry: (handle: number) => answerLater(() => wasm.document_geometry(handle)),
    summary: (handle: number) => answerLater(() => wasm.document_summary(handle)),
    sheetIndex: (handle: number) => answerLater(() => wasm.sheet_index(handle)),
    setSelectedLines: (handle: number, lines: OristudioCpSelectedLines) =>
      answerLater(() => wasm.set_selected_lines(handle, lines.ids, lines.values)),
    freeDocument: (handle: number) => answerLater(() => wasm.free_document(handle)),
    foldFigure: (
      handle: number,
      startingFaceId: number,
      order: OristudioCpEstimationOrder,
      model: OristudioCpFoldedFigureModel | undefined,
      selectedLineIds: number[],
      runId: number
    ) =>
      answerLater(() =>
        wasm.folded_figure_fold_selected(
          handle,
          selectedLineIds,
          startingFaceId,
          order,
          model ?? null,
          runId
        )
      ),
    foldedFigureRenderSnapshot: (
      handle: number,
      displayStyle?: OristudioCpFoldedFigureSnapshot['display_style'],
      options?: OristudioCpFoldedFigureRenderOptions
    ) =>
      answerLater(() =>
        wasm.folded_figure_render_snapshot(handle, displayStyle ?? null, options ?? null)
      ),
    setFoldedFigureModel: (handle: number, model: OristudioCpFoldedFigureModel) =>
      answerLater(() => wasm.folded_figure_set_model(handle, model)),
    foldFigureAnother: (handle: number, runId: number) =>
      answerLater(() => wasm.folded_figure_fold_another(handle, runId)),
    foldFigureToCase: (
      handle: number,
      objective: number,
      initialOrder: OristudioCpEstimationOrder,
      runId: number
    ) => answerLater(() => wasm.folded_figure_fold_to_case(handle, objective, initialOrder, runId)),
    freeFoldedFigure: (handle: number) => answerLater(() => wasm.free_folded_figure(handle)),
  };
}

/**
 * A 3 x 1 strip with valley folds at x = 1 and x = 2: both end flaps fold over
 * the middle and lie on each other, either one on top — two layer orderings.
 * The edges are split where the folds meet them, as folding needs.
 */
const TWO_FLAPS_CP = [
  '1 0 0 1 0',
  '1 1 0 2 0',
  '1 2 0 3 0',
  '1 3 0 3 1',
  '1 3 1 2 1',
  '1 2 1 1 1',
  '1 1 1 0 1',
  '1 0 1 0 0',
  '3 1 0 1 1',
  '3 2 0 2 1',
].join('\n');

describe.skipIf(!wasmAvailable)('undoing "Another solution" against the kernel', () => {
  let wasm: CpWasm;
  let store: typeof import('./store').useWorkspaceStore;

  beforeAll(async () => {
    wasm = await import('../../generated/oristudio-cp-wasm/oristudio_cp_wasm');
    wasm.initSync({ module: readFileSync(WASM) });
    kernel.client = inProcessClient(wasm);
    store = (await import('./store')).useWorkspaceStore;
  });

  beforeEach(async () => {
    // The pre-fold flat-foldability check is a separate kernel command and
    // beside the point here.
    useSettingsStore.setState({ foldWarningEnabled: false });
    const { loadOristudioCpDocumentFromText } = await import('./oristudioCpRuntime');
    const documentState = await loadOristudioCpDocumentFromText(TWO_FLAPS_CP, {
      format: 'cp',
      filename: 'two-flaps.cp',
    });
    store.setState({
      oristudioCpDocument: documentState,
      oristudioCpSelection: emptyOristudioCpSelection(),
      oristudioCpFoldedFigures: [],
      oristudioCpActiveFoldedFigureId: null,
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      // The Edit canvas, which is what makes undo the crease pattern's.
      activePanelId: 'crease-pattern',
    });
  });

  const state = () => store.getState();
  const figure = () => {
    const entry = state().oristudioCpFoldedFigures[0];
    if (!entry || entry.handle == null) throw new Error('expected a folded figure');
    return { ...entry, handle: entry.handle };
  };
  /** The solution the kernel session is on, read from the kernel. */
  const kernelSolution = () =>
    (wasm.folded_figure_snapshot(figure().handle) as OristudioCpFoldedFigureSnapshot)
      .current_fold_case;
  /**
   * The figure as the kernel would export it now. Its layer stacks name the
   * ordering; the canvas picture of this strip is the same for both.
   */
  const kernelScene = () =>
    wasm.folded_figure_paper_scene(figure().handle, undefined) as OristudioCpFoldedPaperScene;

  /** A verb as the toolbar runs it: one bracket, one undo entry. */
  const verb = (label: string, act: () => Promise<unknown>) =>
    foldedFigureGesture.run('verb', label, act);

  it('takes the kernel back to the solution undo returned to, and forward again on redo', async () => {
    const lineIds = state().oristudioCpDocument!.document.crease_pattern.line_segments.map(
      (_, index) => index + 1
    );
    await expect(
      verb('Fold model', () => state().foldOristudioCpDocument({ lineIds }))
    ).resolves.toBe(true);
    expect(figure().snapshot?.find_another_overlap_valid).toBe(true);
    const firstSolution = kernelScene();

    await verb('Show another solution', () => state().foldAnotherOristudioCpFigure(figure().id));
    expect(kernelSolution()).toBe(2);
    // The two orderings stack differently, or this test could not tell them apart.
    const secondSolution = kernelScene();
    expect(secondSolution).not.toEqual(firstSolution);

    await state().undo();
    await vi.waitFor(() => expect(kernelSolution()).toBe(1));
    expect(figure().snapshot?.current_fold_case).toBe(1);
    // Replayed from the start, the solution is the one the fold first found.
    expect(kernelScene()).toEqual(firstSolution);
    // And a restyle draws from the kernel without moving it.
    await state().setOristudioCpFoldedFigureDisplayStyle(figure().id, 'Transparent3');
    expect(kernelSolution()).toBe(1);

    await state().redo();
    await vi.waitFor(() => expect(kernelSolution()).toBe(2));
    expect(figure().snapshot?.current_fold_case).toBe(2);
    expect(kernelScene()).toEqual(secondSolution);
  });
});
