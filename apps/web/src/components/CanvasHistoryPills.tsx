import { Redo2, Undo2 } from 'lucide-react';
import { handleMenuAction } from '../commands/menuActions';
import { useCanvasHistoryPills } from '../hooks/useCanvasHistoryPills';
import { IconButton } from './ui/IconButton';

/**
 * Undo and redo, in the canvas pill lane.
 *
 * On touch the only route to them was the Edit menu, which on a phone is a
 * truncated trigger in a scrolling toolbar — three taps for the verb a drawing
 * app reaches for most. A tablet has the same problem with fewer taps: the menu
 * bar is still the only place either verb appears.
 *
 * Dispatched through `handleMenuAction`, which is the analytics chokepoint — so
 * these are captured already and must not also `track()` (see docs/analytics.md).
 * It is also what keeps one implementation behind the menu item, the keyboard
 * chord and this button.
 *
 * Two pills rather than one segmented control: they are two verbs, they disable
 * independently, and the lane already reads as a row of separate pills.
 */
export function CanvasHistoryPills() {
  const { actions } = useCanvasHistoryPills();
  if (!actions) return null;

  return (
    <>
      <IconButton
        size="md"
        variant="toolbar"
        className="canvas-pill"
        title={actions.undo.label}
        tooltipSide="bottom"
        disabled={!actions.undo.enabled}
        onClick={() => void handleMenuAction('edit.undo')}
      >
        <Undo2 size={17} />
      </IconButton>
      <IconButton
        size="md"
        variant="toolbar"
        className="canvas-pill"
        title={actions.redo.label}
        tooltipSide="bottom"
        disabled={!actions.redo.enabled}
        onClick={() => void handleMenuAction('edit.redo')}
      >
        <Redo2 size={17} />
      </IconButton>
    </>
  );
}
