/**
 * `sequence` tool engine: a click-based sequence that collects `count` points and
 * commits them. Every step collects a *point* — Oriedita's construction tools
 * resolve creases from points kernel-side, so a "pick a crease" step is just a
 * point snapped onto that crease (the surface handles the per-step snap + crease
 * highlight; the engine only counts points). Between clicks it reports the live
 * points (placed + cursor) for the kernel preview. Pure.
 */
import type { ModelPoint } from '../renderer/types';
import type { ToolEngine, ToolInput, ToolOutput } from './types';

export interface SequenceState {
  points: readonly ModelPoint[];
}

const IDLE: SequenceState = { points: [] };

export function createStepSequenceTool(count: number): ToolEngine<SequenceState> {
  return {
    initialState: IDLE,

    reduce(state: SequenceState, input: ToolInput): ToolOutput<SequenceState> {
      switch (input.kind) {
        case 'down': {
          const points = [...state.points, input.point];
          if (points.length >= count) {
            return { state: IDLE, preview: null, commit: { points } };
          }
          return { state: { points }, preview: null, commit: null, livePoints: points };
        }

        case 'move':
          return {
            state,
            preview: null,
            commit: null,
            livePoints: [...state.points, input.point],
          };

        case 'up':
          return { state, preview: null, commit: null };

        case 'cancel':
          return { state: IDLE, preview: null, commit: null };
      }
    },
  };
}
