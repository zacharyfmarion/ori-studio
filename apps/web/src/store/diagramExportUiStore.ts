/**
 * Whether the Diagram's export dialog is open (`file.exportDiagram`).
 *
 * Its own store, as the paper export's is: the command-dialog host holds one
 * dialog at a time and answers a second request by cancelling the first. The
 * dialog exports the diagram as it is when it opens. A request belongs to the
 * diagram it was opened on (its load), so one that outlives it — a project
 * opened from the desktop's menu bar while the dialog is up, an Undo back to
 * no diagram — is closed rather than reopened later on another
 * (`DiagramExportModal`).
 */
import { create } from 'zustand';

export interface DiagramExportRequest {
  /** Distinguishes one opening from the next, so the dialog starts fresh each time. */
  id: number;
  /** Where focus goes back to when the dialog closes. */
  returnFocus: HTMLElement | null;
  /** The `diagramLoadId` of the diagram it exports. */
  loadId: number;
}

interface DiagramExportUiState {
  request: DiagramExportRequest | null;
  open: (returnFocus: HTMLElement | null, loadId: number) => void;
  /**
   * Close the dialog only if it is still the one opened as `id`: a save that
   * finishes after its dialog was replaced must not close the newer one.
   */
  closeRequest: (id: number) => void;
}

let nextRequestId = 1;

export const useDiagramExportUiStore = create<DiagramExportUiState>()((set, get) => ({
  request: null,
  open: (returnFocus, loadId) => set({ request: { id: nextRequestId++, returnFocus, loadId } }),
  closeRequest: (id) => {
    if (get().request?.id === id) set({ request: null });
  },
}));
