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

  const update = useCallback(
    (patch: AnnotationUpdate) => {
      // Aborted underneath (an undo from the menu bar): writing now would land
      // a change no entry covers. The next move begins a fresh gesture.
      if (!gesture.isOpen()) return;
      updateAnnotation(id, patch);
    },
    [gesture, id, updateAnnotation]
  );
  const commit = useCallback(
    (patch: AnnotationUpdate, label: string) => updateAnnotationAsEntry(id, patch, label),
    [id]
  );

  return useMemo(
    () => ({ t, held: gesture.held, begin: gesture.begin, update, end: gesture.end, commit }),
    [t, gesture.held, gesture.begin, gesture.end, update, commit]
  );
}
