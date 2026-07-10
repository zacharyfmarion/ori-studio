/**
 * `point-sequence` tool engine (the default for tools with `toolSteps` and no
 * drag mode — the bulk of the draw tools). Click to place each point; when
 * `stepCount` points are placed, commit them. Between clicks, a hover reports the
 * collected points plus the live cursor as `livePoints`, which the controller
 * feeds to the kernel for its preview. Pure — points arrive snapped.
 *
 * Fixed-length only for now; variable-length sequences (Oriedita's polygon /
 * lasso-style ops) are a later override.
 */
import type { ModelPoint } from '../renderer/types';
import type { ToolEngine, ToolInput, ToolOutput } from './types';

export interface PointSequenceState {
  /** Points placed so far in the current sequence. */
  points: readonly ModelPoint[];
}

const IDLE: PointSequenceState = { points: [] };

export function createPointSequenceTool(stepCount: number): ToolEngine<PointSequenceState> {
  return {
    initialState: IDLE,

    reduce(state: PointSequenceState, input: ToolInput): ToolOutput<PointSequenceState> {
      switch (input.kind) {
        case 'down': {
          const points = [...state.points, input.point];
          if (points.length >= stepCount) {
            // Sequence complete: commit and reset for the next one.
            return { state: IDLE, preview: null, commit: { points } };
          }
          return { state: { points }, preview: null, commit: null, livePoints: points };
        }

        case 'move':
          // Nothing placed yet -> no preview; otherwise show placed + cursor.
          if (state.points.length === 0) {
            return { state, preview: null, commit: null };
          }
          return {
            state,
            preview: null,
            commit: null,
            livePoints: [...state.points, input.point],
          };

        case 'up':
          // Points are placed on press; release is a no-op.
          return { state, preview: null, commit: null };

        case 'cancel':
          return { state: IDLE, preview: null, commit: null };
      }
    },
  };
}
