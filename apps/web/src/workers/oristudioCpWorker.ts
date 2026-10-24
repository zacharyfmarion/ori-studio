import { expose, transfer } from 'comlink';
import init, {
  cp_operation_descriptors,
  cp_set_cancel_buffer,
  document_geometry,
  sheet_index,
  document_snapshot,
  document_summary,
  execute_cp_command,
  execute_cp_selection_command,
  export_cp,
  export_fold,
  export_fold_lines,
  export_fold_file,
  export_orh,
  export_share_link,
  load_share_link,
  export_ori,
  folded_figure_3d_aux_lines,
  folded_figure_3d_duplicate,
  folded_figure_3d_fold_another,
  folded_figure_digest,
  folded_figure_duplicate,
  folded_figure_fold,
  folded_figure_fold_3d,
  folded_figure_fold_selected,
  folded_figure_fold_another,
  folded_figure_fold_to_case,
  folded_figure_fold_with_order,
  folded_figure_paper_scene,
  folded_figure_source,
  fold_source_of_selection,
  folded_figure_render_snapshot,
  folded_figure_set_model,
  folded_figure_snapshot,
  free_folded_figure,
  free_document,
  load_cp,
  load_document,
  load_fold,
  load_fold_file,
  load_orh,
  load_ori,
  import_add,
  append_disjoint,
  insert_line_segments,
  deselect_all,
  preview_cp_command,
  replace_line_segments,
  restore_document,
  restore_from_compact,
  set_selected_lines,
  set_texts,
  place_circles,
} from '../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import type { CpGeometryTransport } from '../engine/oristudioCpGeometry';
import {
  sheetIndexTransferables,
  type CpSheetIndexTransport,
} from '../engine/oristudioCpSheetIndex';
import type {
  OristudioCpCommandPayload,
  OristudioCpCommandPreview,
  OristudioCpCommandResult,
  OristudioCpDocumentSnapshot,
  OristudioCpDocumentSummary,
  OristudioCpEstimationOrder,
  OristudioCpFold3dFoldResult,
  OristudioCpFold3dStepResult,
  OristudioCpFolded3dAuxLines,
  OristudioCpFoldedFigureBatchResult,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureRenderOptions,
  OristudioCpFoldedFigureResult,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldSource,
  OristudioCpFoldWithOrderResult,
  OristudioCpLineSegment,
  OristudioCpOperationDescriptor,
  OristudioCpSelectedLines,
  OristudioCpSelectionCommandResult,
} from '../engine/oristudioCpTypes';
import type { OristudioCpOperationId } from '../lib/oristudioCpCommands';
import type { WasmErrorEnvelope } from '../engine/types';
import type { FlatText } from '../cp-workspace/annotations/annotation';
import type { SendToEditCircle } from '../designKinds/types';

let ready: Promise<void> | null = null;

/**
 * Populate the kernel's text elements from flattened rich-text boxes, run an
 * export, then clear them again. Rich text lives web-side; the kernel `texts`
 * vec is only the Oriedita interchange representation, so it stays empty during a
 * session and is loaded transiently around an export. Synchronous — all three
 * wasm calls run inside one `call()`.
 */
function exportWithTexts(handle: number, texts: FlatText[], exporter: () => string): string {
  const coords = new Float64Array(texts.length * 2);
  for (let i = 0; i < texts.length; i += 1) {
    coords[i * 2] = texts[i].x;
    coords[i * 2 + 1] = texts[i].y;
  }
  set_texts(
    handle,
    coords,
    texts.map((entry) => entry.text)
  );
  try {
    return exporter();
  } finally {
    set_texts(handle, new Float64Array(0), []);
  }
}

async function ensureReady() {
  ready ??= init().then(() => undefined);
  await ready;
}

function normalizeError(error: unknown): WasmErrorEnvelope {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return error as WasmErrorEnvelope;
  }
  return {
    code: 'oristudio_cp_wasm_error',
    message: error instanceof Error ? error.message : String(error),
  };
}

