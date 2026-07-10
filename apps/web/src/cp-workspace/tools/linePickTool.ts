/**
 * `line-pick` tool engine (entity-pick): click creases to pick them (e.g.
 * "Lengthen crease": select line to extend, then target line). The surface
 * resolves the crease under the cursor via its hit-test and supplies it as
 * `input.lineId`; the engine collects `count` ids and commits them. Between
 * picks it reports `highlightLineIds` (picked so far + the one under the cursor)
 * for pick feedback. Pure — hit-testing lives in the surface.
 */
import type { ToolEngine, ToolInput, ToolOutput } from './types';

export interface LinePickState {
  /** Crease ids picked so far in the current sequence. */
  lineIds: readonly number[];
}

const IDLE: LinePickState = { lineIds: [] };

export function createLinePickTool(count: number): ToolEngine<LinePickState> {
  return {
    initialState: IDLE,

    reduce(state: LinePickState, input: ToolInput): ToolOutput<LinePickState> {
      const hovered = input.lineId ?? null;
      switch (input.kind) {
        case 'down': {
          if (hovered == null) {
            // Clicked empty space — no pick; keep the current picks highlighted.
            return { state, preview: null, commit: null, highlightLineIds: state.lineIds };
          }
          const lineIds = [...state.lineIds, hovered];
          if (lineIds.length >= count) {
            return { state: IDLE, preview: null, commit: { lineIds } };
          }
          return { state: { lineIds }, preview: null, commit: null, highlightLineIds: lineIds };
        }

        case 'move':
          return {
            state,
            preview: null,
            commit: null,
            highlightLineIds: hovered == null ? state.lineIds : [...state.lineIds, hovered],
          };

        case 'up':
          return { state, preview: null, commit: null };

        case 'cancel':
          return { state: IDLE, preview: null, commit: null };
      }
    },
  };
}
