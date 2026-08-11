/**
 * Which folder a press of `G` reaches, and how to name what the 3D one says
 * back.
 *
 * Two decisions live here, both pure and both wrong in ways that look right:
 *
 * 1. **Flat or spatial**, decided on the crease ids a fold is *scoped to* — never
 *    on the document. A document-wide predicate gets row (b) of the plan's truth
 *    table wrong: an all-classic selection inside a document that has non-classic
 *    creases elsewhere must fold flat, because the arrangement is built only from
 *    the scoped segments.
 * 2. **Which document line a kernel index names.** The `line` and `worst_edge`
 *    fields of a refusal or a crossing are positions in the kernel's own scoped
 *    slice, not document line ids, and the slice is the document walked in
 *    ascending order. Highlighting `selectedLineIds[k]` therefore points at the
 *    wrong crease whenever the caller's ids are not already sorted.
 *
 * React-free, store-free, and tested on its own — this is model logic, not
 * something a 200-line store action should be computing inline.
 */

import type {
  OristudioCpDocumentSnapshot,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import { isClassicCrease } from '../../lib/foldAngle';
import {
  isOrieditaFoldableLineColor,
  selectedFoldableCpLineIds,
} from '../../lib/creasePatternClipboard';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';

/**
 * What a fold of `scopedLineIds` should do.
 *
 * `lineIds` is the foldable-colour-filtered, kernel-order list in every arm —
 * exactly what both kernel doors take — so a caller never re-derives it.
 */
export type FoldRoute =
  | { kind: 'none' }
  | { kind: 'flat'; lineIds: number[] }
  | { kind: 'spatial'; lineIds: number[]; nonClassicCount: number };

/**
 * Is this segment one the flat folder has no answer for?
 *
 * An exact mirror of the kernel's `is_classic_crease`
 * (`crates/oristudio-cp/src/model/mod.rs`), which is **colour-blind**: it reads
 * `fold_magnitude` and nothing else. The store used to add `isFoldingCrease` to
 * this test, and the two disagree on one input — a `Black0` segment carrying a
 * magnitude. Constructors normalise that away, but the field is public and
 * deserialized, and the share codec copies it without consulting the colour, so
 * it survives an `.osf` or a share link. Under the old conjunct that input
 * routed flat and the kernel answered `fold_needs_3d`; mirroring the kernel
 * exactly makes both routing guards unreachable from this dispatch, which is
 * what "routing is the caller's job" is supposed to mean.
 */
export function isNonClassicSegment(segment: OristudioCpLineSegment): boolean {
  return !isClassicCrease(segment);
}

/**
 * The one routing decision.
 *
 * `scopedLineIds` are the ids the fold was scoped to *before* the foldable-colour
 * filter — the raw selection. Aux colours are dropped here, exactly as the
 * kernel's `selected_folding_segments` drops them, so an all-aux selection is
 * `none` rather than an empty spatial fold.
 */
export function resolveFoldRoute(
  document: OristudioCpDocumentSnapshot | null | undefined,
  scopedLineIds: readonly number[]
): FoldRoute {
  if (!document) return { kind: 'none' };
  const lineIds = selectedFoldableCpLineIds(document, {
    ...emptyOristudioCpSelection(),
    lines: [...scopedLineIds],
  });
  if (lineIds.length === 0) return { kind: 'none' };

  const segments = document.crease_pattern.line_segments;
  let nonClassicCount = 0;
  for (const lineId of lineIds) {
    const segment = segments[lineId - 1];
    if (segment !== undefined && isNonClassicSegment(segment)) nonClassicCount += 1;
  }

  return nonClassicCount > 0
    ? { kind: 'spatial', lineIds, nonClassicCount }
    : { kind: 'flat', lineIds };
}

/**
 * The order the kernel walks a scoped selection in: ascending document index,
 * each segment at most once.
 *
 * `selected_folding_segments` walks the *document* and tests membership rather
 * than walking the caller's id list, so its output is sorted and deduped however
 * the ids arrived. The transform chain from there to a reported index is
 * index-preserving throughout — `snap_to_flat` is a 1:1 map, `FoldGraph::from_
 * segments` pushes one graph line per input segment — so position in this list
 * *is* the kernel's index.
 *
 * A sort is genuinely needed, and not because the canvas produces unsorted ids:
 * `toggleCpSelectionList` sorts. It is needed because `foldOristudioCpDocument`
 * takes caller-supplied `lineIds`, `setOristudioCpSelection` writes its argument
 * verbatim, and a kernel-returned selection is copied straight out of the
 * document. Any of those three can arrive in any order.
 */
export function kernelLineOrder(foldableLineIds: readonly number[]): number[] {
  return [...new Set(foldableLineIds)].sort((a, b) => a - b);
}

/**
 * The document line id a kernel slice index names, or `null` when the index is
 * out of range — which a build skew or a stale entry can produce, and which must
 * not become a highlight of some unrelated crease.
 */
export function documentLineIdForKernelLine(
  order: readonly number[],
  kernelIndex: number | null | undefined
): number | null {
  if (kernelIndex == null || !Number.isInteger(kernelIndex) || kernelIndex < 0) return null;
  return order[kernelIndex] ?? null;
}

/**
 * Map a whole list of kernel indices, dropping any that name nothing.
 *
 * Plural because two wire arms carry pairs — `chords` names two lines and
 * `contradictory_seeds` names two seeds — and a partial answer is still worth
 * selecting.
 */
export function documentLineIdsForKernelLines(
  order: readonly number[],
  kernelIndices: readonly (number | null | undefined)[]
): number[] {
  const ids: number[] = [];
  for (const index of kernelIndices) {
    const id = documentLineIdForKernelLine(order, index);
    if (id !== null && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Re-exported so callers testing a colour do not reach past this module. */
export { isOrieditaFoldableLineColor };
