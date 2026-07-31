import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../store/workspaceStore';
import { bpTreeSymmetryDefaultLoc } from '../lib/bpTreeSymmetry';
import { SYMMETRY_AXIS_ANGLES, symmetryAxisLabel } from '../lib/bpSymmetryLabels';
import { bpTreePointToSvg, bpTreePaperRect } from '../lib/bpTreeViewport';
import type { OristudioBpTreeView } from '../engine/oristudioBpTypes';
import type { Point } from '../lib/geometry';

/**
 * The mirror axis, as the tree view needs it: which axes are on offer, how to
 * switch between them, and where the line falls on screen.
 *
 * Lives beside the panel rather than inside it because it is one concern with a
 * small interface — the tree and its paper rect in, a view-model out — and the
 * panel is a composition site.
 */

export interface BpTreeSymmetryAxisOption {
  value: number;
  label: string;
}

export interface BpTreeSymmetryLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BpTreeSymmetryView {
  enabled: boolean;
  angle: number;
  axisOptions: BpTreeSymmetryAxisOption[];
  toggle: () => void;
  setAxis: (angle: number) => void;
  /** The mirror line clipped to the sheet, in SVG coords. */
  axisLine: BpTreeSymmetryLine | null;
}

export function useBpTreeSymmetry(
  tree: OristudioBpTreeView,
  paperRect: ReturnType<typeof bpTreePaperRect>
): BpTreeSymmetryView {
  const { t } = useTranslation();
  const symmetry = useWorkspaceStore((state) => state.oristudioBpSymmetry);
  const setOristudioBpSymmetry = useWorkspaceStore((state) => state.setOristudioBpSymmetry);

  // Turning symmetry on starts from the vertical axis centred on the sheet,
  // which is the fold most designs want; the axis picker changes it from there.
  const toggle = useCallback(() => {
    if (symmetry.enabled) {
      setOristudioBpSymmetry({ enabled: false });
      return;
    }
    setOristudioBpSymmetry({
      enabled: true,
      loc: bpTreeSymmetryDefaultLoc(tree.sheet),
      angle: 90,
    });
  }, [setOristudioBpSymmetry, tree.sheet, symmetry.enabled]);

  // All four axes pass through the sheet centre, so switching between them only
  // changes the angle. The labels name the fold by what it does to the paper,
  // which depends on the grid: a vertical fold line is a book fold on a
  // rectangular sheet and a diagonal fold on a diamond.
  const axisOptions = useMemo(
    () =>
      SYMMETRY_AXIS_ANGLES.map(({ axis, angle }) => ({
        value: angle,
        label: symmetryAxisLabel(t, tree.sheet.kind, axis),
      })),
    [t, tree.sheet.kind]
  );

  const setAxis = useCallback(
    (angle: number) => {
      setOristudioBpSymmetry({ angle, loc: bpTreeSymmetryDefaultLoc(tree.sheet) });
    },
    [setOristudioBpSymmetry, tree.sheet]
  );

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

  return {
    enabled: symmetry.enabled,
    angle: symmetry.angle,
    axisOptions,
    toggle,
    setAxis,
    axisLine,
  };
}
