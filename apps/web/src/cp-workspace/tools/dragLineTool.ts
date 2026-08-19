/**
 * `drag-line` tool engine (e.g. `DrawCreaseFree`): draws a crease from a start
 * endpoint to an end endpoint. Two gestures reach the same commit —
 *
 *   press → drag → release   (upstream Oriedita's only gesture)
 *   click → move → click     (an Ori Studio addition)
 *
 * — and one predicate decides between them on every release: is the release
 * point farther from the start than `input.tolerance`? Farther means a drag (or
 * a deliberate second click elsewhere) and commits `[start, end]`; within the
 * tolerance means a click in place, which *arms* the start — the next move
 * previews from it and the next click away from it commits. Clicking the armed
 * point again disarms, so a stray click is undone by repeating it.
 *
 * Pure — the surface supplies already-snapped model points and the model-space
 * tolerance for the live camera.
 */
import type { ModelPoint } from '../renderer/types';
import type { ToolEngine, ToolInput, ToolOutput } from './types';

export interface DragLineState {
  /** Start endpoint, captured on pointer-down and kept while armed; null when idle. */
  start: ModelPoint | null;
  /**
   * True once a click in place has parked `start` between gestures. Only `down`
   * reads it: an armed press keeps the existing start instead of replacing it.
   */
  armed: boolean;
}

const IDLE: DragLineState = { start: null, armed: false };

function beyondTolerance(a: ModelPoint, b: ModelPoint, tolerance: number | undefined): boolean {
  return Math.hypot(b.x - a.x, b.y - a.y) > (tolerance ?? 0);
}

function segment(a: ModelPoint, b: ModelPoint) {
  return { segments: [{ a, b }] };
}

/**
 * Build an output, reporting an armed start through `livePoints` so the surface
 * can mark it (a placed dot), gate presses on it, and move the step prompt — all
 * without keeping a second copy of the arming rule.
 */
function out(
  state: DragLineState,
  preview: ToolOutput<DragLineState>['preview'],
  commit: ToolOutput<DragLineState>['commit'] = null,
): ToolOutput<DragLineState> {
  const livePoints = state.armed && state.start ? [state.start] : undefined;
  return { state, preview, commit, livePoints };
}

export const dragLineTool: ToolEngine<DragLineState> = {
  initialState: IDLE,

  reduce(state: DragLineState, input: ToolInput): ToolOutput<DragLineState> {
    switch (input.kind) {
      case 'down':
        // An armed press keeps the parked start — this press is the *end* of the
        // crease. Otherwise it opens a fresh gesture at the press point.
        return state.armed && state.start
          ? out(state, segment(state.start, input.point))
          : out({ start: input.point, armed: false }, null);

      case 'move':
        // Previews the same either way, so the engine never needs to know whether a
        // button is down: dragging and armed hover both rubber-band from `start`.
        if (!state.start) return out(state, null);
        return out(state, segment(state.start, input.point));

      case 'up': {
        const start = state.start;
        if (!start) return out(IDLE, null);
        if (beyondTolerance(start, input.point, input.tolerance)) {
          return out(IDLE, null, { points: [start, input.point] });
        }
        // A click in place: arm the start, or disarm if it was already armed. The
        // armed start has no segment to show yet — the surface marks it with a
        // placed dot, and the next move rubber-bands from it.
        return state.armed ? out(IDLE, null) : out({ start, armed: true }, null);
      }

      case 'cancel':
        return out(IDLE, null);
    }
  },
};
