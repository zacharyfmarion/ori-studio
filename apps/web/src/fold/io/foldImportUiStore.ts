/**
 * Whether Import CP's dialog is open, and what it opens on: nothing yet (the
 * file picker and the samples), a request to import at once — a sample from
 * the menu, Edit's folded figure — or the files dropped on the canvas, one
 * or many, imported one after another (`foldImportQueue`).
 *
 * Its own store, as the paper export's is: the menu, a drop and a toolbar
 * button all open the one dialog, which the app root mounts while Fold is the
 * workspace on screen (`FoldImportModal`). Opening while it is open starts it
 * over on the new request.
 */
import { create } from 'zustand';
import { dialogOpener } from '../../components/ui/useModalDialog';
import type { PickedFile } from '../../platform/fileService';
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
  /** Import this at once; null shows the picker and the samples, or imports {@link files}. */
  request: FoldImportRequest | null;
  /** Dropped files to import one after another, the crease patterns among them by name; empty for none. */
  files: readonly PickedFile[];
  mode: FoldImportMode;
  /** Where focus goes back to when the dialog closes. */
  returnFocus: HTMLElement | null;
}

interface FoldImportUiState {
  opening: FoldImportOpening | null;
  open: (request?: FoldImportRequest | null) => void;
  /** Import CP on dropped files: each crease pattern among them a step after the one before. */
  openFiles: (files: readonly PickedFile[]) => void;
  /** The dialog in its sheet mode: a pattern's outline as the sequence's starting sheet. */
  openStartingSheet: () => void;
  close: () => void;
}

let nextOpeningId = 1;
const NO_FILES: readonly PickedFile[] = [];

export const useFoldImportUiStore = create<FoldImportUiState>()((set) => {
  const opening = (
    state: FoldImportUiState,
    request: FoldImportRequest | null,
    mode: FoldImportMode,
    files: readonly PickedFile[] = NO_FILES
  ): FoldImportOpening => ({
    id: nextOpeningId++,
    request,
    files,
    mode,
    // A request over an open dialog keeps where focus goes back to.
    returnFocus: state.opening?.returnFocus ?? (typeof document === 'undefined' ? null : dialogOpener()),
  });
  return {
    opening: null,
    open: (request = null) => set((state) => ({ opening: opening(state, request, 'step') })),
    openFiles: (files) => set((state) => ({ opening: opening(state, null, 'step', files) })),
    openStartingSheet: () => set((state) => ({ opening: opening(state, null, 'sheet') })),
    close: () => set({ opening: null }),
  };
});
