import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { track } from '../../analytics';
import { ANALYTICS_EVENTS, cpDetectScoreBucket } from '../../analytics/events';
import { openCpDetectWithCanvasImage } from '../../lib/cpDetectEntry';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { isImageAnnotation } from '../annotations/annotation';
import type { CpImage } from './cpImage';
import { useCpDetectSuggestionStore, type CpDetectSuggestion } from './cpDetectSuggestionStore';

/** After this many × presses in a session, say once where the switch is. */
export const CP_DETECT_SUGGESTION_TOAST_AT = 3;

export interface CpDetectSuggestionView {
  image: CpImage;
  suggestion: CpDetectSuggestion;
}

export interface UseCpDetectSuggestions {
  /** Images on the canvas that scored as likely and whose offer is still open. */
  suggestions: CpDetectSuggestionView[];
  /** Detect creases: hand the image to the dialog and hide the pill meanwhile. */
  acceptSuggestion: (id: string) => void;
  /** Not now: retire the offer for this image. */
  dismissSuggestion: (id: string) => void;
}

/**
 * Every binding the suggestion pills need, in one place — the panel mounts
 * the layer and nothing else.
 *
 * The join is by annotation id against the live annotation list, so a pill
 * disappears the moment its image does (delete, undo of the add) and comes back
 * with a redo, without the store having to watch the document.
 */
export function useCpDetectSuggestions(): UseCpDetectSuggestions {
  const { t } = useTranslation();
  const annotations = useWorkspaceStore((state) => state.oristudioCpAnnotations);
  const entries = useCpDetectSuggestionStore((state) => state.suggestions);
  const setSuggestionState = useCpDetectSuggestionStore((state) => state.setSuggestionState);
  const countDismissal = useCpDetectSuggestionStore((state) => state.countDismissal);

  const suggestions = useMemo(() => {
    const views: CpDetectSuggestionView[] = [];
    for (const annotation of annotations) {
      if (!isImageAnnotation(annotation)) continue;
      const suggestion = entries[annotation.id];
      if (suggestion && suggestion.likely && suggestion.state === 'pending') {
        views.push({ image: annotation, suggestion });
      }
    }
    return views;
  }, [annotations, entries]);

  const acceptSuggestion = useCallback(
    (id: string) => {
      const image = useWorkspaceStore
        .getState()
        .oristudioCpAnnotations.find((annotation) => annotation.id === id);
      const suggestion = useCpDetectSuggestionStore.getState().suggestions[id];
      if (!image || !isImageAnnotation(image) || !suggestion) return;
      setSuggestionState(id, 'open');
      track(ANALYTICS_EVENTS.cpDetectSuggestionAccepted, {
        score_bucket: cpDetectScoreBucket(suggestion.score),
      });
      openCpDetectWithCanvasImage({
        source: 'canvas-suggestion',
        annotationId: id,
        image: {
          src: image.src,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          crop: { ...image.crop },
        },
      });
    },
    [setSuggestionState]
  );

  const dismissSuggestion = useCallback(
    (id: string) => {
      const suggestion = useCpDetectSuggestionStore.getState().suggestions[id];
      if (!suggestion) return;
      setSuggestionState(id, 'dismissed');
      const dismissals = countDismissal();
      track(ANALYTICS_EVENTS.cpDetectSuggestionDismissed, {
        score_bucket: cpDetectScoreBucket(suggestion.score),
        dismissals_bucket: dismissals >= CP_DETECT_SUGGESTION_TOAST_AT ? `>=${CP_DETECT_SUGGESTION_TOAST_AT}` : String(dismissals),
      });
      // Exactly once: the third × is the point where "not this one" starts to
      // read as "not ever", and a 28 px pill has no room for a switch.
      if (dismissals === CP_DETECT_SUGGESTION_TOAST_AT) {
        toast(
          t(
            'toasts:cpDetectSuggestion.turnOff',
            'You can turn off these suggestions in Settings ▸ General ▸ Models.'
          ),
          { duration: 6000 }
        );
      }
    },
    [countDismissal, setSuggestionState, t]
  );

  return { suggestions, acceptSuggestion, dismissSuggestion };
}
