import { useCallback, useMemo } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import {
  BP_TREE_SYMMETRY_ANGLE,
  BP_TREE_SYMMETRY_TOLERANCE,
  bpTreeSymmetryDefaultLoc,
  bpTreeMirrorHeldIds,
  explicitBpTreePairId,
  type BpTreeSymmetryPair,
} from '../lib/bpTreeSymmetry';
import { symmetrySide } from '../lib/symmetryGeometry';
import type { BpTreeDragMirror } from '../lib/bpTreeAuthoring';
import { bpTreePointToSvg, bpTreePaperRect } from '../lib/bpTreeViewport';
import type { OristudioBpTreeView } from '../engine/oristudioBpTypes';
import type { Point } from '../lib/geometry';

/**
 * Mirror draw, as the tree view needs it: whether it is on, and where the mirror
 * line falls on screen.
 *
 * Which fold the axis *is* belongs to the optimizer dialog, not here — a tree is
 * not drawn on the paper, so there is nothing in this view to call a book or a
 * diagonal fold. The tree only needs a line to reflect across.
 *
 * Lives beside the panel rather than inside it because it is one concern with a
 * small interface — the tree and its paper rect in, a view-model out — and the
 * panel is a composition site.
 */

export interface BpTreeSymmetryLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BpTreeSymmetryView {
  enabled: boolean;
  toggle: () => void;
  /** The mirror line clipped to the sheet, in SVG coords. */
  axisLine: BpTreeSymmetryLine | null;
  /**
   * The explicit pairs to join with a segment, or empty when mirror draw is off.
   *
   * The ids, not the endpoints: the scene turns them into a line, and a drag
   * moves that line by writing its endpoints rather than by re-rendering. Handing
   * out finished coordinates would put this hook back on the per-pointer-sample
   * path it was on before.
   */
  pairs: readonly BpTreeSymmetryPair[];
  /** The vertex this one is explicitly mirrored with, if any. */
  partnerOf: (vertexId: number) => number | null;
  /**
   * Whether this vertex sits on the mirror line *and* the drag should refuse it.
   *
   * Such a vertex is its own mirror, so moving it off the line quietly costs it
   * that status — and leaves it with nothing to mirror. The tree view refuses the
   * drag rather than letting the symmetry break unnoticed.
   *
   * Alone among the answers here this one does key off mirror draw, and
   * deliberately: it is the only place that *refuses* a gesture, so turning the
   * toggle off has to be the way to move a centre node. Everything else — the
   * pairs, their segment, the mirrored move — survives the toggle, because a
   * pairing is part of the design and the toggle only decides whether the next
   * node is drawn with a twin.
   */
  isOnAxis: (vertexId: number) => boolean;
  unpair: (vertexId: number) => void;
  /**
   * What a drag of these vertices may not do: the axis, and which of them are
   * held in their own half of it.
   *
   * Null when none of them is paired, which is the common case and lets the drag
   * skip the clamp entirely.
   */
  dragMirror: (movedIds: readonly number[]) => BpTreeDragMirror | null;
}

export function useBpTreeSymmetry(
  tree: OristudioBpTreeView,
  paperRect: ReturnType<typeof bpTreePaperRect>
): BpTreeSymmetryView {
  const symmetry = useWorkspaceStore((state) => state.oristudioBpSymmetry);
  const setOristudioBpSymmetry = useWorkspaceStore((state) => state.setOristudioBpSymmetry);
  const unpairOristudioBpTreeSymmetry = useWorkspaceStore(
    (state) => state.unpairOristudioBpTreeSymmetry
  );

  const toggle = useCallback(() => {
    if (symmetry.enabled) {
      setOristudioBpSymmetry({ enabled: false });
      return;
    }
    setOristudioBpSymmetry({
      enabled: true,
      loc: bpTreeSymmetryDefaultLoc(tree.sheet),
      angle: BP_TREE_SYMMETRY_ANGLE,
    });
  }, [setOristudioBpSymmetry, tree.sheet, symmetry.enabled]);


  const axisLine = useMemo(() => {
    if (!symmetry.enabled) return null;
    const w = Math.max(1, tree.sheet.width);
    const h = Math.max(1, tree.sheet.height);
    const rad = (symmetry.angle * Math.PI) / 180;
    const dir = { x: Math.cos(rad), y: Math.sin(rad) };
    const hits: Point[] = [];
    const push = (p: Point) => {
      if (p.x >= -1e-6 && p.x <= w + 1e-6 && p.y >= -1e-6 && p.y <= h + 1e-6) hits.push(p);
    };
    if (Math.abs(dir.x) > 1e-9) {
      for (const bx of [0, w]) {
        const step = (bx - symmetry.loc.x) / dir.x;
        push({ x: bx, y: symmetry.loc.y + step * dir.y });
      }
    }
    if (Math.abs(dir.y) > 1e-9) {
      for (const by of [0, h]) {
        const step = (by - symmetry.loc.y) / dir.y;
        push({ x: symmetry.loc.x + step * dir.x, y: by });
      }
    }
    if (hits.length < 2) return null;
    // Take the two most distant intersection points.
    let a = hits[0];
    let b = hits[1];
    let best = -1;
    for (let i = 0; i < hits.length; i += 1) {
      for (let j = i + 1; j < hits.length; j += 1) {
        const d = Math.hypot(hits[i].x - hits[j].x, hits[i].y - hits[j].y);
        if (d > best) {
          best = d;
          a = hits[i];
          b = hits[j];
        }
      }
    }
    const p1 = bpTreePointToSvg(a, tree.sheet, paperRect);
    const p2 = bpTreePointToSvg(b, tree.sheet, paperRect);
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  }, [symmetry.enabled, symmetry.angle, symmetry.loc, tree.sheet, paperRect]);

  // Not gated on mirror draw. A pairing belongs to the design, so the segment
  // joining a pair — and the unpair it enables — stay put when the user stops
  // drawing symmetrically. The toggle only decides whether the *next* node is
  // drawn with a twin.
  const pairs = symmetry.pairs;

  const partnerOf = useCallback(
    (vertexId: number) => explicitBpTreePairId(symmetry.pairs, vertexId),
    [symmetry.pairs]
  );

  const isOnAxis = useCallback(
    (vertexId: number) => {
      if (!symmetry.enabled) return false;
      const loc = tree.vertices.find((vertex) => vertex.id === vertexId)?.loc;
      if (!loc) return false;
      const axis = { loc: symmetry.loc, angle: symmetry.angle };
      return symmetrySide(loc, axis, BP_TREE_SYMMETRY_TOLERANCE) === 0;
    },
    [symmetry.enabled, symmetry.loc, symmetry.angle, tree.vertices]
  );

  const dragMirror = useCallback(
    (movedIds: readonly number[]): BpTreeDragMirror | null => {
      const axis = { loc: symmetry.loc, angle: symmetry.angle };
      const heldIds = bpTreeMirrorHeldIds(tree, symmetry.pairs, axis, movedIds);
      // The same band `symmetrySide` calls "on the axis", so a held vertex can
      // never be reclassified as its own mirror by getting close enough.
      return heldIds.size === 0
        ? null
        : { axis, heldIds, clearance: BP_TREE_SYMMETRY_TOLERANCE };
    },
    [symmetry.loc, symmetry.angle, symmetry.pairs, tree]
  );

  return {
    enabled: symmetry.enabled,
    toggle,
    dragMirror,
    axisLine,
    pairs,
    partnerOf,
    isOnAxis,
    unpair: unpairOristudioBpTreeSymmetry,
  };
}
