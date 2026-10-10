import type { ReferencesReaderStateV1 } from '../../../cp-workspace/references/referencesReaderState';
import { useLayoutStore } from '../../layoutStore';
import type {
  ReferencesSettings,
  ReferencesSlice,
  ReferencesSliceState,
  ReferencesView,
  WorkspaceSliceCreator,
} from '../types';

export const DEFAULT_REFERENCES_VIEW: ReferencesView = {
  mode: 'find',
  activeStep: 0,
  activeCandidate: 0,
  landmarksFirst: false,
  activeFinding: null,
  planWays: {},
};

/** Upstream's `count`, and exact-only answers (plan decision D8). */
export const DEFAULT_REFERENCES_SETTINGS: ReferencesSettings = {
  candidateCount: 5,
  includeApproximate: false,
  precreaseGrid: true,
  gridWhereNeeded: true,
  allowDanglingFolds: true,
  mergeSymmetricSteps: true,
};

/** The candidate counts the settings popover offers. */
export const REFERENCES_CANDIDATE_COUNTS: readonly number[] = [1, 3, 5, 10];

function clampCandidateCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REFERENCES_SETTINGS.candidateCount;
  return Math.max(1, Math.min(20, Math.round(value)));
}

/**
 * The References fields an open sets from a saved reader state: the settings
 * it holds over the session's, the mode and the toggle, and what is left to
 * place once the sheets and the plan are known. Everything that named the
 * previous document — the pick, its answers, the sheet id, the plan summary —
 * goes, since this document is the one being read now.
 *
 * For a file without one, only the end of whatever the previous open
 * restored: it opens References as any document always has.
 */
export function restoredReferencesState(
  saved: ReferencesReaderStateV1 | null,
  loadSerial: number,
  settings: ReferencesSettings
): Partial<ReferencesSliceState> {
  // A card asked for names a sheet of the document before this one.
  if (!saved) return { referencesRestore: null, referencesCardRequest: null };
  const next = { ...settings, ...saved.settings };
  return {
    referencesSettings: { ...next, candidateCount: clampCandidateCount(next.candidateCount) },
    referencesView: {
      ...DEFAULT_REFERENCES_VIEW,
      mode: saved.mode,
      landmarksFirst: saved.landmarksFirst,
    },
    referencesSelectedSheet: null,
    referencesTarget: null,
    referencesCandidates: null,
    referencesPlan: null,
    referencesRun: { status: 'idle' },
    referencesRestore: { loadSerial, sheet: saved.sheet, card: saved.activeCard },
    referencesCardRequest: null,
  };
}

/**
 * References-workspace state. Nothing here reads or writes storage: the
 * reader's part of it reaches a file through the project's save and comes back
 * through {@link restoredReferencesState} — see `ReferencesSlice` in `types.ts`.
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
  referencesRestore: null,
  referencesAnalysisRequest: 0,
  referencesSheetRequest: null,
  referencesCardRequest: null,

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
  //
  // A choice of sheet is also the end of whatever an open restored and had not
  // placed yet: the sheet it named is no longer wanted, and the card it named
  // is that sheet's. So is a card asked for from a diagram step.
  setReferencesSelectedSheet: (component) => {
    if (get().referencesSelectedSheet === component) return;
    const restore = get().referencesRestore;
    set({
      referencesSelectedSheet: component,
      referencesTarget: null,
      referencesCandidates: null,
      referencesPlan: null,
      referencesRun: { status: 'idle' },
      referencesView: DEFAULT_REFERENCES_VIEW,
      referencesRestore: restore ? { ...restore, sheet: null, card: null } : null,
      referencesCardRequest: null,
    });
  },
  setReferencesView: (view) => set({ referencesView: { ...get().referencesView, ...view } }),

  commitReferencesRestoredSheet: (component) => {
    const restore = get().referencesRestore;
    if (!restore?.sheet) return;
    if (component === null) {
      // A sheet that is not there any more takes its card with it.
      set({ referencesRestore: { ...restore, sheet: null, card: null } });
      return;
    }
    set({ referencesSelectedSheet: component, referencesRestore: { ...restore, sheet: null } });
  },

  takeReferencesRestoredCard: (loadSerial) => {
    const restore = get().referencesRestore;
    if (!restore?.card || restore.loadSerial !== loadSerial) return null;
    set({ referencesRestore: { ...restore, card: null } });
    return restore.card;
  },
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

  openReferencesWorkspace: (sheet) => {
    if (sheet) set({ referencesSheetRequest: sheet });
    // Through the layout store, which resolves and activates the panel's owning
    // workspace — the same route `simulateOristudioCpSegment` takes to Simulate.
    useLayoutStore.getState().activatePanel('references');
  },

  takeReferencesSheetRequest: () => {
    const request = get().referencesSheetRequest;
    if (request) set({ referencesSheetRequest: null });
    return request;
  },

  requestReferencesCard: (sheet, card) => set({ referencesCardRequest: { sheet, card } }),

  takeReferencesCardRequest: (sheet) => {
    const request = get().referencesCardRequest;
    if (request?.sheet !== sheet) return null;
    set({ referencesCardRequest: null });
    return request.card;
  },
});
