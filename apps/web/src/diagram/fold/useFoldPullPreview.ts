import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import i18n from '../../i18n';
import { foldSession } from '../../store/workspaceStore/foldSession';
import { sentStep } from '../document/diagramDocument';
import { captureFoldTarget, sentFoldStep, type FoldPullPreviewRequest } from './foldPull';
import { foldPullPreviews, wantFoldPullPreview, type FoldPullPreview } from './foldPullPreviews';

/** The app's capture: from the Fold session, as the pull captures (`captureFoldTarget`), made the step a pull makes. */
async function captureFromFold(request: FoldPullPreviewRequest): Promise<FoldPullPreview> {
  const { result } = await captureFoldTarget(foldSession(), request.sequence, request.target, request.render, {
    t: i18n.t.bind(i18n),
  });
  const sent = sentFoldStep(result);
  return sent ? sentStep(sent).step : null;
}

/**
 * A From Fold… card's picture, as the step it would add
 * (`foldPullPreviews.ts`): the step; null when there is none to draw;
 * undefined while it is on its way. Asked for while `request` is given — the
 * card near the view, its state landed.
 */
export function useFoldPullPreview(request: FoldPullPreviewRequest | null): FoldPullPreview | undefined {
  const key = request?.key ?? null;
  // The request its key names: the cards are made again as the replay lands each step, the same picture another object.
  const [held, setHeld] = useState(request);
  if ((held?.key ?? null) !== key) setHeld(request);
  useEffect(() => (held ? wantFoldPullPreview(held, captureFromFold) : undefined), [held]);
  return useStore(foldPullPreviews, (snapshot) => (key === null ? undefined : snapshot.byKey.get(key)));
}
