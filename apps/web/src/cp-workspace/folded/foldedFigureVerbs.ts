import type { TFunction } from 'i18next';
import type {
  FoldedFigurePlacement,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureModel,
} from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { FoldedFigureCamera } from './foldedFigure3dProjection';
import { foldedFigureGesture } from './foldedFigureGesture';

/**
 * The folded-figure layer's one-entry setters as React-free functions over the
 * layer's bracket, so the Properties pane and the context menu share one
 * implementation without mounting `useFoldedFigures` (single-instance: it
 * needs the panel's document and selection, and owns the orbit and
 * rehydration effects).
 *
 * Every function is `foldedFigureGesture.run('verb', label, …)`; a verb that
 * changed nothing records nothing, and one issued while another owner holds
 * the layer is refused. The verbs that need panel-held state — export, the
 * notice action, another solution, the 3D flip through the live orbit camera —
 * stay in the hook and on the floating toolbar.
 */

export function setFoldedFigureDisplayStyle(
  id: string,
  displayStyle: OristudioCpFoldedFigureDisplayStyle,
  t: TFunction
): Promise<boolean | undefined> {
  return foldedFigureGesture.run(
    'verb',
    t('panels:creasePattern.changeFoldedDisplayStyle', 'Change folded display style'),
    () => useWorkspaceStore.getState().setOristudioCpFoldedFigureDisplayStyle(id, displayStyle)
  );
}

/** One discrete model change (side, shadows, anti-alias) as one entry. */
export function updateFoldedFigureModelAsEntry(
  id: string,
  patch: Partial<OristudioCpFoldedFigureModel>,
  t: TFunction
): Promise<boolean | undefined> {
  return foldedFigureGesture.run(
    'verb',
    t('panels:creasePattern.changeFoldedModel', 'Change folded model'),
    () => useWorkspaceStore.getState().updateOristudioCpFoldedFigureModel(id, patch)
  );
}

/**
 * Move a 3D figure's eye, as one entry. Callers spread the figure's current
 * camera so `orient` survives a yaw or pitch edit — which way the model is up
 * is a property of the model, not of one look at it.
 */
export function setFolded3dCamera(
  id: string,
  camera: FoldedFigureCamera,
  t: TFunction
): Promise<boolean | undefined> {
  return foldedFigureGesture.run(
    'verb',
    t('panels:cpProperties.folded.changeView', 'Change folded model view'),
    () => useWorkspaceStore.getState().setOristudioCpFolded3dCamera(id, camera)
  );
}

/** A typed placement edit (scale, rotation) as one entry, under the gesture's own label. */
export function setFoldedFigurePlacementAsEntry(
  id: string,
  patch: Partial<FoldedFigurePlacement>,
  label: string
): Promise<void | undefined> {
  return foldedFigureGesture.run('verb', label, () =>
    useWorkspaceStore.getState().setOristudioCpFoldedFigurePlacement(id, patch)
  );
}

export function deleteFoldedFigure(id: string, t: TFunction): Promise<void | undefined> {
  return foldedFigureGesture.run(
    'verb',
    t('panels:creasePattern.deleteFoldedModelAction', 'Delete folded model'),
    () => useWorkspaceStore.getState().deleteOristudioCpFoldedFigure(id)
  );
}
