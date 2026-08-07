import { treeDragUpdates, type TreeDragLengthRule, type TreeDragMirror } from './dragRule';
import { createQuantizeState, type QuantizeState } from './lengths';
import { hasPassedDragThreshold } from '../lib/pointerGesture';
import {
  applyTreeScenePositions,
  collectTreeSceneTargets,
  type TreeSceneTarget,
} from './sceneDom';
import type { Point } from '../lib/geometry';
import type { SymmetryAxis } from '../lib/symmetryGeometry';

/**
 * A tree-vertex drag, run without React.
 *
 * React draws the committed tree; this moves what it drew. A pointer sample only
 * records a position — the arithmetic and the DOM writes happen once per frame,
 * for the subtree that actually rotates, so the cost of a drag is set by the size
 * of that subtree rather than by the size of the tree.
 *
 * The drag *rule* stays in {@link treeDragUpdates}, unchanged and shared with
 * the commit, so the live preview and the move that lands can't drift apart.
 * This owns only when that rule runs and where its answer is written.
 */

export interface TreeDragStart {
  /** The rendered scene, whose elements this drag will move. */
  root: ParentNode;
  vertexId: number;
  /** Null when the vertex has no parent to rotate about; the drag then moves nothing. */
  parentId: number | null;
  /** Committed positions of every vertex, tree space. */
  vertices: ReadonlyMap<number, Point>;
  /** The dragged vertex and everything hanging below it. */
  subtreeIds: readonly number[];
  /** Holds paired vertices in their own half of the mirror. Null when none are. */
  mirror?: TreeDragMirror | null;
  /** Slides the dragged vertex along this line instead of swinging it. */
  pinToAxis?: SymmetryAxis | null;
  /**
   * Where a committed move would *also* put vertices: the mirror partners of the
   * ones being dragged.
   *
   * The commit adds these itself, so without them here the partner sat still
   * through the whole gesture and jumped into place on release. Supplied rather
   * than derived, because only the surface knows what is paired with what — but
   * the reflection is the same on both, so neither has to say how.
   */
  reflect?: ((updates: ReadonlyMap<number, Point>) => ReadonlyMap<number, Point>) | null;
  /** Ids `reflect` may return, so their scene elements are collected up front. */
  reflectedIds?: readonly number[];
  /** Where the gesture may put a vertex. Omit on a surface with no bounds. */
  bounds?: (point: Point) => boolean;
  /**
   * How the dragged edge's length follows the cursor, and its starting value.
   *
   * `quantize` takes the per-gesture snapping state this session owns, so the
   * length does not flicker while the cursor sits on a snap boundary.
   */
  length: Omit<TreeDragLengthRule, 'quantize'> & {
    quantize: (distance: number, state: QuantizeState) => number;
  };
  /** Live readout of the dragged edge's length, written straight to the label. */
  onLength?: (length: number) => void;
  clientStart: Point;
  /** Client point to tree space. Owns the camera, so the controller need not. */
  toTreePoint: (client: Point) => Point;
  /** Tree space to SVG space, for writing the attributes back. */
  toSvgPoint: (loc: Point) => Point;
  /** Screen pixels to SVG units, for the counter-scaled label offsets. */
  chromePx: (px: number) => number;
  /** Injected so tests can run a frame synchronously. */
  schedule?: (callback: () => void) => number;
  unschedule?: (handle: number) => void;
}

export interface TreeDragSession {
  readonly vertexId: number;
  /** Where this drag would leave each moved vertex. Empty until it moves. */
  readonly updates: ReadonlyMap<number, Point>;
  /** The length the dragged edge would take. */
  readonly length: number;
  /** Whether the pointer has travelled far enough to be a drag and not a click. */
  readonly moved: boolean;
  /** Record a pointer sample. The DOM is written on the next frame. */
  move: (client: Point) => void;
  /** Drop any pending frame. Safe to call more than once. */
  end: () => void;
}

export function startTreeDrag(input: TreeDragStart): TreeDragSession {
  const {
    root,
    vertexId,
    parentId,
    vertices,
    subtreeIds,
    bounds,
    length,
    onLength,
    mirror = null,
    pinToAxis = null,
    reflect = null,
    reflectedIds = [],
    clientStart,
    toTreePoint,
    toSvgPoint,
    chromePx,
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
  let targets: TreeSceneTarget[] | null = null;

  let updates: ReadonlyMap<number, Point> = new Map();
  let edgeLength = length.current;
  // Snapping remembers what it last answered, so the length does not flicker
  // while the cursor sits on a boundary. Per gesture, so it resets with it.
  const quantizeState = createQuantizeState();
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
    const target = toTreePoint(client);
    const result = treeDragUpdates({
      vertexId,
      parentId,
      vertices,
      subtreeIds,
      start,
      target,
      mirror,
      pinToAxis,
      bounds,
      length: {
        ...length,
        quantize: (distance) => length.quantize(distance, quantizeState),
      },
    });
    // The partner moves with the gesture rather than on release. Merged into the
    // session's own updates, so what the preview shows is what gets committed —
    // and re-reflecting at commit is harmless, since a partner already in the
    // moved set is skipped there.
    const reflected = reflect?.(result.updates);
    if (reflected && reflected.size > 0) {
      const merged = new Map(result.updates);
      for (const [id, loc] of reflected) merged.set(id, loc);
      updates = merged;
    } else {
      updates = result.updates;
    }
    if (result.length !== edgeLength) {
      edgeLength = result.length;
      onLength?.(edgeLength);
    }
    targets ??= collectTreeSceneTargets(root, new Set([...subtreeIds, ...reflectedIds]));
    applyTreeScenePositions(
      targets,
      (id) => {
        const loc = locOf(id);
        return loc && toSvgPoint(loc);
      },
      chromePx
    );
  };

  return {
    vertexId,
    get updates() {
      return updates;
    },
    get length() {
      return edgeLength;
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
      if (frame !== null) return;
      // `applyPending` clears the slot when it runs, and a scheduler that runs
      // its callback synchronously — which test stubs do — has already run it by
      // the time we get the handle back. Storing it then would leave the slot
      // holding a frame that has been and gone, and every later sample would be
      // dropped as "already scheduled".
      let ran = false;
      const handle = schedule(() => {
        ran = true;
        applyPending();
      });
      if (!ran) frame = handle;
    },
    end() {
      if (frame !== null) unschedule(frame);
      frame = null;
      pending = null;
    },
  };
}
