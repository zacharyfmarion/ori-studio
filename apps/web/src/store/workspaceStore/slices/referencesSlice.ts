import { useLayoutStore } from '../../layoutStore';
import type {
  ReferencesSettings,
  ReferencesSlice,
  ReferencesView,
  WorkspaceSliceCreator,
} from '../types';

export const DEFAULT_REFERENCES_VIEW: ReferencesView = {
  activeStep: 0,
  activeCandidate: 0,
  landmarksFirst: false,
};

/** Upstream's `count`, and exact-only answers (plan decision D8). */
export const DEFAULT_REFERENCES_SETTINGS: ReferencesSettings = {
  candidateCount: 5,
  includeApproximate: false,
};

/** The candidate counts the settings popover offers. */
export const REFERENCES_CANDIDATE_COUNTS: readonly number[] = [1, 3, 5, 10];

function clampCandidateCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REFERENCES_SETTINGS.candidateCount;
  return Math.max(1, Math.min(20, Math.round(value)));
}

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
  referencesSettings: DEFAULT_REFERENCES_SETTINGS,

  setReferencesTarget: (target) => set({ referencesTarget: target }),
  setReferencesPlan: (plan) => set({ referencesPlan: plan }),
  setReferencesCandidates: (candidates) => set({ referencesCandidates: candidates }),
  setReferencesView: (view) => set({ referencesView: { ...get().referencesView, ...view } }),
  setReferencesRun: (run) => set({ referencesRun: run }),
  setReferencesSettings: (settings) => {
    const next = { ...get().referencesSettings, ...settings };
    set({
      referencesSettings: {
        ...next,
        candidateCount: clampCandidateCount(next.candidateCount),
      },
    });
  },

  openReferencesWorkspace: () => {
    // Through the layout store, which resolves and activates the panel's owning
    // workspace — the same route `simulateOristudioCpSegment` takes to Simulate.
    useLayoutStore.getState().activatePanel('references');
  },
});
