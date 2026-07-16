/**
 * `line-entity` tool engine: a click-based sequence that picks `count` existing
 * creases by their id and commits those ids — *no points*. This is the model the
 * Lengthen tools use (SVG `handleEditableLineClick` → `{ line_ids: [a, b] }`): the
 * kernel operates on the picked creases directly, so snapping a point onto a line
 * (what the point-sequence engine does) is the wrong model and drops the wrong
 * payload. Clicks on empty canvas are ignored — matching the SVG's swallow of a
 * lengthen click that misses a crease. Between clicks it reports the picked-plus-
 * hovered ids so the surface can highlight them. Pure.
 */
import type { ToolEngine, ToolInput, ToolOutput } from './types';

export interface LinePickState {
  lineIds: readonly number[];
}

const IDLE: LinePickState = { lineIds: [] };

export function createLinePickTool(count: number): ToolEngine<LinePickState> {
  return {
    initialState: IDLE,

    reduce(state: LinePickState, input: ToolInput): ToolOutput<LinePickState> {
      switch (input.kind) {
        case 'down': {
          // A click that misses every crease is a no-op (SVG lengthen swallow).
          if (input.lineId == null || input.lineId <= 0) {
            return { state, preview: null, commit: null, highlightLineIds: state.lineIds };
          }
          const lineIds = [...state.lineIds, input.lineId];
          if (lineIds.length >= count) {
            return {
              state: IDLE,
              preview: null,
              commit: { lineIds },
              highlightLineIds: lineIds,
            };
          }
          return { state: { lineIds }, preview: null, commit: null, highlightLineIds: lineIds };
        }

        case 'move':
          // Highlight the picked creases plus the one under the cursor, if any.
          return {
            state,
            preview: null,
            commit: null,
            highlightLineIds:
              input.lineId != null && input.lineId > 0
                ? [...state.lineIds, input.lineId]
                : state.lineIds,
          };

        case 'up':
          return { state, preview: null, commit: null };

        case 'cancel':
          return { state: IDLE, preview: null, commit: null };
      }
    },
  };
}
