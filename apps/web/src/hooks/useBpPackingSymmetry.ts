import { useCallback, useMemo } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../store/workspaceStore';
import {
  BP_TREE_SYMMETRY_ANGLE,
  bpTreeSymmetryDefaultLoc,
  explicitBpTreePairId,
  mirrorBpTreeVertexId,
  type SymmetryFold,
} from '../lib/bpTreeSymmetry';
import { resolveOptimizerSymmetry } from '../lib/bpOptimizerSymmetry';
import {
  bpPackingSheetCenter,
  bpPackingSheetSupportsAxis,
  bpPackingSymmetryAxis,
} from '../lib/bpPackingSymmetry';
import { bpPackingPointToSvg, bpPackingSheetFrame } from '../lib/bpPackingViewport';
import type { bpPackingPaperRect } from '../lib/bpPackingViewport';
import type { OristudioBpSheet, OristudioBpTreeView } from '../engine/oristudioBpTypes';
import type { SymmetryAxis } from '../lib/symmetryGeometry';
import type { Point } from '../lib/geometry';

/**
 * Mirror draw, as the packing pane needs it.
 *
 * The fold — which fold of the paper the mirror becomes — is design state shared
 * with the optimize dialog, so this reads and writes the same
 * `oristudioBpSymmetry` the dialog does. There is no second copy to keep in step:
 * changing it in either place updates the other.
 *
 * The line this pane draws is *not* the line the tree pane draws. The tree's is
 * always vertical through the tree sheet's centre; this one is vertical or
 * diagonal through the layout sheet's centre, depending on the fold and the grid
 * type, so switching folds rotates this line and leaves the tree's alone. The
 * fold is named in the symmetry menu that sets it; the line itself stays bare.
 */

const EMPTY_IDS: ReadonlySet<number> = new Set();

export interface BpPackingSymmetryLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BpPackingSymmetryView {
  enabled: boolean;
  toggle: () => void;
  fold: SymmetryFold;
  setFold: (fold: SymmetryFold) => void;
  /**
   * Why this fold cannot be used on this sheet, or null when it can.
   *
   * A diagonal mirror maps a rectangle onto itself only when it is square, and a
   * rectangular sheet has independent width and height. Answering here lets the
   * control refuse the fold at the moment it is chosen, rather than leaving a
   * drag to fail later with nothing to point at.
   */
  foldUnavailable: (fold: SymmetryFold) => string | null;
  /** The mirror line across the sheet, in SVG coords. Null when mirror draw is off. */
  axisLine: BpPackingSymmetryLine | null;
  /** One line on whether the drawing is actually mirrorable. */
  status: string;
  /** Flaps that mirror the selection — marked, so a mirrored move is no surprise. */
  partnerIds: ReadonlySet<number>;
  /** The selected flap's explicit partner, if any. Null means nothing to unpair. */
  unpairableId: number | null;
  unpair: (vertexId: number) => void;
}

function foldStatus(
  t: TFunction,
  tree: OristudioBpTreeView,
  symmetry: Parameters<typeof resolveOptimizerSymmetry>[1],
  fold: SymmetryFold
): string {
  const resolved = resolveOptimizerSymmetry(tree, symmetry, { fold });
  if (!resolved.ok) return resolved.reason;
  if (resolved.inconsistentPairs.length > 0) {
    return t(
      'panels:bpPacking.symmetryInconsistent',
      'Every flap has a partner, but some pairs are not interchangeable in the tree.'
    );
  }
  return t('panels:bpPacking.symmetryReady', 'Every flap has a partner.');
}

