/**
 * `drag-box` tool engine (e.g. box select / box erase): press to anchor a corner,
 * drag to rubber-band a rectangle, release to commit the two opposite corners.
 * The kernel resolves the operation from the box. Pure — points arrive snapped.
 */
import type { ModelPoint } from '../renderer/types';
import type { ToolEngine, ToolInput, ToolOutput, ToolPreviewSegment } from './types';

export interface DragBoxState {
  /** Anchored corner captured on pointer-down, or null when idle. */
  start: ModelPoint | null;
}

const IDLE: DragBoxState = { start: null };

/** The four edges of the axis-aligned rectangle spanned by two opposite corners. */
function boxEdges(a: ModelPoint, b: ModelPoint): ToolPreviewSegment[] {
  const tl = { x: a.x, y: a.y };
  const tr = { x: b.x, y: a.y };
  const br = { x: b.x, y: b.y };
  const bl = { x: a.x, y: b.y };
  return [
    { a: tl, b: tr },
    { a: tr, b: br },
    { a: br, b: bl },
    { a: bl, b: tl },
  ];
}

export const dragBoxTool: ToolEngine<DragBoxState> = {
  initialState: IDLE,

  reduce(state: DragBoxState, input: ToolInput): ToolOutput<DragBoxState> {
    switch (input.kind) {
      case 'down':
        return { state: { start: input.point }, preview: null, commit: null };

      case 'move':
        if (!state.start) return { state, preview: null, commit: null };
        return { state, preview: { segments: boxEdges(state.start, input.point) }, commit: null };

      case 'up': {
        const start = state.start;
        if (!start) return { state: IDLE, preview: null, commit: null };
        // Only a zero-*length* gesture commits nothing, matching Oriedita's
        // `BoxSelectStepNode` (`selectionStart.distance(mousePos) > 0`). A flat box
        // still selects: the kernel predicate asks whether a crease touches the box,
        // not whether it fits inside — and a straight vertical or horizontal drag
        // holds one axis at exactly its press value, so rejecting per-axis dropped
        // those drags entirely.
        const commit =
          start.x === input.point.x && start.y === input.point.y
            ? null
            : { points: [start, input.point] };
        return { state: IDLE, preview: null, commit };
      }

      case 'cancel':
        return { state: IDLE, preview: null, commit: null };
    }
  },
};
