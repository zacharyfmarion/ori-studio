import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { dragCarriesFiles, isImageOnlyDrag, type DropTargetPolicy } from '../../lib/fileDrop';
import { pickedFileFromFile } from '../../platform/fileService';
import { foldImportFormatOf } from './foldImportFiles';
import { useFoldImportUiStore } from './foldImportUiStore';

/** The Fold workspace's drop policy: a crease pattern becomes a step; anything else is the app's. */
export const FOLD_DROP_POLICY: DropTargetPolicy = 'import-crease-pattern';

export interface FoldDrop {
  /** Spread on the Fold panel, which also wears `file-drop-region`. */
  dropTargetProps: {
    onDragEnter: (event: ReactDragEvent<HTMLElement>) => void;
    onDragOver: (event: ReactDragEvent<HTMLElement>) => void;
    onDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
    onDrop: (event: ReactDragEvent<HTMLElement>) => void;
  };
  /** A file drag is over the workspace: show `FileDropOverlay` with {@link FOLD_DROP_POLICY}. */
  isDragActive: boolean;
}

/**
 * Crease patterns dropped anywhere on the Fold workspace (plan D14, D16) —
 * its panes, its step strip or its header: Import CP, each a step after the
 * one before, starting after the step on screen, in the order of the numbers
 * in their names, through the import dialog — which reads each file, offers
 * its layer orders and says why one is refused (`foldImportQueue`). One
 * target for the whole panel, so a file means the same a few pixels either
 * side of the strip's edge.
 *
 * It claims every file drag that is not only pictures, and keeps its enter,
 * over and leave to itself, so the app's own target never shows its "open or
 * import" overlay over Fold: during a drag the browser withholds the files,
 * and a crease pattern has no MIME type to tell it by. On the drop the files
 * are known. The crease patterns among them are imported, anything else left
 * out, and the drop consumed; a drop with none — a project, a tree — goes on
 * to the app's target, which opens it as it would anywhere.
 */
export function useFoldDrop(): FoldDrop {
  const [isDragActive, setDragActive] = useState(false);
  /** Nested enter/leave pairs: moving onto a child fires leave, then enter. */
  const depth = useRef(0);

  const onDragEnter = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!claims(event)) return;
    event.preventDefault();
    event.stopPropagation();
    depth.current += 1;
    setDragActive(true);
  }, []);

  const onDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!claims(event)) return;
    // Without preventDefault the browser refuses the drop outright.
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!claims(event)) return;
    event.stopPropagation();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragActive(false);
  }, []);

  // A drop or a cancelled drag ends it wherever it lands; there is no leave after either.
  useEffect(() => {
    if (!isDragActive) return undefined;
    const reset = () => {
      depth.current = 0;
      setDragActive(false);
    };
    window.addEventListener('drop', reset, true);
    window.addEventListener('dragend', reset, true);
    return () => {
      window.removeEventListener('drop', reset, true);
      window.removeEventListener('dragend', reset, true);
    };
  }, [isDragActive]);

  const onDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    depth.current = 0;
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files);
    // No crease pattern among them: the workspace's target, further up, opens it.
    if (!files.some((each) => foldImportFormatOf(each.name) !== null)) return;
    event.preventDefault();
    event.stopPropagation();
    // Each read when its turn comes; the queue keeps the crease patterns, by name.
    useFoldImportUiStore.getState().openFiles(files.map(pickedFileFromFile));
  }, []);

  return { dropTargetProps: { onDragEnter, onDragOver, onDragLeave, onDrop }, isDragActive };
}

/** A file drag that is not only pictures: the workspace target's own test, so the two agree. */
function claims(event: ReactDragEvent<HTMLElement>): boolean {
  const transfer = event.dataTransfer;
  return (
    dragCarriesFiles({ types: Array.from(transfer.types), items: transfer.items }) &&
    !isImageOnlyDrag(transfer.items)
  );
}