/** The mirror line across the sheet's frame, in grid coordinates. */
function axisEndpoints(sheet: OristudioBpSheet, fold: SymmetryFold): [Point, Point] {
  const frame = bpPackingSheetFrame(sheet);
  const center = bpPackingSheetCenter(sheet);
  const right = frame.originX + frame.spanX;
  const top = frame.originY + frame.spanY;
  switch (bpPackingSymmetryAxis(sheet, fold)) {
    case 'verticalHalf':
      return [
        { x: center.x, y: frame.originY },
        { x: center.x, y: top },
      ];
    case 'horizontalHalf':
      return [
        { x: frame.originX, y: center.y },
        { x: right, y: center.y },
      ];
    case 'mainDiagonal':
      return [
        { x: frame.originX, y: frame.originY },
        { x: right, y: top },
      ];
    case 'antiDiagonal':
      return [
        { x: frame.originX, y: top },
        { x: right, y: frame.originY },
      ];
  }
}

export function useBpPackingSymmetry(
  tree: OristudioBpTreeView,
  sheet: OristudioBpSheet,
  paperRect: ReturnType<typeof bpPackingPaperRect>,
  selectedFlapIds: readonly number[]
): BpPackingSymmetryView {
  const { t } = useTranslation();
  const symmetry = useWorkspaceStore((state) => state.oristudioBpSymmetry);
  const setOristudioBpSymmetry = useWorkspaceStore((state) => state.setOristudioBpSymmetry);
  const unpairOristudioBpTreeSymmetry = useWorkspaceStore(
    (state) => state.unpairOristudioBpTreeSymmetry
  );

  // Enabling rebuilds the tree-space axis from the tree sheet, exactly as the
  // tree pane's toggle does — the two write one flag and must leave it saying
  // the same thing.
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
  }, [setOristudioBpSymmetry, symmetry.enabled, tree.sheet]);

  const setFold = useCallback(
    (fold: SymmetryFold) => setOristudioBpSymmetry({ fold }),
    [setOristudioBpSymmetry]
  );

  const foldUnavailable = useCallback(
    (fold: SymmetryFold) =>
      bpPackingSheetSupportsAxis(sheet, bpPackingSymmetryAxis(sheet, fold))
        ? null
        : t('panels:bpPacking.symmetryNeedsSquare', 'Needs a square sheet.'),
    [sheet, t]
  );

  const axisLine = useMemo(() => {
    if (!symmetry.enabled) return null;
    const [from, to] = axisEndpoints(sheet, symmetry.fold);
    const a = bpPackingPointToSvg(from, sheet, paperRect);
    const b = bpPackingPointToSvg(to, sheet, paperRect);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }, [symmetry.enabled, symmetry.fold, sheet, paperRect]);

  const status = useMemo(
    () => foldStatus(t, tree, symmetry, symmetry.fold),
    [t, tree, symmetry]
  );

  const treeAxis: SymmetryAxis = useMemo(
    () => ({ loc: symmetry.loc, angle: symmetry.angle }),
    [symmetry.loc, symmetry.angle]
  );

  // Not gated on mirror draw: a move carries the partner whatever the toggle
  // says, so the mark that says which flap will follow has to as well.
  const partnerIds = useMemo(() => {
    if (selectedFlapIds.length === 0) return EMPTY_IDS;
    const selected = new Set(selectedFlapIds);
    const partners = new Set<number>();
    for (const id of selectedFlapIds) {
      const partner = mirrorBpTreeVertexId(tree, symmetry.pairs, treeAxis, id);
      if (partner === null || partner === id || selected.has(partner)) continue;
      partners.add(partner);
    }
    return partners;
  }, [symmetry.pairs, selectedFlapIds, tree, treeAxis]);

  const unpairableId = useMemo(() => {
    if (selectedFlapIds.length !== 1) return null;
    const id = selectedFlapIds[0];
    return explicitBpTreePairId(symmetry.pairs, id) === null ? null : id;
  }, [symmetry.pairs, selectedFlapIds]);

  return {
    enabled: symmetry.enabled,
    toggle,
    fold: symmetry.fold,
    setFold,
    foldUnavailable,
    axisLine,
    status,
    partnerIds,
    unpairableId,
    unpair: unpairOristudioBpTreeSymmetry,
  };
}
