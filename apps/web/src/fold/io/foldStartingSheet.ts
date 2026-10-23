/**
 * Import starting sheet: a crease pattern's outline as the sheet a sequence
 * starts from — the Paper tab's one way to change the sheet, through Import
 * CP's dialog in its sheet mode.
 *
 * - **Only the outline is read** (`import_sheet`): the creases are not
 *   imported, so a pattern that does not fold flat still gives its sheet. A
 *   square or a rectangle comes back as one, in the frame the outline code
 *   chooses; any other outline as its corners.
 * - **The engine says whether it folds the outline**: convex, no side too
 *   short. The document then keeps a polygon of 3 to 8 corners
 *   (`FOLD_POLYGON_MAX_SIDES`): more would open the file read-only in this
 *   build, so an outline with more is refused here, before anything changes.
 * - **A new sheet starts the sequence over**, as a new shape always has
 *   (`setFoldPaperShape`): the steps are cleared as one undoable edit.
 * - **Latest wins**: a new request or a dispose drops whatever an earlier one
 *   was still waiting for.
 *
 * Pure: no React, no store, no wasm. The session and the store's edit are
 * handed in.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';
import type { RegionReference } from '../../cp-workspace/regions/regionReference';
import type { WasmErrorEnvelope } from '../../engine/types';
import {
  FOLD_POLYGON_MAX_SIDES,
  FOLD_POLYGON_MIN_SIDES,
  rectangleShape,
  type FoldCpOrigin,
  type FoldPaperShape,
} from '../document/foldSequenceDocument';
import type { FoldFoundSheet, FoldSheetFound } from '../engine/foldEngineIoWire';
import type { FoldEngineOutcome } from '../engine/foldEngineWire';
import type { FoldSession } from '../session/foldSession';
import type { FoldImportRequest, FoldProjectCpImport } from './foldImportFlow';
import type { FoldImportLocalCode, FoldImportRefusal } from './foldImportRefusal';
import { foldCursorReady } from './foldSessionWaits';

export type FoldStartingSheetState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'working'; readonly request: FoldImportRequest }
  | { readonly phase: 'refused'; readonly request: FoldImportRequest; readonly refusal: FoldImportRefusal }
  | { readonly phase: 'failed'; readonly request: FoldImportRequest; readonly error: WasmErrorEnvelope }
  /** The sheet is the sequence's now (`changed` false when it already was). */
  | { readonly phase: 'done'; readonly request: FoldImportRequest; readonly shape: FoldPaperShape; readonly changed: boolean };

export interface FoldStartingSheetOptions {
  session: FoldSession;
  /** A linked Edit pattern's source, as Import CP captures one. */
  projectCp?: (stepId?: string, region?: RegionReference) => Promise<FoldProjectCpImport | null>;
  /** Start the sequence over on `shape`; whether it changed anything. */
  adopt: (shape: FoldPaperShape) => boolean;
  /** The sheet changed: by its kind, and where it came from (a closed origin). */
  onChanged?: (shape: FoldPaperShape, origin: FoldCpOrigin) => void;
  /** A request was refused: the dialog now says why. */
  onRefused?: (refusal: FoldImportRefusal) => void;
}

export interface FoldStartingSheetFlow {
  readonly store: StoreApi<FoldStartingSheetState>;
  /** Take the outline of the pattern `request` names as the sheet. */
  open(request: FoldImportRequest): Promise<void>;
  dispose(): void;
}

/**
 * The document's shape for the engine's sheet, or why it cannot hold it: a
 * polygon with fewer or more corners than the document keeps.
 */
export function foldStartingShape(found: FoldFoundSheet): FoldPaperShape | { refused: FoldImportLocalCode; sides: number } {
  switch (found.shape) {
    case 'square':
      return { kind: 'square' };
    case 'rectangle':
      return rectangleShape(found.width, found.height) ?? { refused: 'sheet_not_convex', sides: 4 };
    case 'polygon': {
      const sides = found.points.length;
      if (sides < FOLD_POLYGON_MIN_SIDES || sides > FOLD_POLYGON_MAX_SIDES) return { refused: 'sheet_sides', sides };
      return { kind: 'polygon', points: found.points.map(([x, y]) => [x, y] as const) };
    }
  }
}

