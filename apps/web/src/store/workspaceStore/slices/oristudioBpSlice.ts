import { requestConfirmation } from '../../commandDialogStore';
import { useLayoutStore } from '../../layoutStore';
import {
  createSampleOristudioBpProject,
  getOristudioBpPortDescriptors,
  oristudioBpError,
} from '../oristudioBpRuntime';
import type { OristudioBpDocumentState } from '../../../engine/oristudioBpTypes';
import type { OristudioBpSlice, WorkspaceSliceCreator } from '../types';

/**
 * Box Pleating workspace slice. Phase 3 is the runtime foundation: it can create
 * and hold a BP document. The tree/packing editing surfaces and file/optimizer
 * actions are wired up in later phases.
 */
export const createOristudioBpSlice: WorkspaceSliceCreator<OristudioBpSlice> = (set, get) => {
  const confirmDiscardDirty = async (dirty: boolean): Promise<boolean> => {
    if (!dirty) return true;
    return requestConfirmation({
      title: 'Discard unsaved changes?',
      message: 'Your current project has unsaved changes. Start a new Box Pleat design and discard them?',
      confirmLabel: 'Discard',
      tone: 'danger',
    });
  };

  const setLoadedBpProject = (document: OristudioBpDocumentState, message: string) => {
    set({
      workflowTarget: 'box-pleat',
      pendingDesignChoice: false,
      documentMode: 'tree',
      activeEditingSurface: 'tree',
      importedCreasePattern: null,
      oristudioCpDocument: null,
      oristudioCpLineage: null,
      oristudioCpError: null,
      oristudioCpCamvResult: null,
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      oristudioBpDocument: document,
      oristudioBpWorkspace: null,
      oristudioBpError: null,
      oristudioBpBusy: false,
      currentFileName: document.source.filename,
      currentFilePath: document.source.path,
      dirty: document.dirty,
      projectMessage: message,
      status: 'ready',
      engineReady: true,
      error: null,
    });
    const layout = useLayoutStore.getState();
    layout.activateWorkspace('design');
    layout.ensureDesignLayout();
  };

  return {
    oristudioBpDocument: null,
    oristudioBpWorkspace: null,
    oristudioBpPortDescriptors: [],
    oristudioBpError: null,
    oristudioBpBusy: false,

    createOristudioBpProject: async (options = {}) => {
      if (options.confirmDiscard !== false && !(await confirmDiscardDirty(get().dirty))) {
        return false;
      }
      set({ oristudioBpBusy: true, oristudioBpError: null });
      try {
        await get().clearOristudioCpDocument();
        const [document, portDescriptors] = await Promise.all([
          createSampleOristudioBpProject(),
          getOristudioBpPortDescriptors().catch(() => []),
        ]);
        set({ oristudioBpPortDescriptors: portDescriptors });
        setLoadedBpProject(document, 'Created Box Pleat project');
        return true;
      } catch (error) {
        const normalized = oristudioBpError(error);
        set({
          oristudioBpError: normalized.message,
          oristudioBpBusy: false,
          status: 'error',
          error: normalized,
        });
        return false;
      }
    },
  };
};
