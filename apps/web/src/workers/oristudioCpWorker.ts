import { expose, transfer } from 'comlink';
import init, {
  cp_operation_descriptors,
  document_geometry,
  document_snapshot,
  document_summary,
  execute_cp_command,
  export_cp,
  export_fold,
  export_fold_file,
  export_orh,
  export_ori,
  folded_figure_duplicate,
  folded_figure_fold,
  folded_figure_fold_selected,
  folded_figure_fold_another,
  folded_figure_fold_to_case,
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
  insert_line_segments,
  deselect_all,
  preview_cp_command,
  replace_line_segments,
  restore_document,
  restore_from_compact,
} from '../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import type { CpGeometryTransport } from '../engine/oristudioCpGeometry';
import type {
  OristudioCpCommandPayload,
  OristudioCpCommandPreview,
  OristudioCpCommandResult,
  OristudioCpDocumentSnapshot,
  OristudioCpDocumentSummary,
  OristudioCpEstimationOrder,
  OristudioCpFoldedFigureBatchResult,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureRenderOptions,
  OristudioCpFoldedFigureResult,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpLineSegment,
  OristudioCpOperationDescriptor,
} from '../engine/oristudioCpTypes';
import type { OristudioCpOperationId } from '../lib/oristudioCpCommands';
import type { WasmErrorEnvelope } from '../engine/types';

let ready: Promise<void> | null = null;

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

async function call<T>(fn: () => T): Promise<T> {
  await ensureReady();
  try {
    return fn();
  } catch (error) {
    throw normalizeError(error);
  }
}

const api = {
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
  async insertLineSegments(
    handle: number,
    segments: OristudioCpLineSegment[]
  ): Promise<number> {
    return call(() => insert_line_segments(handle, segments));
  },
  async deselectAll(handle: number): Promise<number> {
    return call(() => deselect_all(handle));
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
  async foldFigure(
    handle: number,
    startingFaceId = 1,
    order: OristudioCpEstimationOrder = 'Order5',
    model?: OristudioCpFoldedFigureModel,
    selectedLineIds: number[] = []
  ): Promise<OristudioCpFoldedFigureResult> {
    return call(
      () =>
        selectedLineIds.length > 0
          ? (folded_figure_fold_selected(
              handle,
              selectedLineIds,
              startingFaceId,
              order,
              model ?? null
            ) as OristudioCpFoldedFigureResult)
          : (folded_figure_fold(
              handle,
              startingFaceId,
              order,
              model ?? null
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
  async setFoldedFigureModel(
    handle: number,
    model: OristudioCpFoldedFigureModel
  ): Promise<OristudioCpFoldedFigureSnapshot> {
    return call(() => folded_figure_set_model(handle, model) as OristudioCpFoldedFigureSnapshot);
  },
  async duplicateFoldedFigure(handle: number): Promise<OristudioCpFoldedFigureResult> {
    return call(() => folded_figure_duplicate(handle) as OristudioCpFoldedFigureResult);
  },
  async foldFigureAnother(handle: number): Promise<OristudioCpFoldedFigureSnapshot> {
    return call(() => folded_figure_fold_another(handle) as OristudioCpFoldedFigureSnapshot);
  },
  async foldFigureToCase(
    handle: number,
    objective: number,
    initialOrder: OristudioCpEstimationOrder = 'Order5'
  ): Promise<OristudioCpFoldedFigureBatchResult> {
    return call(
      () =>
        folded_figure_fold_to_case(
          handle,
          objective,
          initialOrder
        ) as OristudioCpFoldedFigureBatchResult
    );
  },
  async freeFoldedFigure(handle: number): Promise<void> {
    return call(() => free_folded_figure(handle));
  },
  async exportCp(handle: number): Promise<string> {
    return call(() => export_cp(handle));
  },
  async exportFold(handle: number): Promise<string> {
    return call(() => export_fold(handle));
  },
  async exportFoldFile(handle: number): Promise<string> {
    return call(() => export_fold_file(handle));
  },
  async exportOri(handle: number): Promise<string> {
    return call(() => export_ori(handle));
  },
  async exportOrh(handle: number): Promise<string> {
    return call(() => export_orh(handle));
  },
  async freeDocument(handle: number): Promise<void> {
    return call(() => free_document(handle));
  },
};

export type OristudioCpWorkerApi = typeof api;

expose(api);
