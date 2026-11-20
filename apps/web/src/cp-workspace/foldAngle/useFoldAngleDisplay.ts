import {
  DEFAULT_ORISTUDIO_CP_FOLD_ANGLE_DISPLAY,
  type OristudioCpFoldAngleDisplay,
} from '../../lib/creasePatternViewport';
import { useWorkspaceStore } from '../../store/workspaceStore';

/**
 * Which channel a crease folded short of 180° spends on its angle — the View
 * panel's Fold angle style — for a surface that draws the pattern outside
 * Edit's canvas and should shade it the way the canvas does.
 */
export function useFoldAngleDisplay(): OristudioCpFoldAngleDisplay {
  return useWorkspaceStore(
    (state) => state.oristudioCpViewport.foldAngleDisplay ?? DEFAULT_ORISTUDIO_CP_FOLD_ANGLE_DISPLAY
  );
}
