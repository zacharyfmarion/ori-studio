/**
 * `drag-vertex` tool engine (`VertexMove`): grab a junction, drag it, and every
 * crease that ends there follows.
 *
 *   press on a vertex → drag → release
 *
 * Close to {@link import('./dragLineTool').dragLineTool} and deliberately not a
 * variant of it, for two reasons:
 *
 * - The anchor is **a vertex the surface resolved**, not the press point. The
 *   surface gates the press on a vertex being under the cursor and feeds that
 *   vertex's exact position, so a press 3 px off still pivots on the junction
 *   rather than 3 px beside it.
 * - There is **no click-to-place arming.** A parked half-finished vertex move
 *   would leave no visible anchor to explain itself and no obvious way out; a
 *   click in place here simply does nothing.
 *
 * The preview is not this engine's: the surface moves the real strokes through
 * the transform channel's `endpoints` set, the same way the selection move-drag
 * moves whole ones. So `preview` is always null and the engine's whole job is the
 * anchor and the click-vs-drag rule.
 *
 * Pure — the surface supplies already-snapped model points and the model-space
 * tolerance for the live camera. Snapping *both* ends is what keeps the
 * click-vs-drag test honest; see `angle-drag-shared-engine.md` for the bug that
 * comes of snapping only one.
 */
import type { ModelPoint } from '../renderer/types';
import type { ToolEngine, ToolInput, ToolOutput } from './types';

export interface DragVertexState {
  /** The grabbed vertex's position, captured on press; null when idle. */
  anchor: ModelPoint | null;
}

const IDLE: DragVertexState = { anchor: null };

function beyondTolerance(a: ModelPoint, b: ModelPoint, tolerance: number | undefined): boolean {
  return Math.hypot(b.x - a.x, b.y - a.y) > (tolerance ?? 0);
}

function out(
  state: DragVertexState,
  commit: ToolOutput<DragVertexState>['commit'] = null
): ToolOutput<DragVertexState> {
  return { state, preview: null, commit };
}

export const dragVertexTool: ToolEngine<DragVertexState> = {
  initialState: IDLE,

  reduce(state: DragVertexState, input: ToolInput): ToolOutput<DragVertexState> {
    switch (input.kind) {
      case 'down':
        // The surface only feeds a press it has already resolved to a vertex, and
        // `point` is that vertex — not the cursor.
        return out({ anchor: input.point });

      case 'move':
        // The surface draws the moved star itself, straight into the GPU buffers.
        // Nothing to reduce.
        return out(state);

      case 'up': {
        const anchor = state.anchor;
        if (!anchor) return out(IDLE);
        // A click in place is not a move. Falling through to a commit would send
        // the kernel a zero-length drag, which it refuses anyway — but refusing
        // here keeps a stray click from marking the document dirty.
        if (!beyondTolerance(anchor, input.point, input.tolerance)) return out(IDLE);
        return out(IDLE, { points: [anchor, input.point] });
      }

      case 'cancel':
        return out(IDLE);
    }
  },
};
