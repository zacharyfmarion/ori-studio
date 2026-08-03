import { bpTreeDragUpdates } from './bpTreeAuthoring';
import { constrainBpTreePoint } from './bpTreeViewport';
import { hasPassedDragThreshold } from './pointerGesture';
import {
  applyBpTreeScenePositions,
  collectBpTreeSceneTargets,
  type BpTreeSceneTarget,
} from './bpTreeSceneDom';
import type { OristudioBpSheet } from '../engine/oristudioBpTypes';
import type { Point } from './geometry';

/**
 * A tree-vertex drag, run without React.
 *
 * React draws the committed tree; this moves what it drew. A pointer sample only
 * records a position — the arithmetic and the DOM writes happen once per frame,
 * for the subtree that actually rotates, so the cost of a drag is set by the size
 * of that subtree rather than by the size of the tree.
 *
 * The drag *rule* stays in {@link bpTreeDragUpdates}, unchanged and shared with
 * the commit, so the live preview and the move that lands can't drift apart.
 * This owns only when that rule runs and where its answer is written.
 */

export interface BpTreeDragStart {
  /** The rendered scene, whose elements this drag will move. */
  root: ParentNode;
  vertexId: number;
  /** Null when the vertex has no parent to rotate about; the drag then moves nothing. */
  parentId: number | null;
  /** Committed positions of every vertex, tree space. */
  vertices: ReadonlyMap<number, Point>;
  /** The dragged vertex and everything hanging below it. */
  subtreeIds: readonly number[];
  sheet: OristudioBpSheet;
  clientStart: Point;
  /** Client point to tree space. Owns the camera, so the controller need not. */
  toTreePoint: (client: Point) => Point;
  /** Tree space to SVG space, for writing the attributes back. */
  toSvgPoint: (loc: Point) => Point;
  /** Injected so tests can run a frame synchronously. */
  schedule?: (callback: () => void) => number;
  unschedule?: (handle: number) => void;
}

export interface BpTreeDragSession {
  readonly vertexId: number;
  /** Where this drag would leave each moved vertex. Empty until it moves. */
  readonly updates: ReadonlyMap<number, Point>;
  /** Whether the pointer has travelled far enough to be a drag and not a click. */
  readonly moved: boolean;
  /** Record a pointer sample. The DOM is written on the next frame. */
  move: (client: Point) => void;
  /** Drop any pending frame. Safe to call more than once. */
  end: () => void;
}

export function startBpTreeDrag(input: BpTreeDragStart): BpTreeDragSession {
  const {
    root,
    vertexId,
    parentId,
    vertices,
    subtreeIds,
    sheet,
    clientStart,
    toTreePoint,
    toSvgPoint,
    schedule = requestAnimationFrame,
    unschedule = cancelAnimationFrame,
  } = input;

  const start = vertices.get(vertexId) ?? { x: 0, y: 0 };
  // One pass over the scene per gesture rather than per frame — this is what
  // keeps a pointer sample proportional to the subtree and not to the tree.
  //
  // Resolved on the first frame rather than here, because pressing a dot also
  // selects it, and selection changes the dot's radius and so the offset its
  // label is drawn at. Reading the scene before React has committed that would
  // cache the offsets the drag is about to invalidate. It also means a press
  // that never moves does not pay for the scan at all.
  let targets: BpTreeSceneTarget[] | null = null;

  let updates: ReadonlyMap<number, Point> = new Map();
  let moved = false;
  let pending: Point | null = null;
  let frame: number | null = null;

  /** A moved vertex's new home, else where it has always been. */
  const locOf = (id: number): Point | undefined => updates.get(id) ?? vertices.get(id);

  const applyPending = () => {
    frame = null;
    const client = pending;
    pending = null;
    if (!client) return;
    const target = constrainBpTreePoint(toTreePoint(client), sheet);
    const rotated = bpTreeDragUpdates({
      vertexId,
      parentId,
      vertices,
      subtreeIds,
      start,
      target,
    });
    const next = new Map<number, Point>();
    for (const [id, loc] of rotated) next.set(id, constrainBpTreePoint(loc, sheet));
    updates = next;
    targets ??= collectBpTreeSceneTargets(root, new Set(subtreeIds));
    applyBpTreeScenePositions(targets, (id) => {
      const loc = locOf(id);
      return loc && toSvgPoint(loc);
    });
  };

  return {
    vertexId,
    get updates() {
      return updates;
    },
    get moved() {
      return moved;
    },
    move(client) {
      // Answered now, not on the frame: a release can arrive before the frame
      // does, and whether this was a drag or a click decides what that release
      // means.
      moved ||= hasPassedDragThreshold(clientStart, client);
      pending = client;
      if (frame === null) frame = schedule(applyPending);
    },
    end() {
      if (frame !== null) unschedule(frame);
      frame = null;
      pending = null;
    },
  };
}
