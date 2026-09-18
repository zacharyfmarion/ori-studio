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

export interface StepSequenceOptions {
  /**
   * Refuse a press within `tolerance` of the point placed just before it when the
   * two form a pair (steps 0–1, 2–3, …): the press is reported as ignored and the
   * step does not advance.
   *
   * This is the gate Oriedita's four-point transform handlers apply to their
   * second source and target points (`release_select_2_original_points` /
   * `release_select_2_target_points` in `MouseHandlerCreaseCopy4p` and the move
   * variant), which is why `FoldLineSet.move` never divides its scale by a
   * zero-length pair. Without it a double-click on one vertex was a completed
   * source pair, and the copy that followed had no finite coordinates at all.
   */
  distinctPairs?: boolean;
}

const IDLE: SequenceState = { points: [] };

export function createStepSequenceTool(
  count: number,
  options: StepSequenceOptions = {}
): ToolEngine<SequenceState> {
  return {
    initialState: IDLE,

    reduce(state: SequenceState, input: ToolInput): ToolOutput<SequenceState> {
      switch (input.kind) {
        case 'down': {
          if (options.distinctPairs && closesPairOnItsMate(state.points, input)) {
            return {
              state,
              preview: null,
              commit: null,
              livePoints: [...state.points, input.point],
              ignored: true,
            };
          }
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

/** The press would complete a pair on top of the pair's first point. */
function closesPairOnItsMate(placed: readonly ModelPoint[], input: ToolInput): boolean {
  if (placed.length % 2 === 0) return false;
  const mate = placed[placed.length - 1];
  const distance = Math.hypot(input.point.x - mate.x, input.point.y - mate.y);
  // Negated `>` rather than `<=`: a non-finite press has a NaN distance, which
  // fails both comparisons, and this is the form that refuses it.
  return !(distance > (input.tolerance ?? 0));
}
