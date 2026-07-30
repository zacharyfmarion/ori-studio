import { useCallback, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { handleFileDrop } from '../commands/fileDropController';
import { dragCarriesFiles, isImageOnlyDrag, type DropTargetPolicy } from '../lib/fileDrop';

export interface UseFileDropTargetOptions {
  policy: DropTargetPolicy;
}

export interface FileDropTargetProps {
  onDragEnter: (event: ReactDragEvent<HTMLElement>) => void;
  onDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  onDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLElement>) => void;
}

export interface FileDropTarget {
  dropTargetProps: FileDropTargetProps;
  /** True while a droppable file drag is over this target. */
  isDragActive: boolean;
}

/**
 * Make an element accept dropped documents.
 *
 * Ordering between nested targets is ordinary event bubbling: the crease-pattern
 * viewport consumes image drops and stops propagation, so anything it does not
 * take reaches the workspace target above it.
 *
 * Two things this deliberately does not do:
 *
 * - React to drags that carry no files. Dockview's panel drags and ordinary text
 *   drags are in-page, and treating them as ours would break them.
 * - Claim image-only drags. During `dragover` the browser withholds
 *   `dataTransfer.files`, so the only readable signal is each item's MIME type —
 *   enough to tell an image drag from a document drag, but not enough to know
 *   which document. So the affordance stays silent for images (the viewport
 *   handles those) and stays generic for documents; the file is not named until
 *   it is actually dropped.
 */
export function useFileDropTarget({ policy }: UseFileDropTargetOptions): FileDropTarget {
  const [isDragActive, setDragActive] = useState(false);
  /**
   * Depth of nested dragenter/dragleave pairs. Moving the cursor onto a child
   * fires leave-then-enter, so a plain boolean would flicker the overlay off.
   */
  const dragDepth = useRef(0);

  const claimsDrag = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const transfer = event.dataTransfer;
    if (!dragCarriesFiles(Array.from(transfer.types))) return false;
    return !isImageOnlyDrag(transfer.items);
  }, []);

  const onDragEnter = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!claimsDrag(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragActive(true);
    },
    [claimsDrag]
  );

  const onDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!claimsDrag(event)) return;
      // Without preventDefault the browser refuses the drop outright.
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    [claimsDrag]
  );

  const onDragLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!claimsDrag(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragActive(false);
    },
    [claimsDrag]
  );

  const onDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      dragDepth.current = 0;
      setDragActive(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) return;
      event.preventDefault();
      void handleFileDrop({ files, policy });
    },
    [policy]
  );

  return {
    dropTargetProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
    isDragActive,
  };
}
