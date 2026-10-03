/**
 * Whether the Diagram's export dialog is open (`file.exportDiagram`).
 *
 * Its own store, as the paper export's is: the command-dialog host holds one
 * dialog at a time and answers a second request by cancelling the first. The
 * dialog exports the diagram as it is when it opens; nothing edits it while
 * the dialog is up.
 */
import { create } from 'zustand';

export interface DiagramExportRequest {
  /** Distinguishes one opening from the next, so the dialog starts fresh each time. */
  id: number;
  /** Where focus goes back to when the dialog closes. */
  returnFocus: HTMLElement | null;
}

interface DiagramExportUiState {
  request: DiagramExportRequest | null;
  open: (returnFocus: HTMLElement | null) => void;
  /**
   * Close the dialog only if it is still the one opened as `id`: a save that
   * finishes after its dialog was replaced must not close the newer one.
   */
  closeRequest: (id: number) => void;
}

let nextRequestId = 1;

export const useDiagramExportUiStore = create<DiagramExportUiState>()((set, get) => ({
  request: null,
  open: (returnFocus) => set({ request: { id: nextRequestId++, returnFocus } }),
  closeRequest: (id) => {
    if (get().request?.id === id) set({ request: null });
  },
}));
