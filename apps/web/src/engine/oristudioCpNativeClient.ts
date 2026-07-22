// Native (desktop) CP engine client. Implements the same OristudioCpWorkerApi
// interface as the browser wasm worker, but dispatches to native Rust Tauri
// commands via `invoke`. Both backends share one Rust CpSession, so behavior is
// identical; the compile-time `OristudioCpWorkerApi` return type keeps this
// client in lockstep with the worker (add a method to one, the other fails
// typecheck). See implementation-plans/desktop-native-cp-engine-migration.md.

import { invoke } from '@tauri-apps/api/core';

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
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpLineSegment,
  OristudioCpOperationDescriptor,
} from './oristudioCpTypes';
import type { CpGeometryTransport } from './oristudioCpGeometry';
import type { WasmErrorEnvelope } from './types';
import type { OristudioCpOperationId } from '../lib/oristudioCpCommands';
import type { OristudioCpWorkerApi } from '../workers/oristudioCpWorker';

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
    code: 'oristudio_cp_native_error',
    message: error instanceof Error ? error.message : String(error),
  };
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeError(error);
  }
}

// The native geometry command returns/accepts plain number arrays (JSON); the
// rest of the app works with typed arrays, so convert at this boundary.
type PlainCompactGeometry = {
  segEndpoints: number[];
  segAttr: number[];
  segCustomColor: number[];
  auxEndpoints: number[];
  auxAttr: number[];
  auxCustomColor: number[];
  pointCoords: number[];
  circleData: number[];
  circleAttr: number[];
  circleCustomColor: number[];
  tail: CpGeometryTransport['tail'];
};

function toTypedGeometry(raw: PlainCompactGeometry): CpGeometryTransport {
  return {
    segEndpoints: new Float64Array(raw.segEndpoints),
    segAttr: new Int32Array(raw.segAttr),
    segCustomColor: new Uint8Array(raw.segCustomColor),
    auxEndpoints: new Float64Array(raw.auxEndpoints),
    auxAttr: new Int32Array(raw.auxAttr),
    auxCustomColor: new Uint8Array(raw.auxCustomColor),
    pointCoords: new Float64Array(raw.pointCoords),
    circleData: new Float64Array(raw.circleData),
    circleAttr: new Int32Array(raw.circleAttr),
    circleCustomColor: new Uint8Array(raw.circleCustomColor),
    tail: raw.tail,
  };
}

function toPlainGeometry(geometry: CpGeometryTransport): PlainCompactGeometry {
  return {
    segEndpoints: Array.from(geometry.segEndpoints),
    segAttr: Array.from(geometry.segAttr),
    segCustomColor: Array.from(geometry.segCustomColor),
    auxEndpoints: Array.from(geometry.auxEndpoints),
    auxAttr: Array.from(geometry.auxAttr),
    auxCustomColor: Array.from(geometry.auxCustomColor),
    pointCoords: Array.from(geometry.pointCoords),
    circleData: Array.from(geometry.circleData),
    circleAttr: Array.from(geometry.circleAttr),
    circleCustomColor: Array.from(geometry.circleCustomColor),
    tail: geometry.tail,
  };
}

