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
import type { FlatText } from '../cp-workspace/annotations/annotation';

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

// Binary compact-geometry decode — the counterpart to Rust `CompactGeometry::to_bytes`
// (crates/oristudio-cp/src/geometry_transport.rs). The native `cp_document_geometry`
// returns one ArrayBuffer; slicing it into typed arrays avoids the JSON
// serialize/parse that made large-doc selection laggy. Layout (little-endian):
// magic | 10 element-counts (field order) | tail_byte_len | tail JSON | array data.
const COMPACT_GEOMETRY_MAGIC = 0x4f_43_47_31; // "OCG1"
const COMPACT_GEOMETRY_HEADER_U32S = 12;

/** Decode a native compact-geometry ArrayBuffer into typed arrays. Throws (loudly)
 * on a bad magic or a length that disagrees with the header. Exported for tests. */
export function decodeCompactGeometryBytes(buffer: ArrayBuffer): CpGeometryTransport {
  const fail = (message: string): never => {
    throw { code: 'geometry_decode', message };
  };
  if (buffer.byteLength < COMPACT_GEOMETRY_HEADER_U32S * 4) {
    fail('compact geometry buffer too small for header');
  }
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== COMPACT_GEOMETRY_MAGIC) {
    fail('compact geometry: bad magic/version');
  }
  const counts: number[] = [];
  for (let i = 0; i < 10; i += 1) counts.push(view.getUint32(4 + i * 4, true));
  const tailLen = view.getUint32(4 + 10 * 4, true);
  const [segE, segA, segC, auxE, auxA, auxC, pt, circD, circA, circC] = counts;

  const expected =
    COMPACT_GEOMETRY_HEADER_U32S * 4 +
    tailLen +
    (segE + auxE + pt + circD) * 8 +
    (segA + auxA + circA) * 4 +
    segC +
    auxC +
    circC;
  if (buffer.byteLength !== expected) {
    fail(`compact geometry: length mismatch (expected ${expected}, got ${buffer.byteLength})`);
  }

  let offset = COMPACT_GEOMETRY_HEADER_U32S * 4;
  const tail = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, offset, tailLen))
  ) as CpGeometryTransport['tail'];
  offset += tailLen;

  // `slice` returns a fresh, 0-aligned ArrayBuffer so the typed-array views are valid.
  const f64 = (count: number): Float64Array => {
    const array = new Float64Array(buffer.slice(offset, offset + count * 8));
    offset += count * 8;
    return array;
  };
  const i32 = (count: number): Int32Array => {
    const array = new Int32Array(buffer.slice(offset, offset + count * 4));
    offset += count * 4;
    return array;
  };
  const u8 = (count: number): Uint8Array => {
    const array = new Uint8Array(buffer.slice(offset, offset + count));
    offset += count;
    return array;
  };

  return {
    segEndpoints: f64(segE),
    segAttr: i32(segA),
    segCustomColor: u8(segC),
    auxEndpoints: f64(auxE),
    auxAttr: i32(auxA),
    auxCustomColor: u8(auxC),
    pointCoords: f64(pt),
    circleData: f64(circD),
    circleAttr: i32(circA),
    circleCustomColor: u8(circC),
    tail,
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

async function setTextsNative(handle: number, texts: FlatText[]): Promise<void> {
  const coords = new Array<number>(texts.length * 2);
  for (let i = 0; i < texts.length; i += 1) {
    coords[i * 2] = texts[i].x;
    coords[i * 2 + 1] = texts[i].y;
  }
  return call('cp_set_texts', {
    handle,
    coords,
    texts: texts.map((entry) => entry.text),
  });
}

/**
 * Native mirror of the worker's `exportWithTexts`: populate the kernel's text
 * elements from the flattened rich-text boxes, export, then clear them again.
 * The kernel `texts` vec is only the Oriedita interchange representation, so it
 * stays empty during a session and is loaded transiently around an export.
 */
async function exportWithTexts(
  handle: number,
  texts: FlatText[],
  exporter: () => Promise<string>
): Promise<string> {
  await setTextsNative(handle, texts);
  try {
    return await exporter();
  } finally {
    await setTextsNative(handle, []);
  }
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
      const buffer = await call<ArrayBuffer>('cp_document_geometry', { handle });
      return decodeCompactGeometryBytes(buffer);
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
    async exportFold(handle: number, texts: FlatText[] = []): Promise<string> {
      return exportWithTexts(handle, texts, () => call('cp_export_fold', { handle }));
    },
    async exportFoldFile(handle: number, texts: FlatText[] = []): Promise<string> {
      return exportWithTexts(handle, texts, () => call('cp_export_fold_file', { handle }));
    },
    async exportOri(handle: number, texts: FlatText[] = []): Promise<string> {
      return exportWithTexts(handle, texts, () => call('cp_export_ori', { handle }));
    },
    async exportOrh(handle: number, texts: FlatText[] = []): Promise<string> {
      return exportWithTexts(handle, texts, () => call('cp_export_orh', { handle }));
    },
    async setTexts(handle: number, texts: FlatText[]): Promise<void> {
      return setTextsNative(handle, texts);
    },
    async freeDocument(handle: number): Promise<void> {
      return call('cp_free_document', { handle });
    },
  };
}
