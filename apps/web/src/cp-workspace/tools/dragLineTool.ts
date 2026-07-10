/**
 * `drag-line` tool engine (e.g. `DrawCreaseFree`): press to set the start
 * endpoint, drag to preview the crease, release to commit `[start, end]`. Pure —
 * the surface supplies already-snapped model points.
 */
import type { ModelPoint } from '../renderer/types';
import type { ToolEngine, ToolInput, ToolOutput } from './types';

export interface DragLineState {
  /** Start endpoint captured on pointer-down, or null when idle. */
  start: ModelPoint | null;
}

const IDLE: DragLineState = { start: null };

function samePoint(a: ModelPoint, b: ModelPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

export const dragLineTool: ToolEngine<DragLineState> = {
  initialState: IDLE,

  reduce(state: DragLineState, input: ToolInput): ToolOutput<DragLineState> {
    switch (input.kind) {
      case 'down':
        return { state: { start: input.point }, preview: null, commit: null };

      case 'move':
        if (!state.start) return { state, preview: null, commit: null };
        return {
          state,
          preview: { segments: [{ a: state.start, b: input.point }] },
          commit: null,
        };

      case 'up': {
        const start = state.start;
        if (!start) return { state: IDLE, preview: null, commit: null };
        // A zero-length drag (press without moving) commits nothing.
        const commit = samePoint(start, input.point) ? null : { points: [start, input.point] };
        return { state: IDLE, preview: null, commit };
      }

      case 'cancel':
        return { state: IDLE, preview: null, commit: null };
    }
  },
};
