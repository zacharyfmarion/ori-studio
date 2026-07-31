import { create } from 'zustand';
import { STORAGE_KEYS, readJson, storageKey, writeJson } from '../lib/storage';
import type {
  OristudioBpOptimizerProgress,
  OristudioBpOptimizerRunOptions,
} from '../engine/oristudioBpTypes';

/**
 * The options the user can choose. Excludes `openNew` (we have no BP project
 * tabs, so the optimizer always replaces in place), `seed` (randomized per run),
 * and `symmetry` (resolved from the tree at run time, not a stored preference).
 */
export type BpOptimizerDialogOptions = OristudioBpOptimizerRunOptions;

/**
 * Box Pleating Studio's own defaults, from
 * `src/app/services/settingService.ts` → `tools.Optimizer`. Deliberately not the
 * values in the product screenshots, which are persisted user state.
 */
export const DEFAULT_BP_OPTIMIZER_OPTIONS: BpOptimizerDialogOptions = {
  useDimension: true,
  layoutMode: 'view',
  useBasinHopping: false,
  randomCandidateCount: 1,
  // On by default so a design authored with mirror-draw packs the way it was
  // drawn. It only takes effect when the symmetry mode is on and the pairing
  // actually resolves; the dialog says so when it does not.
  respectSymmetry: true,
};

/** Upstream's range for "Number of layouts to try". */
export const MIN_BP_RANDOM_CANDIDATES = 1;
export const MAX_BP_RANDOM_CANDIDATES = 100;

const OPTIONS_KEY = storageKey(STORAGE_KEYS.bpOptimizer);

function sanitize(options: Partial<BpOptimizerDialogOptions>): BpOptimizerDialogOptions {
  const merged = { ...DEFAULT_BP_OPTIMIZER_OPTIONS, ...options };
  const count = Math.round(Number(merged.randomCandidateCount));
  return {
    useDimension: Boolean(merged.useDimension),
    layoutMode: merged.layoutMode === 'random' ? 'random' : 'view',
    useBasinHopping: Boolean(merged.useBasinHopping),
    respectSymmetry: Boolean(merged.respectSymmetry),
    randomCandidateCount: Number.isFinite(count)
      ? Math.min(MAX_BP_RANDOM_CANDIDATES, Math.max(MIN_BP_RANDOM_CANDIDATES, count))
      : DEFAULT_BP_OPTIMIZER_OPTIONS.randomCandidateCount,
  };
}

function loadOptions(): BpOptimizerDialogOptions {
  return sanitize(readJson<Partial<BpOptimizerDialogOptions>>(OPTIONS_KEY, {}));
}

export interface BpOptimizerUiState {
  isOpen: boolean;
  /** Persisted across documents and sessions, the way upstream's settings are. */
  options: BpOptimizerDialogOptions;
  running: boolean;
  progress: OristudioBpOptimizerProgress | null;
  error: string | null;

  open: () => void;
  close: () => void;
  setOptions: (patch: Partial<BpOptimizerDialogOptions>) => void;
  beginRun: () => void;
  reportProgress: (progress: OristudioBpOptimizerProgress) => void;
  finishRun: (error?: string | null) => void;
}

export const useBpOptimizerUiStore = create<BpOptimizerUiState>((set) => ({
  isOpen: false,
  options: loadOptions(),
  running: false,
  progress: null,
  error: null,

  // Opening always starts from a clean slate: a stale progress bar or error from
  // the previous run must not greet the user on reopen.
  open: () => set({ isOpen: true, progress: null, error: null }),
  close: () => set({ isOpen: false, progress: null, error: null }),

  setOptions: (patch) =>
    set((state) => {
      const options = sanitize({ ...state.options, ...patch });
      writeJson(OPTIONS_KEY, options);
      return { options };
    }),

  beginRun: () => set({ running: true, progress: null, error: null }),
  reportProgress: (progress) => set({ progress }),
  finishRun: (error = null) => set({ running: false, error, progress: null }),
}));
