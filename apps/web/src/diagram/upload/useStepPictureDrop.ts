import { useCallback, useState, type DragEvent as ReactDragEvent } from 'react';
import { toast } from 'sonner';
import i18n from '../../i18n';
import { classifyDroppedFile, dragCarriesFiles, dragCarriesImage } from '../../lib/fileDrop';
import { pickedFileFromFile } from '../../platform/fileService';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { addStepPictures } from './addStepPictures';

/** The drop is over the Diagram but not over a card. */
export const GRID_DROP_TARGET = 'grid';

/**
 * Pictures dropped on the Diagram (D7), wherever on it: the header, the steps,
 * the step detail. The Diagram claims image drops itself, the way the
 * crease-pattern canvas does: the workspace's own target would offer to open
 * the file as a project, and refuse a picture as one for the crease pattern.
 *
 * It claims any file drag that carries a picture, among whatever else, and
 * keeps its enter, over and leave to itself, so the workspace target never
 * counts the drag (and never shows an overlay a consumed drop would leave
 * behind). A drag with no picture in it is left alone, so a project dropped
 * here still opens.
 *
 * A drop on a card selects it first, so the insertion rule reads "here": one
 * picture onto a card with none fills it, and anything else goes in after it.
 * A drop anywhere else follows the rule from the current selection. A
 * read-only diagram still claims the drop, and says why it takes nothing.
 *
 * `dropTarget` is where the drop would land, for the view to show: a step's
 * id, {@link GRID_DROP_TARGET}, or null.
 */
export function useStepPictureDrop(): {
  dropTarget: string | null;
  onDragEnter: (event: ReactDragEvent<HTMLElement>) => void;
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  onDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLElement>) => void;
} {
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const onDragEnter = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!claims(event)) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const onDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!claims(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const readOnly = useWorkspaceStore.getState().diagramReadOnly;
    event.dataTransfer.dropEffect = readOnly ? 'none' : 'copy';
    const next = readOnly ? null : (cardUnder(event.target)?.dataset.stepId ?? GRID_DROP_TARGET);
    setDropTarget((current) => (current === next ? current : next));
  }, []);

  const onDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!claims(event)) return;
    event.stopPropagation();
    const into = event.relatedTarget;
    if (!(into instanceof Node) || !event.currentTarget.contains(into)) setDropTarget(null);
  }, []);

  const onDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    setDropTarget(null);
    const files = Array.from(event.dataTransfer.files);
    if (!files.some((file) => classifyDroppedFile(file).kind === 'image')) return;
    event.preventDefault();
    // Consumed here: the workspace target must not also open it.
    event.stopPropagation();
    const store = useWorkspaceStore.getState();
    if (store.diagramReadOnly) {
      toast.message(
        i18n.t(
          'toasts:diagram.dropReadOnly',
          'This diagram was made with a newer Ori Studio and opens read-only, so pictures can’t be added to it.'
        )
      );
      return;
    }
    const stepId = cardUnder(event.target)?.dataset.stepId;
    if (stepId) store.selectDiagramStep(stepId);
    void addStepPictures(files.map(pickedFileFromFile), {
      via: 'drop',
      anchorStepId: stepId ?? store.diagramSelectedStepId,
    });
  }, []);

  return { dropTarget, onDragEnter, onDragOver, onDragLeave, onDrop };
}

/**
 * A file drag with a picture in it. The workspace target's own file test
 * first, so the two never disagree about what a file drag is — a disagreement
 * fails silently, with no drop event at all.
 */
function claims(event: ReactDragEvent<HTMLElement>): boolean {
  const transfer = event.dataTransfer;
  return (
    dragCarriesFiles({ types: Array.from(transfer.types), items: transfer.items }) &&
    dragCarriesImage(transfer.items)
  );
}

function cardUnder(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-step-id]') : null;
}
