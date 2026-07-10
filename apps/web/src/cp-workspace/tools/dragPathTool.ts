/**
 * `drag-path` tool engine (e.g. freehand crease drawing): press to start, drag to
 * lay down a polyline of points, release to commit the path. The surface samples
 * one point per pointer-move. Pure — points arrive snapped.
 */
import type { ModelPoint } from '../renderer/types';
import type { ToolEngine, ToolInput, ToolOutput, ToolPreviewSegment } from './types';

export interface DragPathState {
  /** Sampled path points captured so far; empty when idle. */
  points: readonly ModelPoint[];
}

const IDLE: DragPathState = { points: [] };

function polyline(points: readonly ModelPoint[]): ToolPreviewSegment[] {
  const segments: ToolPreviewSegment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    segments.push({ a: points[i], b: points[i + 1] });
  }
  return segments;
}

function samePoint(a: ModelPoint, b: ModelPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

export const dragPathTool: ToolEngine<DragPathState> = {
  initialState: IDLE,

  reduce(state: DragPathState, input: ToolInput): ToolOutput<DragPathState> {
    switch (input.kind) {
      case 'down':
        return { state: { points: [input.point] }, preview: null, commit: null };

      case 'move': {
        if (state.points.length === 0) return { state, preview: null, commit: null };
        // Skip duplicate samples so a still cursor doesn't inflate the path.
        const last = state.points[state.points.length - 1];
        const points = samePoint(last, input.point)
          ? state.points
          : [...state.points, input.point];
        return { state: { points }, preview: { segments: polyline(points) }, commit: null };
      }

      case 'up': {
        const points = state.points;
        const commit = points.length >= 2 ? { points } : null;
        return { state: IDLE, preview: null, commit };
      }

      case 'cancel':
        return { state: IDLE, preview: null, commit: null };
    }
  },
};
