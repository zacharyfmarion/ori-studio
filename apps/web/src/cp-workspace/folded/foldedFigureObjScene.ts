/**
 * The paper scene a flat folded figure's OBJ is read from when its export
 * picture is not drawn from one (`foldedFigureExportTarget`, `fixed`): a
 * figure in a look the paper scene has no form for, or one reopened from its
 * file and not folded since, which carries its picture and no geometry.
 *
 * - **A live fold** hands its own scene, its layers ordered.
 * - **A reopened figure** hands the scene its file carried for a spread, or is
 *   folded again on a handle of its own: its creases as they are, at the
 *   solution it shows, its scene read and the handle let go. The figure itself
 *   is not touched — nothing recorded, dirtied or selected — as the 3D
 *   rehydrate leaves a figure (`rehydrateOristudioCpFolded3dFigure`).
 *
 * A fold that would not be the one drawn is never written in its place: a
 * figure whose creases moved since it was folded, whose layer order was set by
 * hand, or that folds again to another solution has no mesh here, and says so
 * (`needs-refold`). Refold makes it a live fold again.
 *
 * Store and runtime reads, React-free.
 */
import type { OristudioCpFoldedFigureEntry, OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { hasFoldedLayerOrder } from '../../lib/cpFoldRuntime';
import { FOLD_RUN_NONE } from '../../lib/foldCancellation';
import { FoldedObjUnavailableError } from '../../lib/foldedExport';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { createCpFoldRuntime } from '../../store/workspaceStore/cpFoldRuntimeBindings';
import { getOristudioCpFoldedFigurePaperScene } from '../../store/workspaceStore/oristudioCpRuntime';
import { isFoldedFigureStale, reselectFoldableLineIds } from './foldedFigureStaleness';
import { foldedSnapshotCase } from './foldedFigureState';
import { resolveFoldRoute } from './foldRoute';

/** A scene with paper in it, or the reason there is none to write. */
function withPaper(scene: OristudioCpFoldedPaperScene | null): OristudioCpFoldedPaperScene {
  if (!scene || scene.faces.length === 0) throw new FoldedObjUnavailableError('needs-refold');
  return scene;
}

/**
 * Fold a reopened figure again as it is drawn and read its paper scene: the
 * same creases, the same starting face and view, the solution it shows.
 */
async function refoldedPaperScene(
  figure: OristudioCpFoldedFigureEntry & { snapshot: NonNullable<OristudioCpFoldedFigureEntry['snapshot']> }
): Promise<OristudioCpFoldedPaperScene> {
  const loaded = useWorkspaceStore.getState().oristudioCpDocument;
  const shown = figure.snapshot;
  // A hand-set order is not one a search reaches, and moved creases are another fold.
  if (!loaded || shown.shown_order === 'given' || isFoldedFigureStale(loaded.document, figure)) {
    throw new FoldedObjUnavailableError('needs-refold');
  }
  const route = resolveFoldRoute(loaded.document, reselectFoldableLineIds(loaded.document, figure.sourceBounds ?? null));
  if (route.kind !== 'flat') throw new FoldedObjUnavailableError('needs-refold');
  // Unbound: nobody can see this fold, so no Stop is aimed at it.
  const runtime = createCpFoldRuntime(FOLD_RUN_NONE);
  let state = await runtime.fold(figure.startingFaceId ?? 1, 'Order5', shown.model, route.lineIds);
  try {
    const solution = foldedSnapshotCase(shown);
    if ((state.currentCase ?? state.discoveredCases) !== solution) {
      state = { ...state, ...(await runtime.foldToCase(state.handle, solution)) };
    }
    if (!hasFoldedLayerOrder(state) || (state.currentCase ?? state.discoveredCases) !== solution) {
      throw new FoldedObjUnavailableError('needs-refold');
    }
    return withPaper(await runtime.paperScene(state.handle));
  } finally {
    await runtime.free(state.handle).catch(() => {});
  }
}

/**
 * Where a flat figure's OBJ reads its paper scene when the export's picture is
 * fixed: null for a figure with none to give — a 3D figure, a fold with no
 * layer order, a figure folded before its creases were recorded.
 */
export function foldedFigureObjScene(
  figure: OristudioCpFoldedFigureEntry
): (() => Promise<OristudioCpFoldedPaperScene>) | null {
  const { snapshot } = figure;
  if (figure.folded3d || !snapshot || snapshot.outcome !== 'Solved') return null;
  if (figure.handle != null) {
    const handle = figure.handle;
    return async () =>
      withPaper(
        await getOristudioCpFoldedFigurePaperScene(handle, useWorkspaceStore.getState().oristudioCpDocument?.handle ?? null)
      );
  }
  const carried = figure.spreadScene;
  if (carried && carried.faces.length > 0) return async () => carried;
  if (figure.sourceBounds == null) return null;
  return () => refoldedPaperScene({ ...figure, snapshot });
}
