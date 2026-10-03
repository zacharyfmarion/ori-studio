/**
 * Which creases a linked step is made of (D3), chosen the one way capture,
 * Refresh and link status all use: from the document snapshot the capture
 * starts from, so a step can never read stale against the pattern it was just
 * made from.
 *
 * - A **segment** step finds its region again by its rim (`resolveRegion`, in
 *   the kernel-space segmentation the selection toolbar uses), and is made of
 *   every crease inside it.
 * - A **figure-bounds** step re-chooses its creases by overlap with the box an
 *   Edit figure was folded from, exactly as Edit refolds.
 *
 * In both, what is folded — and what the fingerprint is taken over — is the
 * scope's foldable lines, in kernel order.
 *
 * Pure: no store, no kernel.
 */
import type { FoldArtifacts } from '../../engine/types';
import type {
  FoldedSourceBounds,
  OristudioCpDocumentSnapshot,
} from '../../engine/oristudioCpTypes';
import {
  cpLinesByIds,
  foldedSourceFingerprint,
  reselectFoldableLineIds,
  reselectSourceLineIds,
} from '../../cp-workspace/folded/foldedFigureStaleness';
import { kernelLineOrder } from '../../cp-workspace/folded/foldRoute';
import { resolveRegion } from '../../cp-workspace/regions/regionReference';
import { selectedFoldableCpLineIds } from '../../lib/creasePatternClipboard';
import { resolveCpSegments, type CpSegment } from '../../lib/creasePatternSegmentation';
import { segmentContainedLineIds } from '../../lib/creasePatternSelectionSegment';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import type { Point } from '../../lib/geometry';
import type { DiagramCpRender, DiagramCpScope } from '../document/diagramDocument';

export interface StepCreases {
  /** Every line the scope covers, aux lines included: what a crease-pattern picture draws. */
  scopedLineIds: number[];
  /** The scope's foldable lines, in kernel order: what is folded, and what {@link fingerprint} covers. */
  foldLineIds: number[];
  /** `foldedSourceFingerprint` over {@link foldLineIds}: what a folded picture is of. */
  fingerprint: string;
  /**
   * `foldedSourceFingerprint` over {@link scopedLineIds}: what a crease-pattern
   * picture draws, aux lines included, so moving one marks it out of date.
   */
  drawnFingerprint: string;
  /**
   * The paper the scope covers, in pattern units: the region's rim, or the
   * figure's box. A crease-pattern picture fills it.
   */
  paper: Point[][];
  /**
   * The box lines are cut to, for a figure-bounds scope: its overlap rule takes
   * a crease that merely crosses the box. Null for a region, whose creases lie
   * inside it.
   */
  clip: FoldedSourceBounds | null;
  /** The region, for a segment scope: what its thumbnail is drawn from. */
  segment: CpSegment | null;
}

/**
 * A scope's creases today, or why there are none:
 * - `missing`: the region is gone (merged, split, its rim no longer all
 *   border), or no foldable crease overlaps the box;
 * - `unknown`: a region cannot be looked for yet, because the segmentation is
 *   not ready.
 */
export type StepCreaseChoice =
  | { status: 'found'; creases: StepCreases }
  | { status: 'missing' }
  | { status: 'unknown' };

export function chooseStepCreases(
  document: OristudioCpDocumentSnapshot,
  scope: DiagramCpScope,
  segmentation: FoldArtifacts | null
): StepCreaseChoice {
  if (scope.kind === 'segment') {
    if (!segmentation) return { status: 'unknown' };
    const segment = resolveRegion(scope.region, resolveCpSegments(segmentation));
    if (!segment) return { status: 'missing' };
    const scopedLineIds = segmentContainedLineIds(document, segmentation, segment);
    const foldLineIds = kernelLineOrder(
      selectedFoldableCpLineIds(document, { ...emptyOristudioCpSelection(), lines: scopedLineIds })
    );
    if (foldLineIds.length === 0) return { status: 'missing' };
    return {
      status: 'found',
      creases: {
        scopedLineIds,
        foldLineIds,
        fingerprint: foldedSourceFingerprint(cpLinesByIds(document, foldLineIds)),
        drawnFingerprint: foldedSourceFingerprint(cpLinesByIds(document, scopedLineIds)),
        paper: segment.boundary,
        clip: null,
        segment,
      },
    };
  }
  const { bounds } = scope;
  const foldLineIds = kernelLineOrder(reselectFoldableLineIds(document, bounds));
  if (foldLineIds.length === 0) return { status: 'missing' };
  const scopedLineIds = reselectSourceLineIds(document, bounds);
  return {
    status: 'found',
    creases: {
      scopedLineIds,
      foldLineIds,
      fingerprint: foldedSourceFingerprint(cpLinesByIds(document, foldLineIds)),
      drawnFingerprint: foldedSourceFingerprint(cpLinesByIds(document, scopedLineIds)),
      paper: [
        [
          { x: bounds.minX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.maxY },
          { x: bounds.minX, y: bounds.maxY },
        ],
      ],
      clip: bounds,
      segment: null,
    },
  };
}

/**
 * The fingerprint a step keeps for its creases, by how it shows them: a
 * crease pattern is of every line it draws, a fold of the lines it folds —
 * an aux line changes the one and not the other.
 */
export function creasesFingerprint(creases: StepCreases, render: Pick<DiagramCpRender, 'mode'>): string {
  return render.mode === 'crease-pattern' ? creases.drawnFingerprint : creases.fingerprint;
}
