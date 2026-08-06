import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Point } from '../lib/geometry';
import type { SymmetryAxis } from '../lib/symmetryGeometry';
import type { ViewportSurface } from '../keyboard/shortcutRuntime';
import type { TreeDragMirror } from './dragRule';
import type { TreeFrame } from './frame';
import type { TreeLengthRule } from './lengths';
import type {
  EditableTree,
  EditableTreeEdge,
  EditableTreeVertex,
  TreeEdgeLengthUpdate,
  TreeSelectionTarget,
  TreeSelectionView,
  TreeVertexUpdate,
} from './model';

/**
 * Everything a surface must answer for the tree editor to run on it.
 *
 * Two rules hold this together, and both were already true of the box-pleat pane
 * this was extracted from:
 *
 * 1. **Intents are fire-and-forget, and `tree` is the only truth.** The editor
 *    never mutates optimistically — it calls an intent and waits for a new tree.
 *    Box-pleat's intents are worker round trips that land a frame or two later;
 *    a local surface's return synchronously. The editor cannot tell, and must
 *    not try.
 * 2. **A gesture in flight writes DOM, not state.** See `sceneDom.ts`. That is
 *    what keeps a drag proportional to what moved rather than to the tree.
 */

export interface TreeSymmetryLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TreeSymmetryPair {
  v1: number;
  v2: number;
}

/**
 * Mirror draw, as the editor needs it.
 *
 * `null` on the host means the surface has no mirror at all: no toggle, no lane,
 * no ghost, and no clamp — rather than a disabled one.
 */
export interface TreeSymmetryHost {
  enabled: boolean;
  toggle(): void;
  axis: SymmetryAxis;
  /** The mirror line clipped to the drawing, in SVG coordinates. */
  axisLine: TreeSymmetryLine | null;
  /**
   * Explicit pairs to join with a segment.
   *
   * The ids, not the endpoints: a drag moves that segment by writing its
   * endpoints, and handing out finished coordinates would put this back on the
   * per-pointer-sample path.
   */
  pairs: readonly TreeSymmetryPair[];
  /** The vertex explicitly paired with this one, if any. */
  partnerOf(vertexId: number): number | null;
  /** Its mirror, explicit or inferred from position; null when none resolves. */
  resolveMirrorOf(vertexId: number): number | null;
  /**
   * Whether this vertex sits on the mirror *and* the drag should refuse it.
   *
   * Such a vertex is its own mirror, so moving it off the line quietly costs it
   * that status and leaves it with nothing to mirror.
   */
  isOnAxis(vertexId: number): boolean;
  unpair(vertexId: number): void;
  /** What a drag of these vertices may not do. Null when none of them is paired. */
  dragMirror(movedIds: readonly number[]): TreeDragMirror | null;
}

/** Which optional layers the surface draws. */
export interface TreeViewLayers {
  labels: boolean;
}

/**
 * Localized strings, supplied by the surface.
 *
 * A bag of finished strings rather than keys, and built with literal `t()` calls
 * in each host's own module — the same shape `designKinds` uses, and for the same
 * reason: `i18n:extract` only sees literal calls, so a descriptor carrying keys
 * as data would make its strings invisible to the extractor.
 */
export interface TreeEditorCopy {
  canvas: string;
  viewportControls: string;
  mirrorDraw: string;
  mirrorDrawOn: string;
  unpair: string;
  layers: string;
  layerLabels: string;
  length: string;
  decreaseLength: string;
  increaseLength: string;
  edgeTitle(from: number, to: number): string;
  edgeLengthGroup(from: number, to: number): string;
  selectEdge(id: number, length: string): string;
  selectVertex(id: number, label: string, isLeaf: boolean): string;
  nameTitle(label: string): string;
  nameAria(label: string): string;
}

export interface TreeEditorHost {
  /** Committed model. A new identity on every change; the scene memoizes on it. */
  tree: EditableTree;
  frame: TreeFrame;
  lengths: TreeLengthRule;
  copy: TreeEditorCopy;
  /**
   * Prefix for this surface's CSS classes (`bp-tree` → `.bp-tree-node`).
   *
   * Every mark also carries a generic class, so shared rules live in one place;
   * the prefix is what lets a surface restyle its own tree without reaching into
   * another's.
   */
  classPrefix: string;
  /** Which surface owns the viewport shortcuts while this pane has focus. */
  surface: ViewportSurface;
  /** Camera-fit identity. Refit when it changes, never on an edit. */
  fitKey: string;
  /** Cap on the opening zoom, so a small tree is not blown up to fill the pane. */
  maxFitScale?: number;

  selection: TreeSelectionView;
  /** Replace the selection with this one thing. */
  select(target: TreeSelectionTarget): void;
  /** Add or remove it, for a shift/meta click. */
  toggleSelection(target: TreeSelectionTarget): void;
  clearSelection(): void;

  /**
   * Add a leaf at `loc`, hanging off `parentId`.
   *
   * `axisTolerance` is the on-screen snap band in tree units; a host with mirror
   * draw uses it to decide whether the new tip lands *on* the axis (one centred
   * leaf) or off it (a mirrored pair).
   */
  addLeaf(parentId: number, loc: Point, axisTolerance: number): void | Promise<void>;
  /** Commit a finished drag. */
  moveVertices(updates: readonly TreeVertexUpdate[]): void | Promise<void>;
  /**
   * Set an edge's length, with the vertex moves that keep the drawing faithful.
   *
   * Both halves land as one undo entry: the length and the geometry that
   * expresses it are one edit, and splitting them lets undo leave a tree whose
   * drawing disagrees with its numbers.
   */
  setEdgeLength(
    lengths: readonly TreeEdgeLengthUpdate[],
    repositions: readonly TreeVertexUpdate[]
  ): void | Promise<void>;
  renameVertex?(vertexId: number, name: string): void | Promise<void>;

  /** How a vertex is labelled on the canvas. Empty for no label. */
  labelOf(vertex: EditableTreeVertex): string;
  /** The placeholder its name field shows when unnamed. */
  defaultLabelOf(vertex: EditableTreeVertex): string;
  /** Whether this vertex offers a name field at all. */
  isNameable(vertex: EditableTreeVertex): boolean;

  symmetry: TreeSymmetryHost | null;

  layers: TreeViewLayers;
  setLayer(layer: keyof TreeViewLayers, visible: boolean): void;

  /** Fired when a pointer press lands on this surface. */
  onSurfaceFocused?(): void;
  /** Fired on a press that may become a long press — BP opens its inspector. */
  onLongPress?(event: ReactPointerEvent): void;
}

/** The single selected edge, or null. */
export function selectedEdge(host: TreeEditorHost): EditableTreeEdge | null {
  const id = host.selection.edgeId;
  if (id === null) return null;
  return host.tree.edges.find((edge) => edge.id === id) ?? null;
}