/** The engine's refusals of an outline as a sheet, by their codes, as the dialog words them. */
const SHEET_REFUSALS: Readonly<Record<string, FoldImportLocalCode>> = {
  sheet_not_convex: 'sheet_not_convex',
  sheet_side_too_short: 'sheet_side_short',
  sheet_too_few_points: 'sheet_sides',
  sheet_not_finite: 'sheet_not_convex',
  sheet_not_in_unit_frame: 'sheet_not_convex',
};

/** The closed origin a request's sheet came from, as `fold cp imported` names a pattern's. */
function originOf(request: FoldImportRequest): FoldCpOrigin {
  switch (request.kind) {
    case 'file':
      return request.source?.format ?? 'cp';
    case 'project-cp':
      return 'project_cp';
    case 'sample':
      return 'sample';
    case 'edit-folded-figure':
      return 'edit_folded_figure';
  }
}

export function createFoldStartingSheetFlow({
  session,
  projectCp,
  adopt,
  onChanged,
  onRefused,
}: FoldStartingSheetOptions): FoldStartingSheetFlow {
  const store = createStore<FoldStartingSheetState>(() => ({ phase: 'idle' }));
  const unsubscribeRefused = store.subscribe((next, before) => {
    if (next.phase === 'refused' && next !== before) onRefused?.(next.refusal);
  });
  const releaseHold = session.retain();
  let ticket = 0;
  let disposed = false;

  const local = (request: FoldImportRequest, code: FoldImportLocalCode, sides?: number): FoldStartingSheetState => ({
    phase: 'refused',
    request,
    refusal: {
      kind: 'local',
      code,
      ...(request.kind === 'file' ? { name: request.name } : {}),
      ...(sides !== undefined ? { sides } : {}),
    },
  });

  const open = async (request: FoldImportRequest): Promise<void> => {
    if (disposed) return;
    const mine = ++ticket;
    store.setState({ phase: 'working', request }, true);
    if (request.kind === 'file' && request.source === null) {
      store.setState(local(request, request.unreadable ? 'unreadable_file' : 'unsupported_file'), true);
      return;
    }
    if (request.kind !== 'file' && request.kind !== 'project-cp') {
      // A sample or a folded figure is no outline to start from.
      store.setState(local(request, 'unsupported_file'), true);
      return;
    }
    try {
      const project = request.kind === 'project-cp' ? await projectCp?.(undefined, request.region) : undefined;
      if (mine !== ticket) return;
      const source = request.kind === 'project-cp' ? project?.source : request.source;
      if (!source) {
        store.setState(local(request, request.kind === 'project-cp' ? 'no_project_cp' : 'unsupported_file'), true);
        return;
      }
      // Any landed state carries the call: the sheet's, which every sequence has.
      const where = await foldCursorReady(session, null);
      if (mine !== ticket) return;
      if (where.status !== 'ready') {
        store.setState(local(request, where.reason === 'read-only' ? 'read_only' : 'no_state'), true);
        return;
      }
      const answer = await session.withState(where.state, (engine) => engine.importSheet(source));
      if (mine !== ticket || disposed) return;
      if (answer.status !== 'answered') {
        store.setState(local(request, 'no_state'), true);
        return;
      }
      const found: FoldEngineOutcome<FoldSheetFound> = answer.value;
      if (found.status !== 'ok') {
        const sheetCode = SHEET_REFUSALS[found.refusal.code];
        store.setState(
          sheetCode ? local(request, sheetCode) : { phase: 'refused', request, refusal: { kind: 'engine', refused: found } },
          true
        );
        return;
      }
      const shape = foldStartingShape(found.sheet);
      if ('refused' in shape) {
        store.setState(local(request, shape.refused, shape.sides), true);
        return;
      }
      const changed = adopt(shape);
      if (changed) onChanged?.(shape, originOf(request));
      store.setState({ phase: 'done', request, shape, changed }, true);
    } catch (error) {
      if (mine !== ticket) return;
      const envelope =
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? { code: error.code, message: 'message' in error ? String(error.message) : error.code }
          : { code: 'fold_import', message: error instanceof Error ? error.message : String(error) };
      store.setState({ phase: 'failed', request, error: envelope }, true);
    }
  };

  return {
    store,
    open,
    dispose() {
      if (disposed) return;
      disposed = true;
      ticket += 1;
      unsubscribeRefused();
      releaseHold();
    },
  };
}
