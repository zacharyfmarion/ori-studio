import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { usePaneGesture } from '../canvasObjects/usePaneGesture';
import type { AnnotationUpdate } from './annotation';
import { annotationGesture } from './annotationGesture';
import { updateAnnotationAsEntry } from './annotationVerbs';

/**
 * What every annotation kind's sheet needs from the store: the translator,
 * the layer's bracket state, and the two write shapes — a continuous one for
 * sliders and pickers (many writes inside one bracket) and a discrete one for
 * everything else (one write as one entry). Images, text boxes and regions
 * share the annotation list and so share this.
 */
export interface AnnotationPaneDeps {
  t: TFunction;
  /** True while another surface holds the annotation layer's bracket. */
  held: boolean;
  /** Open the layer's bracket for a continuous field; false when refused. */
  begin(field: string): boolean;
  /** Write the store inside an open bracket; records nothing. */
  update(patch: AnnotationUpdate): void;
  /** Close the bracket and record `label` once. */
  end(label: string): void;
  /** One discrete edit as one entry. */
  commit(patch: AnnotationUpdate, label: string): void;
  /**
   * The same two writes, addressed to another annotation on the layer — a
   * region's owned reference image. One bracket, one entry: the layer is one
   * list, so a write to the image inside the region's gesture is the same
   * gesture.
   */
  updateById(id: string, patch: AnnotationUpdate): void;
  commitById(id: string, patch: AnnotationUpdate, label: string): void;
}

/**
 * Bound to the annotation `id`, without mounting `useCpAnnotations` — that
 * hook needs the panel's overlay view and viewport ref and owns
 * single-instance effects. The continuous protocol goes through
 * {@link usePaneGesture}; the discrete one through the verbs module, which is
 * the implementation the canvas and the context menu use.
 */
export function useAnnotationPaneDeps(id: string): AnnotationPaneDeps {
  const { t } = useTranslation();
  const updateAnnotation = useWorkspaceStore((state) => state.updateAnnotation);
  const gesture = usePaneGesture(annotationGesture);

  const updateById = useCallback(
    (targetId: string, patch: AnnotationUpdate) => {
      // Aborted underneath (an undo from the menu bar): writing now would land
      // a change no entry covers. The next move begins a fresh gesture.
      if (!gesture.isOpen()) return;
      updateAnnotation(targetId, patch);
    },
    [gesture, updateAnnotation]
  );
  const update = useCallback(
    (patch: AnnotationUpdate) => updateById(id, patch),
    [updateById, id]
  );
  const commitById = useCallback(
    (targetId: string, patch: AnnotationUpdate, label: string) =>
      updateAnnotationAsEntry(targetId, patch, label),
    []
  );
  const commit = useCallback(
    (patch: AnnotationUpdate, label: string) => commitById(id, patch, label),
    [commitById, id]
  );

  return useMemo(
    () => ({
      t,
      held: gesture.held,
      begin: gesture.begin,
      update,
      end: gesture.end,
      commit,
      updateById,
      commitById,
    }),
    [t, gesture.held, gesture.begin, gesture.end, update, commit, updateById, commitById]
  );
}
