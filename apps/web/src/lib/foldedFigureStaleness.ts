import type {
  FoldedSourceBounds,
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedFigureEntry,
  OristudioCpLineSegment,
} from '../engine/oristudioCpTypes';
import { isOrieditaFoldableLineColor } from './creasePatternClipboard';

/**
 * Whether a folded figure still matches the creases it was folded from — a port
 * of Oriedita's refold check.
 *
 * ## Upstream
 *
 * Oriedita has no per-figure "stale" flag. It makes the decision at Fold time,
 * in `FoldingServiceImpl.fold`'s `FOR_EXISTING_FOLDED_FIGURE_3` branch
 * (`third_party/oriedita/.../service/impl/FoldingServiceImpl.java`):
 *
 * 1. A figure's provenance is its **bounding box**, set in
 *    `FoldedFigure_Drawer.folding_estimated` as
 *    `GetBoundingBox.getBoundingBox(lineSegmentSet)` — the axis-aligned rect of
 *    the very line set that was folded, in flat CP coordinates. That box, not a
 *    list of line ids, is the whole record of "which creases made this figure".
 * 2. To refold, it re-derives the set: `foldLineSet.select(boundingBox)` picks
 *    the creases overlapping that rect, and `getForSelectFolding()` keeps the
 *    selected *folding* lines (`getSaveForSelectFolding`).
 * 3. It compares that set to the previous one with
 *    `LineSegmentSet.contentEquals`: equal counts, and every segment of one
 *    present in a hash set of the other.
 * 4. Equal → refold in place, keeping constraints and starting face. Different
 *    → discard the figure and fold a fresh one.
 *
 * ## Deviations, and why
 *
 * - **Per figure, not per service.** Upstream keeps one `lastFold` field on the
 *   folding service, so with several figures open the baseline belongs to
 *   whichever was folded last and "unchanged" can be wrong for any other; it is
 *   also never assigned when folding from an explicit selection. We store the
 *   baseline on the entry. Same test, correct in more cases.
 * - **Changed creases refold in place; they do not destroy the figure.** A
 *   folded figure here is a placed, scaled, styled canvas object, not the
 *   transient view it is upstream, so discarding it on any edit would be
 *   hostile. The fold itself, the selection rule and the equality test are
 *   unchanged.
 * - **`selected` is excluded from the fingerprint.** `LineSegment.equals`
 *   compares it, but upstream only ever compares sets that came from
 *   `getSaveForSelectFolding`, where it is uniformly `2` and so never varies.
 *   Ours does vary, and including it would make every figure look stale the
 *   moment the user clicks a crease.
 */

export type { FoldedSourceBounds };

/**
 * Bounding box of the creases a figure was folded from.
 * Port of `GetBoundingBox.getBoundingBox`. Null for an empty set.
 */
