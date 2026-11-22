/**
 * The CP kernel in-process, for the diagram corpus. Test-only.
 *
 * The app reaches the kernel through its worker; here the worker's own API
 * object is called directly (`oristudioCpWorkerApi`), after `initSync` of the
 * same generated wasm, so a capture takes exactly the app's path but the
 * transport. Captures bind to a document handle the way the app's capture
 * sessions do (`createBoundCpCaptureRuntime`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initSync } from '../../generated/oristudio-cp-wasm/oristudio_cp_wasm';
import { decodeCpGeometryToSnapshot, type CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { NO_AUX_LINES_KEY, cpAuxLinesKey } from '../../cp-workspace/folded/foldedAuxSource';
import { CpSheetIndex } from '../../engine/oristudioCpSheetIndex';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import type { FoldDocument } from '../../engine/types';
import { sheetArtifactsFromFold } from '../../cp-workspace/sheets/cpSheetArtifacts';
import type { CpSheetRegion } from '../../cp-workspace/sheets/cpSheetRegions';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { FOLD_RUN_NONE } from '../../lib/foldCancellation';
import { createBoundCpCaptureRuntime } from '../../store/workspaceStore/cpFoldRuntimeBindings';
import { oristudioCpWorkerApi, type OristudioCpWorkerApi } from '../../workers/oristudioCpWorkerApi';
import type { CpCaptureRuntime, SheetPaper } from '../capture/captureFolded';

let ready = false;

/** The kernel's API, its wasm loaded from this checkout's build. */
export function cpKernel(): OristudioCpWorkerApi {
  if (!ready) {
    // Vitest runs from apps/web.
    initSync({ module: readFileSync(resolve(process.cwd(), 'src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm')) });
    ready = true;
  }
  return oristudioCpWorkerApi;
}

/** A crease pattern loaded into the kernel, as a capture sees it. */
export interface LoadedPattern {
  handle: number;
  document: OristudioCpDocumentSnapshot;
  sheets: CpSheetIndex;
  runtime: CpCaptureRuntime;
  /** A sheet's paper as `storeSheetPaper` builds it: the rims of the faces built for that sheet alone. */
  sheetPaper: SheetPaper;
  /** A sheet's own fold, by its place in the index, as `ensureCpSheetArtifacts` builds it. */
  sheetFold: (sheet: number) => Promise<FoldDocument>;
}

/**
 * The calls a Diagram capture makes, as `createCpCaptureRuntime` makes them:
 * the bound runtime's folds, but a figure's paper scene and source as they
 * were captured at its fold (no document handle), and a 3D figure's aux
 * lines asked for only when the document holds any (`auxHandle`).
 */
function captureRuntime(kernel: OristudioCpWorkerApi, handle: number, geometry: CpGeometryTransport): CpCaptureRuntime {
  const bound = createBoundCpCaptureRuntime(kernel, handle, FOLD_RUN_NONE);
  const auxHandle = cpAuxLinesKey(geometry) === NO_AUX_LINES_KEY ? null : handle;
  return {
    ...bound,
    paperScene: (figure) => kernel.foldedFigurePaperScene(figure),
    source: (figure) => kernel.foldedFigureSource(figure),
    aux3d: async (figure) => (auxHandle === null ? null : kernel.folded3dAuxLines(figure, auxHandle)),
  };
}

async function bind(kernel: OristudioCpWorkerApi, handle: number): Promise<LoadedPattern> {
  // The snapshot as the store builds it (`fetchDocumentAndGeometry`).
  const geometry = await kernel.documentGeometry(handle);
  const document = decodeCpGeometryToSnapshot(geometry);
  const sheets = new CpSheetIndex(await kernel.sheetIndex(handle));
  const artifacts = async (sheet: number) =>
    sheetArtifactsFromFold(JSON.parse(await kernel.exportFoldLines(handle, [...sheets.lines(sheet)])) as FoldDocument, sheet);
  return {
    handle,
    document,
    sheets,
    runtime: captureRuntime(kernel, handle, geometry),
    sheetPaper: async (sheet: CpSheetRegion) => resolveCpSegments(await artifacts(sheet.id))[0]?.boundary ?? null,
    sheetFold: async (sheet) => (await artifacts(sheet)).fold,
  };
}

/** Loads a project's crease-pattern document, as the app's CP runtime does when a file opens. */
export async function loadPattern(document: unknown): Promise<LoadedPattern> {
  const kernel = cpKernel();
  return bind(kernel, await kernel.loadDocument(document as OristudioCpDocumentSnapshot));
}

/** The same document after an edit: its snapshot and sheet index made again. */
export async function reread(pattern: LoadedPattern): Promise<LoadedPattern> {
  return bind(cpKernel(), pattern.handle);
}

export async function freePattern(pattern: LoadedPattern): Promise<void> {
  await cpKernel().freeDocument(pattern.handle);
}
