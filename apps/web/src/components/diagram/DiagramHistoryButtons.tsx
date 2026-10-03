import { Redo2, Undo2 } from 'lucide-react';
import { handleMenuAction } from '../../commands/menuActions';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';
import { useWorkspaceCapabilities } from '../../store/workspaceStore/useWorkspaceCapabilities';
import { IconButton } from '../ui/IconButton';

/**
 * Undo and redo as buttons, for a coarse pointer, where the menu bar is the
 * only other way to them. In the Diagram's own headers rather than the canvas
 * pill lane, which would sit over the header (D12). Dispatched through
 * `handleMenuAction`, so they end open edits first and are counted at the
 * chokepoint like the menu items they stand for.
 */
export function DiagramHistoryButtons() {
  const coarse = useIsCoarsePointerSurface();
  const capabilities = useWorkspaceCapabilities();
  if (!coarse) return null;
  const undo = capabilities['edit.undo'];
  const redo = capabilities['edit.redo'];
  return (
    <>
      <IconButton
        size="sm"
        variant="default"
        title={undo.label}
        disabled={!undo.enabled}
        onClick={() => void handleMenuAction('edit.undo')}
      >
        <Undo2 size={15} />
      </IconButton>
      <IconButton
        size="sm"
        variant="default"
        title={redo.label}
        disabled={!redo.enabled}
        onClick={() => void handleMenuAction('edit.redo')}
      >
        <Redo2 size={15} />
      </IconButton>
    </>
  );
}
