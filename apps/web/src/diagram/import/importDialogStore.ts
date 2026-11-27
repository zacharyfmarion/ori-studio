import { create } from 'zustand';
import { importTarget, type ImportTarget } from '../../store/workspaceStore/diagramBatchImport';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { PickedFile } from '../../platform/fileService';
import { naturalFileOrder } from '../../lib/naturalFileOrder';
import { supportsStepImport } from './importJob';
interface ImportDialogState {
  target: ImportTarget | null;
  files: PickedFile[];
  opener: HTMLElement | null;
  folder: ((recursive: boolean) => Promise<PickedFile[]>) | null;
  /**
   * `anchorStepId` is where the steps go (D2): an empty step takes the first,
   * any other has them after it. The selected step, unless named.
   */
  open: (
    files?: PickedFile[],
    folder?: (recursive: boolean) => Promise<PickedFile[]>,
    anchorStepId?: string
  ) => void;
  close: () => void;
}
export const useImportDialogStore = create<ImportDialogState>((set) => ({
  target: null,
  files: [],
  opener: null,
  folder: null,
  open: (files = [], folder, anchorStepId) => {
    if (useWorkspaceStore.getState().diagramReadOnly) return;
    const target = importTarget();
    set({
      folder: folder ?? null,
      target: anchorStepId === undefined ? target : { ...target, anchor: anchorStepId },
      // A drop brings whatever was dragged; only what an import takes is listed, as the pickers do.
      files: naturalFileOrder(files.filter((file) => supportsStepImport(file.name))),
      opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    });
  },
  close: () => set({ target: null, files: [], opener: null, folder: null }),
}));
