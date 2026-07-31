import { useCallback, useMemo } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { BP_TREE_SYMMETRY_ANGLE, bpTreeSymmetryDefaultLoc } from '../lib/bpTreeSymmetry';
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
}

export function useBpTreeSymmetry(
  tree: OristudioBpTreeView,
  paperRect: ReturnType<typeof bpTreePaperRect>
): BpTreeSymmetryView {
  const symmetry = useWorkspaceStore((state) => state.oristudioBpSymmetry);
  const setOristudioBpSymmetry = useWorkspaceStore((state) => state.setOristudioBpSymmetry);

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

  return { enabled: symmetry.enabled, toggle, axisLine };
}