function geometryTransferables(geometry: CpGeometryTransport): Transferable[] {
  // Every typed array is a distinct wasm-allocated (non-shared) ArrayBuffer, so
  // their buffers are independent and safe to transfer.
  return [
    geometry.segEndpoints,
    geometry.segAttr,
    geometry.segCustomColor,
    geometry.auxEndpoints,
    geometry.auxAttr,
    geometry.auxCustomColor,
    geometry.pointCoords,
    geometry.circleData,
    geometry.circleAttr,
    geometry.circleCustomColor,
  ].map((array) => array.buffer as ArrayBuffer);
}

function selectedLinesTransferables(lines: OristudioCpSelectedLines): Transferable[] {
  // Each array is copied out of wasm memory into its own buffer.
  return [lines.ids.buffer as ArrayBuffer, lines.values.buffer as ArrayBuffer];
}

async function call<T>(fn: () => T): Promise<T> {
  await ensureReady();
  try {
    return fn();
  } catch (error) {
    throw normalizeError(error);
  }
}

const api = {
  /**
   * Adopt the main thread's shared cancel buffer.
   *
   * The buffer crosses as a `SharedArrayBuffer`, so structured clone shares the
   * memory rather than copying it — which is the only reason a `Atomics.store`
   * on the main thread is visible to a fold that has this thread blocked. Called
   * once per connect by the `oristudio-cp` connector, never per fold.
   */
  async setCancelBuffer(sharedBuffer: SharedArrayBuffer): Promise<void> {
    return call(() => cp_set_cancel_buffer(new Int32Array(sharedBuffer)));
  },
  async operationDescriptors(): Promise<OristudioCpOperationDescriptor[]> {
    return call(() => cp_operation_descriptors() as OristudioCpOperationDescriptor[]);
  },
  async loadCp(text: string, title = ''): Promise<number> {
    return call(() => load_cp(text, title));
  },
  async loadFold(text: string, title = ''): Promise<number> {
    return call(() => load_fold(text, title));
  },
  async loadFoldFile(text: string): Promise<number> {
    return call(() => load_fold_file(text));
  },
  async loadOri(text: string, acceptUnknownVersion = false): Promise<number> {
    return call(() => load_ori(text, acceptUnknownVersion));
  },
  async loadOrh(text: string): Promise<number> {
    return call(() => load_orh(text));
  },
  async loadDocument(document: OristudioCpDocumentSnapshot): Promise<number> {
    return call(() => load_document(document));
  },
  async restoreDocument(handle: number, document: OristudioCpDocumentSnapshot): Promise<void> {
    return call(() => restore_document(handle, document));
  },
  async snapshot(handle: number): Promise<OristudioCpDocumentSnapshot> {
    return call(() => document_snapshot(handle) as OristudioCpDocumentSnapshot);
  },
  async documentGeometry(handle: number): Promise<CpGeometryTransport> {
    const geometry = await call(() => document_geometry(handle) as CpGeometryTransport);
    // Move the buffers to the main thread instead of structured-cloning them.
    return transfer(geometry, geometryTransferables(geometry));
  },
  async sheetIndex(handle: number): Promise<CpSheetIndexTransport> {
    const index = await call(() => sheet_index(handle) as CpSheetIndexTransport);
    return transfer(index, sheetIndexTransferables(index));
  },
  /**
   * Undo and redo. The caller posts `geometry` as a copy, never transferred:
   * it is an undo entry's, which may be restored again.
   */
  async restoreFromCompact(handle: number, geometry: CpGeometryTransport): Promise<void> {
    return call(() => restore_from_compact(handle, geometry as unknown as object));
  },
  async summary(handle: number): Promise<OristudioCpDocumentSummary> {
    return call(() => document_summary(handle) as OristudioCpDocumentSummary);
  },
  async executeCommand(
    handle: number,
    operationId: OristudioCpOperationId,
    payload: OristudioCpCommandPayload = {}
  ): Promise<OristudioCpCommandResult> {
    return call(() => execute_cp_command(handle, operationId, payload) as OristudioCpCommandResult);
  },
  async previewCommand(
    handle: number,
    operationId: OristudioCpOperationId,
    payload: OristudioCpCommandPayload = {}
  ): Promise<OristudioCpCommandPreview> {
    return call(() => preview_cp_command(handle, operationId, payload) as OristudioCpCommandPreview);
  },
  /**
   * A command that changes only which lines are selected, answered with the
   * selected lines before and after it rather than with a new document.
   */
  async executeSelectionCommand(
    handle: number,
    operationId: OristudioCpOperationId,
    payload: OristudioCpCommandPayload = {}
  ): Promise<OristudioCpSelectionCommandResult> {
    const outcome = await call(
      () =>
        execute_cp_selection_command(handle, operationId, payload) as OristudioCpSelectionCommandResult
    );
    return transfer(outcome, [
      ...selectedLinesTransferables(outcome.before),
      ...selectedLinesTransferables(outcome.after),
    ]);
  },
  /** Make `lines` the selected lines exactly; answers with the ones replaced. */
  async setSelectedLines(
    handle: number,
    lines: OristudioCpSelectedLines
  ): Promise<OristudioCpSelectedLines> {
    const replaced = await call(
      () => set_selected_lines(handle, lines.ids, lines.values) as OristudioCpSelectedLines
    );
    return transfer(replaced, selectedLinesTransferables(replaced));
  },
  async insertLineSegments(
    handle: number,
    segments: OristudioCpLineSegment[]
  ): Promise<number> {
    return call(() => insert_line_segments(handle, segments));
  },
  async deselectAll(handle: number): Promise<number> {
    return call(() => deselect_all(handle));
  },
  async appendDisjoint(handle: number, parts: CpGeometryTransport[], replaceStarter: boolean): Promise<[number, number][]> {
    return call(() => append_disjoint(handle, parts, replaceStarter) as [number, number][]);
  },
  async importAdd(handle: number, importedHandle: number): Promise<number> {
    return call(() => import_add(handle, importedHandle));
  },
  async replaceLineSegments(
    handle: number,
    lineIds: number[],
    segments: OristudioCpLineSegment[]
  ): Promise<number> {
    return call(() => replace_line_segments(handle, lineIds, segments));
  },
  /**
   * `runId` names the cancellable run this fold belongs to; 0 means "not
   * cancellable", which is what every caller meant before run ids existed. Every
   * search entry point below carries one — the duplicate ones do not, because
   * they copy a figure rather than fold it.
   */
  async foldFigure(
    handle: number,
    startingFaceId = 1,
    order: OristudioCpEstimationOrder = 'Order5',
    model?: OristudioCpFoldedFigureModel,
    selectedLineIds: number[] = [],
    runId = 0
  ): Promise<OristudioCpFoldedFigureResult> {
    return call(
      () =>
        selectedLineIds.length > 0
          ? (folded_figure_fold_selected(
              handle,
              selectedLineIds,
              startingFaceId,
              order,
              model ?? null,
              runId
            ) as OristudioCpFoldedFigureResult)
          : (folded_figure_fold(
              handle,
              startingFaceId,
              order,
              model ?? null,
              runId
            ) as OristudioCpFoldedFigureResult)
    );
  },
  async foldedFigureSnapshot(handle: number): Promise<OristudioCpFoldedFigureSnapshot> {
    return call(() => folded_figure_snapshot(handle) as OristudioCpFoldedFigureSnapshot);
  },
  async foldedFigureRenderSnapshot(
    handle: number,
    displayStyle?: OristudioCpFoldedFigureSnapshot['display_style'],
    options?: OristudioCpFoldedFigureRenderOptions
  ): Promise<OristudioCpFoldedRenderSnapshot | null> {
    return call(
      () =>
        folded_figure_render_snapshot(
          handle,
          displayStyle ?? null,
          options ?? null
        ) as OristudioCpFoldedRenderSnapshot | null
    );
  },
  /**
   * The flat figure's paper scene. With `documentHandle`, its aux lines are
   * that document's as they stand now; without, the ones captured at the fold.
   */
  async foldedFigurePaperScene(
    handle: number,
    documentHandle?: number | null
  ): Promise<OristudioCpFoldedPaperScene | null> {
    return call(
      () =>
        folded_figure_paper_scene(handle, documentHandle ?? undefined) as
          OristudioCpFoldedPaperScene | null
    );
  },
  async setFoldedFigureModel(
    handle: number,
    model: OristudioCpFoldedFigureModel
  ): Promise<OristudioCpFoldedFigureSnapshot> {
    return call(() => folded_figure_set_model(handle, model) as OristudioCpFoldedFigureSnapshot);
  },
  async duplicateFoldedFigure(handle: number): Promise<OristudioCpFoldedFigureResult> {
    return call(() => folded_figure_duplicate(handle) as OristudioCpFoldedFigureResult);
  },
  async foldFigureAnother(
    handle: number,
    runId = 0
  ): Promise<OristudioCpFoldedFigureSnapshot> {
    return call(() => folded_figure_fold_another(handle, runId) as OristudioCpFoldedFigureSnapshot);
  },
  async foldFigureToCase(
    handle: number,
    objective: number,
    initialOrder: OristudioCpEstimationOrder = 'Order5',
    runId = 0
  ): Promise<OristudioCpFoldedFigureBatchResult> {
    return call(
      () =>
        folded_figure_fold_to_case(
          handle,
          objective,
          initialOrder,
          runId
        ) as OristudioCpFoldedFigureBatchResult
    );
  },
  /**
   * What the flat figure was folded from, for the Layer order dialog. Its aux
   * lines are `documentHandle`'s as they stand now, or, without one, the ones
   * captured at the fold — the paper scene's rule.
   */
  async foldedFigureSource(
    handle: number,
    documentHandle?: number | null
  ): Promise<OristudioCpFoldSource> {
    return call(
      () => folded_figure_source(handle, documentHandle ?? undefined) as OristudioCpFoldSource
    );
  },
  /** What folding the selection would fold, as a source, before any figure exists. */
  async foldSourceOfSelection(
    handle: number,
    selectedLineIds: number[],
    startingFaceId = 1
  ): Promise<OristudioCpFoldSource> {
    return call(
      () => fold_source_of_selection(handle, selectedLineIds, startingFaceId) as OristudioCpFoldSource
    );
  },
  /**
   * Fold `source` again with `relations` given — `[upper, lower]` face pairs,
   * flat — into a new handle. Resolves to a refusal, with no handle, when the
   * order cannot be drawn on the source's creases.
   */
  async foldFigureWithOrder(
    source: OristudioCpFoldSource,
    relations: Uint32Array,
    model?: OristudioCpFoldedFigureModel,
    runId = 0
  ): Promise<OristudioCpFoldWithOrderResult> {
    return call(
      () =>
        folded_figure_fold_with_order(
          source,
          relations,
          model ?? null,
          runId
        ) as OristudioCpFoldWithOrderResult
    );
  },
  /** The digest of the flat figure's faces, as its source carries it. */
  async foldedFigureDigest(handle: number): Promise<string> {
    return call(() => folded_figure_digest(handle));
  },
  /**
   * Fold the selected creases in 3D.
   *
   * Resolves to `{ status: 'refused', refusal }` rather than rejecting when the
   * crease pattern has no 3D folded state: a refusal is an answer, it carries
   * structured data the `{ code, message }` envelope cannot, and it must not
   * land in a catch path that destroys the draft figure.
   */
  async fold3d(
    handle: number,
    selectedLineIds: number[],
    startingFaceId = 1,
    model?: OristudioCpFoldedFigureModel,
    runId = 0
  ): Promise<OristudioCpFold3dFoldResult> {
    return call(
      () =>
        folded_figure_fold_3d(
          handle,
          selectedLineIds,
          startingFaceId,
          model ?? null,
          runId
        ) as OristudioCpFold3dFoldResult
    );
  },
  async fold3dAnother(handle: number, runId = 0): Promise<OristudioCpFold3dStepResult> {
    return call(() => folded_figure_3d_fold_another(handle, runId) as OristudioCpFold3dStepResult);
  },
  async duplicateFolded3dFigure(handle: number): Promise<OristudioCpFold3dFoldResult> {
    return call(() => folded_figure_3d_duplicate(handle) as OristudioCpFold3dFoldResult);
  },
  /** The document's aux lines as they stand now, carried onto the 3D figure. */
  async folded3dAuxLines(
    handle: number,
    documentHandle: number
  ): Promise<OristudioCpFolded3dAuxLines> {
    return call(
      () => folded_figure_3d_aux_lines(handle, documentHandle) as OristudioCpFolded3dAuxLines
    );
  },
  async freeFoldedFigure(handle: number): Promise<void> {
    return call(() => free_folded_figure(handle));
  },
  async exportCp(handle: number): Promise<string> {
    return call(() => export_cp(handle));
  },
  async exportFold(handle: number, texts: FlatText[] = []): Promise<string> {
    return call(() => exportWithTexts(handle, texts, () => export_fold(handle)));
  },
  /** Some lines (1-based ids), one sheet's, as compact FOLD JSON: faces only where they meet only at their ends. */
  async exportFoldLines(handle: number, lineIds: readonly number[]): Promise<string> {
    return call(() => export_fold_lines(handle, [...lineIds]));
  },
  /** `foldedHandles` names the 3D figures to write as `foldedForm` frames. */
  async exportFoldFile(
    handle: number,
    texts: FlatText[] = [],
    foldedHandles: number[] = []
  ): Promise<string> {
    return call(() =>
      exportWithTexts(handle, texts, () =>
        export_fold_file(handle, new Uint32Array(foldedHandles))
      )
    );
  },
  async exportOri(handle: number, texts: FlatText[] = []): Promise<string> {
    return call(() => exportWithTexts(handle, texts, () => export_ori(handle)));
  },
  async exportOrh(handle: number, texts: FlatText[] = []): Promise<string> {
    return call(() => exportWithTexts(handle, texts, () => export_orh(handle)));
  },
  async exportShareLink(handle: number): Promise<string> {
    return call(() => export_share_link(handle));
  },
  async loadShareLink(payload: string): Promise<number> {
    return call(() => load_share_link(payload));
  },
  async setTexts(handle: number, texts: FlatText[]): Promise<void> {
    const coords = new Float64Array(texts.length * 2);
    for (let i = 0; i < texts.length; i += 1) {
      coords[i * 2] = texts[i].x;
      coords[i * 2 + 1] = texts[i].y;
    }
    return call(() =>
      set_texts(
        handle,
        coords,
        texts.map((entry) => entry.text)
      )
    );
  },
  async placeCircles(
    handle: number,
    sourceBounds: readonly [number, number, number, number],
    circles: readonly SendToEditCircle[]
  ): Promise<void> {
    const coords = new Float64Array(circles.length * 2);
    const radii = new Float64Array(circles.length);
    for (let i = 0; i < circles.length; i += 1) {
      coords[i * 2] = circles[i].cx;
      coords[i * 2 + 1] = circles[i].cy;
      radii[i] = circles[i].r;
    }
    return call(() =>
      place_circles(handle, Float64Array.from(sourceBounds), coords, radii)
    );
  },
  async freeDocument(handle: number): Promise<void> {
    return call(() => free_document(handle));
  },
};

export type OristudioCpWorkerApi = typeof api;

expose(api);
