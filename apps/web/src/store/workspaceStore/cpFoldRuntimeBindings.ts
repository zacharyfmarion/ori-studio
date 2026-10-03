import type { CpCaptureRuntime } from '../../diagram/capture/captureFolded';
import type { CpFoldRuntime } from '../../lib/creaseExportFold';
import type { OristudioCpFoldedFigureSnapshot } from '../../engine/oristudioCpTypes';
import {
  fold3dOristudioCpDocument,
  fold3dOristudioCpFigureAnother,
  foldOristudioCpDocument,
  foldOristudioCpFigureAnother,
  foldOristudioCpFigureToCase,
  freeOristudioCpFoldedFigure,
  getOristudioCpFolded3dAuxLines,
  getOristudioCpFoldedFigurePaperScene,
  getOristudioCpFoldedFigureRenderSnapshot,
  setOristudioCpFoldedFigureModel,
} from './oristudioCpRuntime';

/** What a fold left the figure in, from the kernel's snapshot. */
function stateOf(snapshot: OristudioCpFoldedFigureSnapshot) {
  return {
    discoveredCases: snapshot.discovered_fold_cases,
    displayStyle: snapshot.display_style,
    outcome: snapshot.outcome,
    // Absent from figures that predate backwards navigation, where the
    // discovered count is the case shown (`foldedFigureCycling`).
    currentCase: snapshot.current_fold_case ?? snapshot.discovered_fold_cases,
    hasNext: snapshot.find_another_overlap_valid,
  };
}

/**
 * The kernel's fold calls for the loaded crease pattern, every one bound to
 * `runId`: the fold-run registry's id, which is what a Stop aims at.
 *
 * `FOLD_RUN_NONE` for a fold nobody can see or point at (an export preview):
 * it runs to completion or fails, and — unbound rather than `BACKGROUND` — the
 * kernel skips its rollback snapshot, which it takes on every step of a bound
 * run. A fold the user started and may stop (a Diagram capture) passes its
 * registered run id and pays that cost.
 */
export function createCpFoldRuntime(runId: number): CpFoldRuntime {
  return {
    fold: async (startingFaceId, order, model, lineIds) => {
      const result = await foldOristudioCpDocument(startingFaceId, order, model, lineIds, runId);
      return { handle: result.handle, ...stateOf(result.snapshot) };
    },
    foldToCase: async (handle, objective) => {
      const result = await foldOristudioCpFigureToCase(handle, objective, 'Order5', runId);
      return stateOf(result.snapshot);
    },
    setModel: async (handle, model) => stateOf(await setOristudioCpFoldedFigureModel(handle, model)),
    foldAnother: async (handle) => stateOf(await foldOristudioCpFigureAnother(handle, runId)),
    // Render at the style the estimate reached, exactly as the canvas does.
    renderSnapshot: (handle, displayStyle) =>
      getOristudioCpFoldedFigureRenderSnapshot(handle, displayStyle, {
        display_mark: false,
        selected: false,
      }),
    paperScene: (handle) => getOristudioCpFoldedFigurePaperScene(handle),
    free: (handle) => freeOristudioCpFoldedFigure(handle),
  };
}

/**
 * The calls a Diagram capture makes, bound to its fold run: the flat ones
 * above and the 3D fold. `auxDocumentHandle` is the document whose aux lines
 * a 3D figure carries, or null when it has none to carry, which asks nothing.
 */
export function createCpCaptureRuntime(
  runId: number,
  auxDocumentHandle: number | null
): CpCaptureRuntime {
  return {
    ...createCpFoldRuntime(runId),
    // Starting face 1, as every capture folds.
    fold3d: (lineIds, model) => fold3dOristudioCpDocument(lineIds, 1, model, runId),
    fold3dAnother: (handle) => fold3dOristudioCpFigureAnother(handle, runId),
    aux3d: async (handle) =>
      auxDocumentHandle === null ? null : getOristudioCpFolded3dAuxLines(handle, auxDocumentHandle),
  };
}
