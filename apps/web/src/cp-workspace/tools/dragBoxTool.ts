/**
 * `drag-box` tool engine (e.g. box select / box erase): press to anchor a corner,
 * drag to rubber-band a rectangle, release to commit its corners. The kernel
 * resolves the operation from the box. Pure — points arrive snapped.
 *
 * The box is axis-aligned in *view* space when the input carries a view
 * transform, matching Oriedita's `BoxSelectStepNode`, and commits all four
 * corners — `required_selection_polygon` reads three or more points as a polygon
 * verbatim, the same path the lasso tools use. Without a view it stays
 * model-axis-aligned and commits the two diagonal corners.
 */
import type { ModelPoint } from '../renderer/types';
import type { ToolEngine, ToolInput, ToolOutput } from './types';
import { boxCornerEdges, viewAlignedBoxCorners } from './viewAlignedBox';

export interface DragBoxState {
  /** Anchored corner captured on pointer-down, or null when idle. */
  start: ModelPoint | null;
}

const IDLE: DragBoxState = { start: null };

export const dragBoxTool: ToolEngine<DragBoxState> = {
  initialState: IDLE,

  reduce(state: DragBoxState, input: ToolInput): ToolOutput<DragBoxState> {
    switch (input.kind) {
      case 'down':
        return { state: { start: input.point }, preview: null, commit: null };

      case 'move': {
        if (!state.start) return { state, preview: null, commit: null };
        const corners = viewAlignedBoxCorners(
          state.start,
          input.point,
          input.viewTransform ?? null,
        );
        return { state, preview: { segments: boxCornerEdges(corners) }, commit: null };
      }

      case 'up': {
        const start = state.start;
        if (!start) return { state: IDLE, preview: null, commit: null };
        // Only a zero-*length* gesture commits nothing, matching Oriedita's
        // `BoxSelectStepNode` (`selectionStart.distance(mousePos) > 0`). A flat box
        // still selects: the kernel predicate asks whether a crease touches the box,
        // not whether it fits inside — and a straight vertical or horizontal drag
        // holds one axis at exactly its press value, so rejecting per-axis dropped
        // those drags entirely.
        //
        // The test is on the drag's own two corners, not the derived four, so it
        // means the same thing at every view rotation.
        if (start.x === input.point.x && start.y === input.point.y) {
          return { state: IDLE, preview: null, commit: null };
        }
        const view = input.viewTransform ?? null;
        const points = view
          ? viewAlignedBoxCorners(start, input.point, view)
          : [start, input.point];
        return { state: IDLE, preview: null, commit: { points } };
      }

      case 'cancel':
        return { state: IDLE, preview: null, commit: null };
    }
  },
};
