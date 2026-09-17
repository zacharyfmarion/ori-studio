import type { ReactNode } from 'react';
import { useIsCoarsePointerSurface } from '../platform/pointerSurface';

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

  // Nothing at all under a fine pointer, and not merely nothing *visible*: every
  // rule that shapes this lives in the coarse-pointer layer, so an unstyled
  // `.canvas-pill-lane` would be an ordinary block and would take a grid row of
  // the canvas — pushing the dock down by however tall its pills are.
  if (!coarsePointer) return null;

  // No chrome to clear: the workspaces whose panes open with a toolbar
  // (Simulate, References) seat the View pill in that toolbar themselves
  // (`viewDrawerSlot`) rather than in the lane.
  return (
    <div className="canvas-pill-lane">
      <div className="canvas-pill-lane__row">{children}</div>
    </div>
  );
}
