/**
 * `step-sequence` tool engine: a click-based sequence where each step declares
 * whether it collects a free `point` or a picked crease (`line`). Generalizes the
 * point-sequence (all-point) and line-pick (all-line) tools and handles mixed
 * tools (e.g. Perpendicular draw: point then crease; Angle system: point, point,
 * crease). Commits `{ points, lineIds }`; between steps it reports the live points
 * (for the kernel preview) and the highlighted crease ids (picked + hovered). Pure
 * — the surface supplies the snapped point and the crease id under the cursor.
 */
import type { ModelPoint } from '../renderer/types';
import type { ToolEngine, ToolInput, ToolOutput } from './types';

export type StepKind = 'point' | 'line';

export interface StepSequenceState {
  points: readonly ModelPoint[];
  lineIds: readonly number[];
  /** Index of the step awaiting input. */
  step: number;
}

const idle = (): StepSequenceState => ({ points: [], lineIds: [], step: 0 });

export function createStepSequenceTool(
  stepKinds: readonly StepKind[]
): ToolEngine<StepSequenceState> {
  const count = stepKinds.length;
  return {
    initialState: idle(),

    reduce(state: StepSequenceState, input: ToolInput): ToolOutput<StepSequenceState> {
      const kind = stepKinds[state.step];
      const hovered = input.lineId ?? null;
      switch (input.kind) {
        case 'down': {
          let points = state.points;
          let lineIds = state.lineIds;
          if (kind === 'point') {
            points = [...points, input.point];
          } else if (hovered != null) {
            lineIds = [...lineIds, hovered];
          } else {
            // Line step but no crease under the cursor — ignore the click.
            return { state, preview: null, commit: null, highlightLineIds: lineIds };
          }
          const step = state.step + 1;
          if (step >= count) {
            return { state: idle(), preview: null, commit: { points, lineIds } };
          }
          return {
            state: { points, lineIds, step },
            preview: null,
            commit: null,
            livePoints: points,
            highlightLineIds: lineIds,
            awaitingPoint: stepKinds[step] === 'point',
          };
        }

        case 'move':
          return {
            state,
            preview: null,
            commit: null,
            livePoints: kind === 'point' ? [...state.points, input.point] : state.points,
            highlightLineIds:
              kind === 'line' && hovered != null
                ? [...state.lineIds, hovered]
                : state.lineIds,
            awaitingPoint: kind === 'point',
          };

        case 'up':
          return { state, preview: null, commit: null };

        case 'cancel':
          return { state: idle(), preview: null, commit: null };
      }
    },
  };
}