export function createOristudioCpNativeClient(): OristudioCpWorkerApi {
  return {
    async operationDescriptors(): Promise<OristudioCpOperationDescriptor[]> {
      return call('cp_operation_descriptors');
    },
    async loadCp(text: string, title = ''): Promise<number> {
      return call('cp_load_cp', { text, title });
    },
    async loadFold(text: string, title = ''): Promise<number> {
      return call('cp_load_fold', { text, title });
    },
    async loadFoldFile(text: string): Promise<number> {
      return call('cp_load_fold_file', { text });
    },
    async loadOri(text: string, acceptUnknownVersion = false): Promise<number> {
      return call('cp_load_ori', { text, acceptUnknownVersion });
    },
    async loadOrh(text: string): Promise<number> {
      return call('cp_load_orh', { text });
    },
    async loadDocument(document: OristudioCpDocumentSnapshot): Promise<number> {
      return call('cp_load_document', { document });
    },
    async restoreDocument(handle: number, document: OristudioCpDocumentSnapshot): Promise<void> {
      return call('cp_restore_document', { handle, document });
    },
    async snapshot(handle: number): Promise<OristudioCpDocumentSnapshot> {
      return call('cp_document_snapshot', { handle });
    },
    async documentGeometry(handle: number): Promise<CpGeometryTransport> {
      const raw = await call<PlainCompactGeometry>('cp_document_geometry', { handle });
      return toTypedGeometry(raw);
    },
    async restoreFromCompact(handle: number, geometry: CpGeometryTransport): Promise<void> {
      return call('cp_restore_from_compact', { handle, geometry: toPlainGeometry(geometry) });
    },
    async summary(handle: number): Promise<OristudioCpDocumentSummary> {
      return call('cp_document_summary', { handle });
    },
    async executeCommand(
      handle: number,
      operationId: OristudioCpOperationId,
      payload: OristudioCpCommandPayload = {}
    ): Promise<OristudioCpCommandResult> {
      return call('cp_execute_command', { handle, operation: operationId, payload });
    },
    async previewCommand(
      handle: number,
      operationId: OristudioCpOperationId,
      payload: OristudioCpCommandPayload = {}
    ): Promise<OristudioCpCommandPreview> {
      return call('cp_preview_command', { handle, operation: operationId, payload });
    },
    async insertLineSegments(handle: number, segments: OristudioCpLineSegment[]): Promise<number> {
      return call('cp_insert_line_segments', { handle, segments });
    },
    async deselectAll(handle: number): Promise<number> {
      return call('cp_deselect_all', { handle });
    },
    async importAdd(handle: number, importedHandle: number): Promise<number> {
      return call('cp_import_add', { handle, importedHandle });
    },
    async replaceLineSegments(
      handle: number,
      lineIds: number[],
      segments: OristudioCpLineSegment[]
    ): Promise<number> {
      return call('cp_replace_line_segments', { handle, lineIds, segments });
    },
    async foldFigure(
      handle: number,
      startingFaceId = 1,
      order: OristudioCpEstimationOrder = 'Order5',
      model?: OristudioCpFoldedFigureModel,
      selectedLineIds: number[] = []
    ): Promise<OristudioCpFoldedFigureResult> {
      if (selectedLineIds.length > 0) {
        return call('cp_folded_figure_fold_selected', {
          documentHandle: handle,
          selectedLineIds,
          startingFaceId,
          order,
          model: model ?? null,
        });
      }
      return call('cp_folded_figure_fold', {
        documentHandle: handle,
        startingFaceId,
        order,
        model: model ?? null,
      });
    },
    async foldedFigureSnapshot(handle: number): Promise<OristudioCpFoldedFigureSnapshot> {
      return call('cp_folded_figure_snapshot', { handle });
    },
    async foldedFigureRenderSnapshot(
      handle: number,
      displayStyle?: OristudioCpFoldedFigureSnapshot['display_style'],
      options?: OristudioCpFoldedFigureRenderOptions
    ): Promise<OristudioCpFoldedRenderSnapshot | null> {
      return call('cp_folded_figure_render_snapshot', {
        handle,
        displayStyle: displayStyle ?? null,
        options: options ?? null,
      });
    },
    async setFoldedFigureModel(
      handle: number,
      model: OristudioCpFoldedFigureModel
    ): Promise<OristudioCpFoldedFigureSnapshot> {
      return call('cp_folded_figure_set_model', { handle, model });
    },
    async duplicateFoldedFigure(handle: number): Promise<OristudioCpFoldedFigureResult> {
      return call('cp_folded_figure_duplicate', { handle });
    },
    async foldFigureAnother(handle: number): Promise<OristudioCpFoldedFigureSnapshot> {
      return call('cp_folded_figure_fold_another', { handle });
    },
    async foldFigureToCase(
      handle: number,
      objective: number,
      initialOrder: OristudioCpEstimationOrder = 'Order5'
    ): Promise<OristudioCpFoldedFigureBatchResult> {
      return call('cp_folded_figure_fold_to_case', { handle, objective, initialOrder });
    },
    async freeFoldedFigure(handle: number): Promise<void> {
      return call('cp_free_folded_figure', { handle });
    },
    async exportCp(handle: number): Promise<string> {
      return call('cp_export_cp', { handle });
    },
    async exportFold(handle: number): Promise<string> {
      return call('cp_export_fold', { handle });
    },
    async exportFoldFile(handle: number): Promise<string> {
      return call('cp_export_fold_file', { handle });
    },
    async exportOri(handle: number): Promise<string> {
      return call('cp_export_ori', { handle });
    },
    async exportOrh(handle: number): Promise<string> {
      return call('cp_export_orh', { handle });
    },
    async freeDocument(handle: number): Promise<void> {
      return call('cp_free_document', { handle });
    },
  };
}
