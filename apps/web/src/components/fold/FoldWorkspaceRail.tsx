import { useFoldRailGroups } from '../../fold/canvas/useFoldRailGroups';
import { useFoldShortcutLabels } from '../../fold/tools/useFoldShortcutLabels';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';
import { FoldAltLatchToggle } from './canvas/FoldAltLatchToggle';
import { FoldToolRail } from './FoldToolRail';

/**
 * The Fold tools down the whole left of the workspace, as Edit's rail runs
 * down its: `FoldToolRail` bound to the tools (`useFoldRailGroups`) and to the
 * user's keys, with a touch tablet's free-point latch at its head. The panel
 * seats it beside the header, the strip and the canvas — and beside the Steps
 * view, where a press opens the canvas with the tool in hand. A phone has no
 * rail: its tools are the header's Tools sheet (`FoldToolsTrigger`) and its
 * starred ones the canvas's bar (`useFoldPhoneBarGroups`).
 */
export function FoldWorkspaceRail() {
  const groups = useFoldRailGroups();
  const { keyLabel } = useFoldShortcutLabels();
  const coarse = useIsCoarsePointerSurface();
  return <FoldToolRail groups={groups} keyLabel={keyLabel} header={coarse ? <FoldAltLatchToggle fill /> : undefined} />;
}
