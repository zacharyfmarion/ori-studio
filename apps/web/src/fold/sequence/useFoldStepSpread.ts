import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { trackFoldSpreadChanged, type FoldSpreadVia } from '../../analytics';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { shownFoldSequence } from '../../store/workspaceStore/foldState';
import { foldEffectiveSpread, foldSpreadStarts, foldStepSpread } from '../document/foldStepSpread';
import { foldStepTree, lockedIds } from '../document/foldStepTree';
import {
  foldStepSpreadControls,
  type FoldSpreadSitting,
  type FoldStepSpreadControls,
} from './foldStepSpreadControls';

/**
 * The slider drag in progress, wherever it is: one at a time. Kept here, not
 * in the controls, which each edit of the drag rebuilds.
 */
const drag: { current: FoldSpreadSitting | null } = { current: null };
let sittings = 0;

/** A new undo sitting for a drag: its number. */
function newSitting(): number {
  sittings += 1;
  return sittings;
}

/**
 * The spread step `stepId`'s folded picture shows, from the shown sequence
 * (`foldStepSpread`): the folded pane's. The default with no sequence yet,
 * which moves nothing on a flat sheet.
 */
export function useFoldStepSpreadShown(stepId: string | null): LayerSpreadOptions | null {
  return useWorkspaceStore((state) => {
    const shown = shownFoldSequence(state);
    return shown ? foldStepSpread(shown.document, stepId) : null;
  });
}

/**
 * The spread controls of step `stepId` of the shown sequence
 * (`foldStepSpreadControls`), bound to the store and counted as `via`'s:
 * the Step pane's Spread section, or the canvas bar's toggle. Null for the
 * flat sheet, a step the sequence does not hold, or no sequence.
 */
export function useFoldStepSpread(stepId: string | null, via: FoldSpreadVia): FoldStepSpreadControls | null {
  const { t } = useTranslation();
  const shown = useWorkspaceStore((state) => shownFoldSequence(state) ?? null);
  const loadId = useWorkspaceStore((state) => state.foldLoadId);
  return useMemo(() => {
    if (!shown || stepId === null) return null;
    const { document } = shown;
    const tree = foldStepTree(document.steps);
    if (!tree.byId.has(stepId)) return null;
    const hint =
      shown.readOnlyRaw !== null
        ? t('panels:fold.actions.readOnlyHint', 'Made with a newer Ori Studio: this sequence opens read-only.')
        : lockedIds(tree).has(stepId)
          ? t('panels:fold.actions.lockedHint', 'This step was made with a newer Ori Studio.')
          : undefined;
    return foldStepSpreadControls(
      { effective: foldEffectiveSpread(document, stepId), starts: foldSpreadStarts(document, stepId), hint },
      {
        t,
        set: (setting, session) =>
          useWorkspaceStore.getState().setFoldStepSpread(stepId, setting, { ...(session ? { session } : {}), loadId }),
        changed: (change, spread) => trackFoldSpreadChanged(change, via, spread),
        newSession: newSitting,
        sitting: drag,
      }
    );
  }, [shown, stepId, loadId, t, via]);
}
