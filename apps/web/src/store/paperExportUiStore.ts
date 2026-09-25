/**
 * Which export the dialog is open on, if any.
 *
 * Its own store rather than a command dialog: the command-dialog host holds
 * one dialog at a time and answers a second request by cancelling the first,
 * so a prompt raised from inside an export would silently cancel the export.
 * A surface opens the dialog with a target it has captured; closing releases
 * that capture, and opening over an open dialog releases the one it replaces.
 */
import { create } from 'zustand';
import type { PaperExportFormat } from '../lib/paperExportSettings';
import type { PaperExportScope, PaperExportTarget } from '../paperExport/paperExportTarget';

export interface PaperExportRequest {
  /** Distinguishes one opening from the next, so the dialog starts fresh each time. */
  id: number;
  target: PaperExportTarget;
  /** The format to open on, when the verb that opened it names one; otherwise the remembered one. */
  format: PaperExportFormat | null;
  /**
   * The page on show, or every page, for a target with several. Not
   * remembered: where the export started says what was meant.
   */
  scope: PaperExportScope;
  /** Where focus goes back to when the dialog closes. */
  returnFocus: HTMLElement | null;
}

interface PaperExportUiState {
  request: PaperExportRequest | null;
  open: (request: Omit<PaperExportRequest, 'id'>) => void;
  close: () => void;
  /**
   * Close the dialog only if it is still the one opened as `id`: a save that
   * finishes after its dialog was replaced must not close the newer one.
   */
  closeRequest: (id: number) => void;
}

let nextRequestId = 1;

export const usePaperExportUiStore = create<PaperExportUiState>()((set, get) => ({
  request: null,
  open: (request) => {
    get().request?.target.release();
    set({ request: { ...request, id: nextRequestId++ } });
  },
  close: () => {
    const { request } = get();
    if (!request) return;
    request.target.release();
    set({ request: null });
  },
  closeRequest: (id) => {
    if (get().request?.id === id) get().close();
  },
}));

/** The element that has focus now, for a verb that is about to open the dialog. */
export function focusedElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}
