import { useCallback, useState, type DragEvent as ReactDragEvent } from 'react';
import { classifyDroppedFile, dragCarriesFiles, isImageOnlyDrag } from '../../lib/fileDrop';
import { pickedFileFromFile } from '../../platform/fileService';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { addStepPictures } from './addStepPictures';

/** The drop is over the space between cards rather than over one. */
export const GRID_DROP_TARGET = 'grid';

/**
 * Pictures dropped on the Steps grid (D7). The Diagram claims image drops
 * itself, the way the crease-pattern canvas does: the workspace's own target
 * would offer to open the file as a project, which is wrong here.
 *
 * A drop on a card selects it first, so the insertion rule reads "here": one
 * picture onto a card with none fills it, and anything else goes in after it.
 * A drop between cards follows the rule from the current selection. A drop
 * with no picture in it is left to bubble, so a project dropped here still
 * opens.
 *
 * `dropTarget` is where the drop would land, for the grid to show: a step's id,
 * {@link GRID_DROP_TARGET}, or null.
 */
export function useStepPictureDrop(): {
  dropTarget: string | null;
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  onDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLElement>) => void;
} {
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const onDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (useWorkspaceStore.getState().diagramReadOnly) return;
    const transfer = event.dataTransfer;
    // The workspace target's own test, so the two never disagree about what a
    // file drag is — a disagreement fails silently, with no drop event at all.
    if (!dragCarriesFiles({ types: Array.from(transfer.types), items: transfer.items })) return;
    if (!isImageOnlyDrag(transfer.items)) return;
    event.preventDefault();
    transfer.dropEffect = 'copy';
    const next = cardUnder(event.target)?.dataset.stepId ?? GRID_DROP_TARGET;
    setDropTarget((current) => (current === next ? current : next));
  }, []);

  const onDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const into = event.relatedTarget;
    if (!(into instanceof Node) || !event.currentTarget.contains(into)) setDropTarget(null);
  }, []);

  const onDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    setDropTarget(null);
    const store = useWorkspaceStore.getState();
    if (store.diagramReadOnly) return;
    const files = Array.from(event.dataTransfer.files);
    if (!files.some((file) => classifyDroppedFile(file).kind === 'image')) return;
    event.preventDefault();
    // Consumed here: the workspace target must not also open it.
    event.stopPropagation();
    const stepId = cardUnder(event.target)?.dataset.stepId;
    if (stepId) store.selectDiagramStep(stepId);
    void addStepPictures(files.map(pickedFileFromFile), {
      via: 'drop',
      anchorStepId: stepId ?? store.diagramSelectedStepId,
    });
  }, []);

  return { dropTarget, onDragOver, onDragLeave, onDrop };
}

function cardUnder(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-step-id]') : null;
}
