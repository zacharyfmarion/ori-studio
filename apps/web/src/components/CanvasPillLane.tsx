import type { ReactNode } from 'react';
import { useIsCoarsePointerSurface } from '../platform/pointerSurface';
import { useLayoutStore, viewPanelFor } from '../store/layoutStore';

/**
 * The row of pills floating over the canvas's top-right corner, on touch.
 *
 * It is where a control goes when the touch layout has taken away the place it
 * used to dock: the View pane (`WorkspaceViewDrawer`), the tool rail
 * (`CpToolsTrigger`), the design pane split (`DesignPaneSwitcher`), and the
 * undo/redo the menu bar makes a three-tap journey (`CanvasHistoryPills`).
 *
 * A shared lane rather than each control positioning itself. "Left of View"
 * needs View's rendered width, which changes with the locale (View / Ansicht /
 * Вид), and boxes insetting from the same corner would each have to know a
 * number none of them owns. One flex row, and the row owns the inset.
 *
 * Mounted by `WorkspaceShell` inside `.workspace-shell__canvas`, which is column
 * 2 row 2 of the shell grid — so "over the content, never over the menu bar" is
 * a fact about where it sits rather than a z-index that has to keep winning.
 * Mounting it inside a dock panel instead would mean one copy per workspace and
 * would put shell chrome in a composition site.
 *
 * Order in the row is DOM order, so it is `WorkspaceShell` that decides what
 * sits left of what.
 */
export function CanvasPillLane({ children }: { children: ReactNode }) {
  const coarsePointer = useIsCoarsePointerSurface();
  const activeWorkspace = useLayoutStore((state) => state.activeWorkspace);

  // Nothing at all under a fine pointer, and not merely nothing *visible*: every
  // rule that shapes this lives in the coarse-pointer layer, so an unstyled
  // `.canvas-pill-lane` would be an ordinary block and would take a grid row of
  // the canvas — pushing the dock down by however tall its pills are.
  if (!coarsePointer) return null;

  // Which pane's chrome the lane has to clear, which is a question about the
  // workspace rather than about any one pill: Simulate opens with a
  // `.panel-toolbar` whose right end already holds controls, and the lane drops
  // below it. Read here rather than passed in, so a workspace with no View pane
  // (Design) still gets a lane for its other pills.
  const viewPanel = viewPanelFor(activeWorkspace);

  return (
    <div className="canvas-pill-lane" data-view-panel={viewPanel?.id}>
      <div className="canvas-pill-lane__row">{children}</div>
    </div>
  );
}
