import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  FoldedFigurePlacement,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureModel,
} from '../../engine/oristudioCpTypes';
import type { LiveValue, PropertySheet } from '../../lib/propertyDescriptors';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import { usePaneGesture } from '../canvasObjects/usePaneGesture';
import { getFolded3dOrbit, subscribeFolded3dOrbit } from './folded3dRuntime';
import { DEFAULT_FOLDED_3D_CAMERA, type FoldedFigureCamera } from './foldedFigure3dProjection';
import { foldedFigureGesture } from './foldedFigureGesture';
import { buildFoldedFigureProperties, type FoldedFigurePropertyDeps } from './foldedFigureProperties';
import { isFoldedFigureStale } from './foldedFigureStaleness';
import {
  setFolded3dCamera,
  setFoldedFigureDisplayStyle,
  setFoldedFigurePlacementAsEntry,
  updateFoldedFigureModelAsEntry,
} from './foldedFigureVerbs';
import { queueFoldedModelWrite } from './foldedModelWriteQueue';

/**
 * The folded figure's sheet, bound to the store through the verbs module and
 * the kernel write queue — not `useFoldedFigures`, which is single-instance
 * and needs the panel's document and selection.
 *
 * Continuous colour edits open the folded layer's bracket under the pane's
 * owner and queue their writes; the bracket's commit drains the queue before
 * it records, so the one entry per pick holds what the kernel drew. The
 * camera rows read the live orbit frame while a drag turns the figure and
 * the stored camera otherwise — the same rule `useFoldedFigures` applies.
 */
export function useFoldedFigureProperties(target: TargetOf<'folded-figure'>): PropertySheet {
  const { t } = useTranslation();
  const document = useWorkspaceStore((state) => state.oristudioCpDocument?.document);
  const figure = target.figure;
  const id = target.id;
  // The same test the panel runs for its stale badge, once per document revision.
  const stale = useMemo(() => isFoldedFigureStale(document, figure), [document, figure]);
  const gesture = usePaneGesture(foldedFigureGesture);

  const setDisplayStyle = useCallback(
    (style: OristudioCpFoldedFigureDisplayStyle) => {
      void setFoldedFigureDisplayStyle(id, style, t);
    },
    [id, t]
  );
  const writeModel = useCallback(
    (patch: Partial<OristudioCpFoldedFigureModel>) => {
      // Aborted underneath (an undo from the menu bar): a write now would land
      // a change no entry covers. The next move begins a fresh gesture.
      if (!gesture.isOpen()) return;
      queueFoldedModelWrite(id, patch);
    },
    [gesture, id]
  );
  const commitModel = useCallback(
    (patch: Partial<OristudioCpFoldedFigureModel>) => {
      void updateFoldedFigureModelAsEntry(id, patch, t);
    },
    [id, t]
  );
  const setCamera = useCallback(
    (camera: FoldedFigureCamera) => {
      void setFolded3dCamera(id, camera, t);
    },
    [id, t]
  );
  const setPlacement = useCallback(
    (patch: Partial<FoldedFigurePlacement>, label: string) => {
      void setFoldedFigurePlacementAsEntry(id, patch, label);
    },
    [id]
  );
  const storedCamera = figure.camera ?? DEFAULT_FOLDED_3D_CAMERA;
  const liveCamera = useMemo<LiveValue<FoldedFigureCamera>>(
    () => ({
      read: () => getFolded3dOrbit(id)?.camera ?? storedCamera,
      subscribe: subscribeFolded3dOrbit,
    }),
    [id, storedCamera]
  );

  const deps = useMemo<FoldedFigurePropertyDeps>(
    () => ({
      t,
      stale,
      held: gesture.held,
      begin: gesture.begin,
      end: gesture.end,
      writeModel,
      commitModel,
      setDisplayStyle,
      setCamera,
      liveCamera,
      setPlacement,
    }),
    [
      t,
      stale,
      gesture.held,
      gesture.begin,
      gesture.end,
      writeModel,
      commitModel,
      setDisplayStyle,
      setCamera,
      liveCamera,
      setPlacement,
    ]
  );
  return useMemo(() => buildFoldedFigureProperties(target, deps), [target, deps]);
}
