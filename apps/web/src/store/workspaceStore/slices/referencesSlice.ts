import { useLayoutStore } from '../../layoutStore';
import type { ReferencesSlice, ReferencesView, WorkspaceSliceCreator } from '../types';

export const DEFAULT_REFERENCES_VIEW: ReferencesView = {
  activeStep: 0,
  activeCandidate: 0,
  landmarksFirst: false,
};

/**
 * References-workspace state. Transient on purpose — see `ReferencesSlice` in
 * `types.ts` — so nothing here reads or writes storage.
 */
export const createReferencesSlice: WorkspaceSliceCreator<ReferencesSlice> = (set, get) => ({
  referencesTarget: null,
  referencesPlan: null,
  referencesCandidates: null,
  referencesView: DEFAULT_REFERENCES_VIEW,
  referencesRun: { status: 'idle' },

  setReferencesTarget: (target) => set({ referencesTarget: target }),
  setReferencesPlan: (plan) => set({ referencesPlan: plan }),
  setReferencesCandidates: (candidates) => set({ referencesCandidates: candidates }),
  setReferencesView: (view) => set({ referencesView: { ...get().referencesView, ...view } }),
  setReferencesRun: (run) => set({ referencesRun: run }),

  openReferencesWorkspace: () => {
    // Through the layout store, which resolves and activates the panel's owning
    // workspace — the same route `simulateOristudioCpSegment` takes to Simulate.
    useLayoutStore.getState().activatePanel('references');
  },
});
