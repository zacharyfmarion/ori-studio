import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { dragCarriesFiles, isImageOnlyDrag, type DropTargetPolicy } from '../../lib/fileDrop';
import { foldImportFileSource, foldImportFormatOf } from './foldImportFiles';
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
 * its panes, its step strip or its header: Import CP, as a
 * step after the step on screen, through the import dialog — which reads the
 * file, offers its layer orders and says why one is refused. One target for
 * the whole panel, so a file means the same a few pixels either side of the
 * strip's edge.
 *
 * It claims every file drag that is not only pictures, and keeps its enter,
 * over and leave to itself, so the app's own target never shows its "open or
 * import" overlay over Fold: during a drag the browser withholds the files,
 * and a crease pattern has no MIME type to tell it by. On the drop the files
 * are known. The first crease pattern among them is imported and the drop
 * consumed; a drop with none — a project, a tree — goes on to the app's
 * target, which opens it as it would anywhere.
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
    const file = Array.from(event.dataTransfer.files).find((each) => foldImportFormatOf(each.name) !== null);
    // Not a crease pattern: the workspace's target, further up, opens it.
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    void importDroppedFile(file);
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

/** Open Import CP on a dropped file, read whole: the engine's loader takes its bytes. */
async function importDroppedFile(file: File): Promise<void> {
  const open = useFoldImportUiStore.getState().open;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    // Unread, it is no source; the dialog says the file could not be read.
    open({ kind: 'file', name: file.name, source: null, unreadable: true });
    return;
  }
  open({ kind: 'file', name: file.name, source: foldImportFileSource(file.name, bytes) });
}
