import { useMemo } from 'react';
import type { FoldPendingCreases } from '../canvas/foldPaneScenes';
import type { FoldLandedPreview } from '../canvas/useFoldToolPreview';
import { FOLD_SCENE_QUERY } from '../session/foldStateQueries';
import { useFoldCursor, useFoldStateQuery } from '../session/useFoldSession';
import { repeatPreviewCreases } from './repeatCanvas';

/**
 * The creases Repeat's preview adds, for the folded pane to draw in the
 * diagram pens while the result is on show (`repeatPreviewCreases`): lettered
 * as the step on screen shows the paper they are made on. Null while no
 * repeat's preview has landed (`landed`, null for every other tool).
 */
export function useFoldRepeatCreases(landed: FoldLandedPreview | null): FoldPendingCreases | null {
  const cursor = useFoldCursor();
  const before = useFoldStateQuery(landed ? cursor.state : null, FOLD_SCENE_QUERY);
  return useMemo(() => (landed ? repeatPreviewCreases(landed.scene, landed.added, before) : null), [landed, before]);
}
