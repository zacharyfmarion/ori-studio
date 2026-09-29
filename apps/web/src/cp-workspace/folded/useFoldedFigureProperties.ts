import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ANALYTICS_EVENTS, track } from '../../analytics';
import type {
  FoldedFigurePlacement,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureModel,
} from '../../engine/oristudioCpTypes';
import type { PaperStyleField, PaperStyleValue } from '../../lib/paper/paperStyle';
import type { LiveValue, PropertySheet } from '../../lib/propertyDescriptors';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import { usePaneGesture } from '../canvasObjects/usePaneGesture';
import {
  setFoldedFigureAppearances,
  useInheritedPaperStyle,
  useObjectPaperStyle,
  type PaperStyleOverrideEdit,
} from '../paper/objectPaperStyle';
import { isFolded3dFigure } from './foldedFigureCapabilities';
import { getFolded3dOrbit, subscribeFolded3dOrbit } from './folded3dRuntime';
import { DEFAULT_FOLDED_3D_CAMERA, type FoldedFigureCamera } from './folded3dCamera';
import { foldedFigureGesture } from './foldedFigureGesture';
import { buildFoldedFigureProperties, type FoldedFigurePropertyDeps } from './foldedFigureProperties';
import { isFoldedFigureStale } from './foldedFigureStaleness';
import {
  setFolded3dCamera,
  setFoldedFigureDisplayStyle,
  setFoldedFigurePlacementAsEntry,
  updateFoldedFigureModelAsEntry,
} from './foldedFigureVerbs';

/**
 * The folded figure's sheet, bound to the store through the verbs module, the
 * override verbs and the kernel write queue — not `useFoldedFigures`, which
 * is single-instance and needs the panel's document and selection.
 *
 * Continuous colour edits open the folded layer's bracket under the pane's
 * owner and write the figure's pin per move; the kernel model follows through
 * the paper-style mirror, whose writes go through the queue, and the
 * bracket's commit drains the queue before it records, so the one entry per
 * pick holds what the kernel drew. Every pin is counted (`paper style
 * overridden`) once per field per adjustment, never per pointer move. The
 * camera rows read the live orbit frame while a drag turns the figure and the
 * stored camera otherwise — the same rule `useFoldedFigures` applies.
 */
export function useFoldedFigureProperties(target: TargetOf<'folded-figure'>): PropertySheet {
  const { t } = useTranslation();
  const document = useWorkspaceStore((state) => state.oristudioCpDocument?.document);
  const figure = target.figure;
  const id = target.id;
  // The same test the panel runs for its stale badge, once per document revision.
  const stale = useMemo(() => isFoldedFigureStale(document, figure), [document, figure]);
  const gesture = usePaneGesture(foldedFigureGesture);
  const style = useObjectPaperStyle(figure);
  const inherited = useInheritedPaperStyle();
  const overrides = figure.appearance;
  const surface = isFolded3dFigure(figure) ? 'folded-3d' : 'folded-flat';
  // The fields counted in the gesture under way. A set held for the hook's
  // lifetime, mutated per write, never read in render.
  const [counted] = useState(() => new Set<PaperStyleField>());

  const setDisplayStyle = useCallback(
    (style: OristudioCpFoldedFigureDisplayStyle) => {
      void setFoldedFigureDisplayStyle(id, style, t);
    },
    [id, t]
  );
  const commitModel = useCallback(
    (patch: Partial<OristudioCpFoldedFigureModel>) => {
      void updateFoldedFigureModelAsEntry(id, patch, t);
    },
    [id, t]
  );
  const writeOverride = useCallback(
    <F extends PaperStyleField>(field: F, value: PaperStyleValue<F>) => {
      // Aborted underneath (an undo from the menu bar): a write now would land
      // a change no entry covers. The next move begins a fresh gesture.
      if (!gesture.isOpen()) return;
      if (!counted.has(field)) {
        counted.add(field);
        track(ANALYTICS_EVENTS.paperStyleOverridden, { surface, field, reset: false });
      }
      useWorkspaceStore.getState().setOristudioCpFoldedFigureAppearance(id, field, value);
    },
    [counted, gesture, id, surface]
  );
  const end = useCallback(
    (label: string) => {
      counted.clear();
      gesture.end(label);
    },
    [counted, gesture]
  );
  const commitOverrides = useCallback(
    (edits: readonly PaperStyleOverrideEdit[]) => {
      for (const edit of edits) {
        track(ANALYTICS_EVENTS.paperStyleOverridden, {
          surface,
          field: edit.field,
          reset: edit.value === undefined,
        });
      }
      void setFoldedFigureAppearances(id, edits);
    },
    [id, surface]
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
      end,
      commitModel,
      style,
      inherited,
      overrides,
      writeOverride,
      commitOverrides,
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
      end,
      commitModel,
      style,
      inherited,
      overrides,
      writeOverride,
      commitOverrides,
      setDisplayStyle,
      setCamera,
      liveCamera,
      setPlacement,
    ]
  );
  return useMemo(() => buildFoldedFigureProperties(target, deps), [target, deps]);
}
