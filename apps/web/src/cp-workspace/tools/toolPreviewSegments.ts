/**
 * Kernel preview geometry, as the surface wants it.
 *
 * The kernel answers a preview with full `LineSegment`s — colour, fold angle and
 * all. Most of that is noise to the canvas: nearly every tool draws its candidate
 * in the *active* line type, so a candidate is geometry and nothing more, and the
 * surface strokes the lot in one colour.
 *
 * The vertex-completion tool is the exception. Its solver decides the crease
 * itself — mountain or valley, and how far it folds — so dropping that here would
 * show a candidate in one crease's clothing while the commit made another. Those
 * candidates keep their crease, and the stroke builder resolves it exactly the way
 * the document is resolved.
 *
 * Two conditions, because either alone is wrong:
 *
 * - **the tool must be one whose candidates the kernel decided**, or an ordinary
 *   tool's preview would start ignoring the active line type;
 * - **the segment must be a folding crease**, because a preview also carries
 *   indicator geometry — the angle-system fan's `Orange4`/`Green6` rays, circle
 *   rings — and those are drawn *about* the pattern rather than being creases in
 *   it.
 */
import type { OristudioCpLineSegment } from '../../engine/oristudioCpTypes';
import {
  cpCommandCandidatesCarryCrease,
  type OristudioCpOperationId,
} from '../../lib/oristudioCpCommands';
import { isFoldingCrease } from '../../lib/foldAngle';
import type { ToolPreviewSegment } from './types';

export function toolPreviewSegments(
  segments: readonly OristudioCpLineSegment[] | undefined,
  operationId: OristudioCpOperationId | undefined
): ToolPreviewSegment[] {
  const carriesCrease = cpCommandCandidatesCarryCrease(operationId);
  return (segments ?? []).map((segment) => ({
    a: segment.a,
    b: segment.b,
    ...(carriesCrease && isFoldingCrease(segment.color)
      ? { crease: { color: segment.color, foldMagnitude: segment.fold_magnitude } }
      : {}),
  }));
}
