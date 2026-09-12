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
  activeFinding: null,
};

/** Upstream's `count`, and exact-only answers (plan decision D8). */
export const DEFAULT_REFERENCES_SETTINGS: ReferencesSettings = {
  candidateCount: 5,
  includeApproximate: false,
  precreaseGrid: true,
  gridWhereNeeded: true,
  disallowDanglingFolds: false,
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
  referencesAnalysis: null,
  referencesProgress: null,
  referencesCandidates: null,
  referencesSelectedSheet: null,
  referencesView: DEFAULT_REFERENCES_VIEW,
  referencesRun: { status: 'idle' },
  referencesSettings: DEFAULT_REFERENCES_SETTINGS,
  referencesAnalysisRequest: 0,

  setReferencesTarget: (target) => set({ referencesTarget: target }),
  setReferencesPlan: (plan) => set({ referencesPlan: plan }),
  setReferencesAnalysis: (analysis) => set({ referencesAnalysis: analysis }),
  setReferencesProgress: (progress) => set({ referencesProgress: progress }),
  setReferencesCandidates: (candidates) => set({ referencesCandidates: candidates }),

  // The plan, the pick and the step index all name geometry inside one sheet,
  // so switching sheets drops all three rather than reinterpreting them against
  // the new one. The plan itself lives in the module side table; the panel
  // clears that alongside this, which is why only the store's own fields are
  // reset here.
  setReferencesSelectedSheet: (component) => {
    if (get().referencesSelectedSheet === component) return;
    set({
      referencesSelectedSheet: component,
      referencesTarget: null,
      referencesCandidates: null,
      referencesPlan: null,
      referencesRun: { status: 'idle' },
      referencesView: DEFAULT_REFERENCES_VIEW,
    });
  },
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

  // A toggle rather than a setter so the chord, the settings popover and the
  // context menu cannot disagree about what "on" means. Selecting a step is
  // reset with it: the hoisted order renumbers every step, so an index kept
  // across the flip would frame a different fold.
  toggleReferencesLandmarksFirst: () => {
    const view = get().referencesView;
    set({
      referencesView: { ...view, landmarksFirst: !view.landmarksFirst, activeStep: 0 },
    });
  },

  requestReferencesAnalysis: () =>
    set({ referencesAnalysisRequest: get().referencesAnalysisRequest + 1 }),

  consumeReferencesAnalysisRequest: () => {
    if (get().referencesAnalysisRequest === 0) return false;
    set({ referencesAnalysisRequest: 0 });
    return true;
  },

  openReferencesWorkspace: () => {
    // Through the layout store, which resolves and activates the panel's owning
    // workspace — the same route `simulateOristudioCpSegment` takes to Simulate.
    useLayoutStore.getState().activatePanel('references');
  },
});
