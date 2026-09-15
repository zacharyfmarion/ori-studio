import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

/**
 * Where an offer stands.
 *
 * - `pending` — the pill is showing (if the score cleared the threshold).
 * - `open` — the Detect dialog holds this image; the pill hides meanwhile.
 * - `dismissed` — × was pressed. Final for this image in this session.
 * - `accepted` — the dialog imported the pattern. Final.
 *
 * A dialog closed without importing goes back to `pending`: taking the offer
 * does not consume it, because with no verb on the image there would be no way
 * back short of re-picking the file from the File menu.
 */
export type CpDetectSuggestionState = 'pending' | 'open' | 'dismissed' | 'accepted';

export interface CpDetectSuggestion {
  /** The gate's probability, 0–1. */
  score: number;
  /** Whether it cleared the operating threshold; only these get a pill. */
  likely: boolean;
  state: CpDetectSuggestionState;
}

interface CpDetectSuggestionStore {
  /**
   * By annotation id. Transient on purpose: an image loaded from a saved file
   * is never scored, so nothing here needs to outlive the session, and undo /
   * redo of the add keep working because the entry outlives the annotation.
   */
  suggestions: Record<string, CpDetectSuggestion>;
  /** × presses this session, for the one-time "you can turn this off" toast. */
  dismissals: number;
  recordSuggestion: (id: string, score: number, likely: boolean) => void;
  setSuggestionState: (id: string, state: CpDetectSuggestionState) => void;
  /** Returns the new count. */
  countDismissal: () => number;
  reset: () => void;
}

export const useCpDetectSuggestionStore = create<CpDetectSuggestionStore>()(
  devtools(
    (set, get) => ({
      suggestions: {},
      dismissals: 0,
      recordSuggestion: (id, score, likely) =>
        set((state) => ({
          suggestions: { ...state.suggestions, [id]: { score, likely, state: 'pending' } },
        })),
      setSuggestionState: (id, next) =>
        set((state) => {
          const current = state.suggestions[id];
          if (!current || current.state === next) return state;
          return { suggestions: { ...state.suggestions, [id]: { ...current, state: next } } };
        }),
      countDismissal: () => {
        const dismissals = get().dismissals + 1;
        set({ dismissals });
        return dismissals;
      },
      reset: () => set({ suggestions: {}, dismissals: 0 }),
    }),
    { name: 'CpDetectSuggestionStore' }
  )
);