export function foldedSourceBounds(
  lines: readonly OristudioCpLineSegment[]
): FoldedSourceBounds | null {
  if (lines.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    minX = Math.min(minX, line.a.x, line.b.x);
    minY = Math.min(minY, line.a.y, line.b.y);
    maxX = Math.max(maxX, line.a.x, line.b.x);
    maxY = Math.max(maxY, line.a.y, line.b.y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Whether any part of the segment lies in the closed rect.
 *
 * Port of `Polygon.totu_boundary_inside(LineSegment)`, which returns true when
 * the segment meets **any** boundary edge or its midpoint is inside — i.e. when
 * the segment overlaps the closed polygon at all, not when it is contained by
 * it. For an axis-aligned rect that is the standard segment/AABB overlap test,
 * implemented here by Liang–Barsky clipping.
 *
 * Consequence worth keeping in mind: a crease that merely crosses the figure's
 * region counts as one of its source creases, exactly as upstream.
 */
export function segmentOverlapsBounds(
  line: OristudioCpLineSegment,
  bounds: FoldedSourceBounds
): boolean {
  const dx = line.b.x - line.a.x;
  const dy = line.b.y - line.a.y;

  // Degenerate segment (a point): inside iff the point is in the rect.
  if (dx === 0 && dy === 0) {
    return (
      line.a.x >= bounds.minX &&
      line.a.x <= bounds.maxX &&
      line.a.y >= bounds.minY &&
      line.a.y <= bounds.maxY
    );
  }

  let tMin = 0;
  let tMax = 1;
  const edges: Array<[number, number]> = [
    [-dx, line.a.x - bounds.minX],
    [dx, bounds.maxX - line.a.x],
    [-dy, line.a.y - bounds.minY],
    [dy, bounds.maxY - line.a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      // Parallel to this edge: outside its slab means no overlap at all.
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > tMax) return false;
      if (r > tMin) tMin = r;
    } else {
      if (r < tMin) return false;
      if (r < tMax) tMax = r;
    }
  }
  return tMin <= tMax;
}

/**
 * The creases a figure would be folded from today: foldable-coloured lines
 * overlapping its recorded region. Port of `FoldLineSet.select(Polygon)`
 * composed with `getSaveForSelectFolding`'s folding-line filter.
 *
 * Returns 1-based line ids, matching the rest of the CP selection model.
 */
export function reselectFoldableLineIds(
  document: OristudioCpDocumentSnapshot | null | undefined,
  bounds: FoldedSourceBounds | null
): number[] {
  if (!document || !bounds) return [];
  const ids: number[] = [];
  const lines = document.crease_pattern.line_segments;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || !isOrieditaFoldableLineColor(line.color)) continue;
    if (segmentOverlapsBounds(line, bounds)) ids.push(index + 1);
  }
  return ids;
}

/** The lines behind 1-based ids, skipping any that no longer resolve. */
export function cpLinesByIds(
  document: OristudioCpDocumentSnapshot | null | undefined,
  ids: readonly number[]
): OristudioCpLineSegment[] {
  if (!document) return [];
  const lines: OristudioCpLineSegment[] = [];
  for (const id of ids) {
    const line = document.crease_pattern.line_segments[id - 1];
    if (line) lines.push(line);
  }
  return lines;
}

/** One segment's identity, positionally in `a`/`b` as `LineSegment.equals` is. */
function segmentKey(line: OristudioCpLineSegment): string {
  const { customized_color: cc } = line;
  return [
    line.a.x,
    line.a.y,
    line.b.x,
    line.b.y,
    line.active,
    line.color,
    line.customized,
    cc.red,
    cc.green,
    cc.blue,
  ].join(',');
}

/**
 * An order-independent digest of a crease set, standing in for
 * `LineSegmentSet.contentEquals`: two sets share a fingerprint exactly when they
 * have the same segments with the same multiplicities.
 *
 * Sorting rather than hashing keeps it exact — no collisions to reason about —
 * and the cost is irrelevant beside the fold it guards.
 */
export function foldedSourceFingerprint(lines: readonly OristudioCpLineSegment[]): string {
  return lines.map(segmentKey).sort().join(';');
}

/**
 * Whether `figure`'s source creases have changed since it was folded.
 *
 * A figure with no recorded provenance — folded before this was tracked, or
 * loaded from an older `.osf` — reports **not** stale: we cannot tell, and
 * offering a refold we cannot perform is worse than staying quiet.
 */
export function isFoldedFigureStale(
  document: OristudioCpDocumentSnapshot | null | undefined,
  figure: OristudioCpFoldedFigureEntry
): boolean {
  if (!document) return false;
  if (figure.sourceBounds == null || figure.sourceFingerprint == null) return false;
  // Only figures folded from this document's creases have creases to drift.
  if (figure.sourceKind !== 'generated-from-current-cp') return false;
  const ids = reselectFoldableLineIds(document, figure.sourceBounds);
  const fingerprint = foldedSourceFingerprint(cpLinesByIds(document, ids));
  return fingerprint !== figure.sourceFingerprint;
}
