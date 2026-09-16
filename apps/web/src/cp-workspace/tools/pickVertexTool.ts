/**
 * `pick-vertex` tool engine (`VertexPin`): click a vertex, and it is pinned —
 * or unpinned, if it already was.
 *
 *   press on a vertex → commit
 *
 * Sibling of {@link import('./dragVertexTool').dragVertexTool} and deliberately
 * not the same engine, because their contracts are opposites: Move Vertex says a
 * click in place "simply does nothing", and here a click in place is the entire
 * gesture. Reusing that engine would mean changing its rule for both tools, and
 * the click-vs-drag test it exists to make is meaningless for a tool with no
 * drag.
 *
 * What it *does* share is the surface's vertex resolution. The press is gated on
 * a vertex being under the cursor and `point` is that vertex — not the cursor —
 * so a click 3 px off pins the junction rather than a position 3 px beside it,
 * which for a pin matters more than it does for a drag: the pin is matched
 * against crease endpoints later, and one placed off-vertex would match nothing
 * and hold nothing.
 *
 * Committing on **press** rather than release is the other difference. There is
 * no drag to interpret, nothing to preview, and no way to change your mind
 * mid-gesture; waiting for the release would only add a frame of latency to a
 * toggle. A miss commits nothing and starts nothing — the same "no marquee
 * fallback" rule Move Vertex follows, for the same reason: reaching for a
 * junction and missing must not wipe the selection.
 */
import type { ToolEngine, ToolInput, ToolOutput } from './types';

/** Stateless: each press is a whole gesture. */
export type PickVertexState = Record<string, never>;

const IDLE: PickVertexState = {};

function out(commit: ToolOutput<PickVertexState>['commit'] = null): ToolOutput<PickVertexState> {
  return { state: IDLE, preview: null, commit };
}

export const pickVertexTool: ToolEngine<PickVertexState> = {
  initialState: IDLE,

  reduce(_state: PickVertexState, input: ToolInput): ToolOutput<PickVertexState> {
    switch (input.kind) {
      case 'down':
        // The surface only feeds a press it has already resolved to a vertex,
        // and `point` is that vertex.
        return out({ points: [input.point] });

      case 'move':
      case 'up':
      case 'cancel':
        return out();
    }
  },
};
