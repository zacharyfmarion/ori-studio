import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { altModifierLabel, primaryModifierLabel } from '../../lib/platform';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { isKnownAnnotation, type DiagramStep } from '../document/diagramDocument';
import { annotateToolHint, type AnnotateToolHint } from './annotateTools';
import { usePickProgress, useToolNotice } from './pickProgress';
import { useAnnotateToolInHand } from './useAnnotateToolInHand';

/**
 * What the tool window says for the tool in hand on `step`, in this device's
 * terms: the keys by the platform's names, and none for a finger. Null with
 * Select in hand, which has no window.
 *
 * Edit Path's line depends on what is selected, by kind only, so a drag that
 * reshapes the selected arrow does not rebuild it on every move. A pick
 * tool's says what its next press is for (15b); a drawing tool's, what its
 * last press could not do, until the next (Revision 2).
 */
export function useAnnotateToolHint(step: DiagramStep): AnnotateToolHint | null {
  const { t } = useTranslation();
  const coarse = useIsCoarsePointerSurface();
  const tool = useAnnotateToolInHand(step);
  const circleMode = useSettingsStore((state) => state.diagramAnnotateCircleMode);
  const selectedId = useWorkspaceStore((state) => state.diagramSelectedAnnotationId);
  const selected = step.annotations.find((annotation) => annotation.id === selectedId);
  const selectedKind = selected && isKnownAnnotation(selected) ? selected.kind : null;
  const progress = usePickProgress();
  const notice = useToolNotice();
  return useMemo(
    () =>
      annotateToolHint(
        t,
        tool,
        selectedKind,
        { coarse, primary: primaryModifierLabel(), alt: altModifierLabel() },
        progress,
        notice,
        circleMode
      ),
    [t, tool, selectedKind, coarse, progress, notice, circleMode]
  );
}
