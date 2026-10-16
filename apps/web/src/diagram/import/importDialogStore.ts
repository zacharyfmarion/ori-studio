import { create } from 'zustand';
import { importTarget, type ImportTarget } from '../../store/workspaceStore/diagramBatchImport';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { PickedFile } from '../../platform/fileService';
import { orderedImportFiles } from './importJob';
interface ImportDialogState {
  target: ImportTarget | null;
  files: PickedFile[];
  opener: HTMLElement | null;
  folder: ((recursive: boolean) => Promise<PickedFile[]>) | null;
  open: (files?: PickedFile[], folder?: (recursive: boolean) => Promise<PickedFile[]>) => void;
  close: () => void;
}
export const useImportDialogStore = create<ImportDialogState>((set) => ({
  target: null,
  files: [],
  opener: null,
  folder: null,
  open: (files = [], folder) => {
    if (useWorkspaceStore.getState().diagramReadOnly) return;
    set({
      folder: folder ?? null,
      target: importTarget(),
      files: orderedImportFiles(files),
      opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    });
  },
  close: () => set({ target: null, files: [], opener: null, folder: null }),
}));
