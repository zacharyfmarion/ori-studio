import { useCallback, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { handleFileDrop } from '../commands/fileDropController';
import {
  describeDragPayload,
  dragCarriesFiles,
  isImageOnlyDrag,
  type DropTargetPolicy,
} from '../lib/fileDrop';

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

  /**
   * Whether this drag has been described to the console yet. `dragover` fires
   * continuously, so the diagnostic is once per drag, not once per event.
   */
  const describedDrag = useRef(false);

  const claimsDrag = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const transfer = event.dataTransfer;
      const view = { types: Array.from(transfer.types), items: transfer.items };
      const carriesFiles = dragCarriesFiles(view);

      if (!describedDrag.current) {
        describedDrag.current = true;
        // A declined drag leaves no other trace: no preventDefault, so no drop
        // event, so no handler and no error. This line is the only way to tell
        // "the platform reported something we did not recognize" apart from
        // "drag-and-drop is not wired up".
        console.info('[file-drop] drag seen', { policy, ...describeDragPayload(view) });
      }

      if (!carriesFiles) return false;
      return !isImageOnlyDrag(transfer.items);
    },
    [policy],
  );

  const onDragEnter = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!claimsDrag(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragActive(true);
    },
    [claimsDrag],
  );

  const onDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!claimsDrag(event)) return;
      // Without preventDefault the browser refuses the drop outright.
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    [claimsDrag],
  );

  const onDragLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!claimsDrag(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragActive(false);
    },
    [claimsDrag],
  );

  const onDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      dragDepth.current = 0;
      describedDrag.current = false;
      setDragActive(false);
      const files = Array.from(event.dataTransfer.files);
      console.info('[file-drop] drop', {
        policy,
        files: files.map((file) => `${file.name} (${file.type || 'no type'}, ${file.size}B)`),
      });
      if (files.length === 0) return;
      event.preventDefault();
      void handleFileDrop({ files, policy });
    },
    [policy],
  );

  return {
    dropTargetProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
    isDragActive,
  };
}
