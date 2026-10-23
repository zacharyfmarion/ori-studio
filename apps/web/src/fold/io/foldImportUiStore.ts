/**
 * Whether Import CP's dialog is open, and what it opens on: nothing yet (the
 * file picker and the samples), or a request to import at once — a sample
 * from the menu, Edit's folded figure, a file dropped on the canvas.
 *
 * Its own store, as the paper export's is: the menu, a drop and a toolbar
 * button all open the one dialog, which the app root mounts while Fold is the
 * workspace on screen (`FoldImportModal`). Opening while it is open starts it
 * over on the new request.
 */
import { create } from 'zustand';
import { dialogOpener } from '../../components/ui/useModalDialog';
import type { FoldImportRequest } from './foldImportFlow';

/**
 * What the dialog imports: a crease pattern as a step (Import CP), or only
 * its outline, as the sheet the sequence starts from (the Paper tab's Import
 * starting sheet, `foldStartingSheet`).
 */
export type FoldImportMode = 'step' | 'sheet';

export interface FoldImportOpening {
  /** Distinguishes one opening from the next, so the dialog starts fresh each time. */
  id: number;
  /** Import this at once; null shows the picker and the samples. */
  request: FoldImportRequest | null;
  mode: FoldImportMode;
  /** Where focus goes back to when the dialog closes. */
  returnFocus: HTMLElement | null;
}

interface FoldImportUiState {
  opening: FoldImportOpening | null;
  open: (request?: FoldImportRequest | null) => void;
  /** The dialog in its sheet mode: a pattern's outline as the sequence's starting sheet. */
  openStartingSheet: () => void;
  close: () => void;
}

let nextOpeningId = 1;

export const useFoldImportUiStore = create<FoldImportUiState>()((set) => {
  const opening = (state: FoldImportUiState, request: FoldImportRequest | null, mode: FoldImportMode): FoldImportOpening => ({
    id: nextOpeningId++,
    request,
    mode,
    // A request over an open dialog keeps where focus goes back to.
    returnFocus: state.opening?.returnFocus ?? (typeof document === 'undefined' ? null : dialogOpener()),
  });
  return {
    opening: null,
    open: (request = null) => set((state) => ({ opening: opening(state, request, 'step') })),
    openStartingSheet: () => set((state) => ({ opening: opening(state, null, 'sheet') })),
    close: () => set({ opening: null }),
  };
});
