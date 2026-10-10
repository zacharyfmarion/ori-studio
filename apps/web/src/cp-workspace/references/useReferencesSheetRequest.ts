import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { ReferencesSheetRequest } from '../../store/workspaceStore/types';
import { boundariesMatch } from '../regions/regionReference';
import type { ReferencesMode } from './referencesMode';
import type { SheetAnalysis } from './sheetFrames';
import type { ReferencesModeSource } from './useReferencesMode';

/**
 * Open on the sheet asked for from outside — a diagram step's Open in
 * References (D6) — once the panel knows its sheets: the one whose rim is
 * the step's, in the mode it was sent from, and on the step's own card once
 * the sheet's plan is on screen (`referencesCardRequest`).
 *
 * Taken, not watched: the request is latched in the store because the panel
 * is not mounted when it is made, and taking it once is what keeps a remount
 * from opening the same sheet again over the reader's own choice. A sheet
 * that is no longer in the pattern is said so, and the panel stays where it
 * is.
 */
export function useReferencesSheetRequest(
  frames: SheetAnalysis | null,
  /** Make the sheet the workspace's and show it: on a phone, its detail rather than the list. */
  showSheet: (component: number) => void,
  setMode: (mode: ReferencesMode, source?: ReferencesModeSource) => void
): void {
  const { t } = useTranslation();
  const pending = useWorkspaceStore((state) => state.referencesSheetRequest !== null);
  const requestCard = useWorkspaceStore((state) => state.requestReferencesCard);
  useEffect(() => {
    if (!pending || !frames) return;
    const request = useWorkspaceStore.getState().takeReferencesSheetRequest();
    if (!request) return;
    const sheet = requestedSheet(frames, request.boundary);
    if (!sheet) {
      toast.error(t('toasts:references.sheetMissing', 'That sheet isn’t in the crease pattern any more.'));
      return;
    }
    // A sheet switch puts the workspace back in Find, so the mode comes after it.
    showSheet(sheet.id);
    setMode(request.mode, 'diagram');
    // After the switch, which drops any card asked for on another sheet.
    if (request.card) requestCard(sheet.id, request.card);
  }, [pending, frames, showSheet, setMode, requestCard, t]);
}

/** The sheet whose rim is `boundary`, or undefined when none is. */
export function requestedSheet(
  frames: SheetAnalysis,
  boundary: ReferencesSheetRequest['boundary']
): SheetAnalysis['components'][number] | undefined {
  return frames.components.find((component) =>
    boundariesMatch([component.outline.map(([x, y]) => ({ x, y }))], boundary)
  );
}
