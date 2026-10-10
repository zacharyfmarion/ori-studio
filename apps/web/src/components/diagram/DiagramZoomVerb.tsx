import type { ZoomAction } from '../../diagram/zoom/zoomActions';
import { Button } from '../ui/Button';

/**
 * One of an enlargement's verbs, or an anchor's (Revision 2): a button that
 * refuses, keeping the focus, when it cannot act or is waiting on its own work
 * (Update folding faces), and says why. An enlargement's controls and the
 * Anchor row (`DiagramAnchorRow`) both show them.
 */
export function DiagramZoomVerb({ action }: { action: ZoomAction }) {
  const held = action.disabled || action.waiting === true;
  return (
    <Button
      size="sm"
      // A toggle that is on (Pick, while the canvas asks for a face) wears the pressed look.
      variant={action.pressed ? 'secondary' : 'ghost'}
      isActive={action.pressed}
      title={action.hint}
      aria-disabled={held || undefined}
      aria-busy={action.waiting || undefined}
      aria-pressed={action.pressed}
      data-zoom-action={action.id}
      onClick={() => {
        if (!held) action.run();
      }}
    >
      {action.label}
    </Button>
  );
}
