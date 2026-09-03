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
 *
 * Indicator geometry keeps its colour by the *other* route. The rule above is
 * about candidates — geometry the tool would commit — where wearing the active
 * line type is the whole point. An indicator is never a crease you are about to
 * draw, so there is nothing for it to misrepresent, and upstream gives each one a
 * fixed colour on purpose: Angle Bisector's parallel branch draws its midline in
 * `Purple8` because you are meant to *aim at it*. Stroked in the active colour it
 * is one more red line in a pattern full of them, which is indistinguishable from
 * the tool having done nothing.
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
  return (segments ?? []).map((segment) => {
    // Indicator geometry: keeps its colour, but on its own field. Putting it in
    // `crease` would say it *is* a crease of that colour and let it pick up
    // crease rendering (fold-angle ink and the rest), which is the thing the
    // rule above exists to prevent.
    if (!isFoldingCrease(segment.color)) {
      return { a: segment.a, b: segment.b, indicator: { color: segment.color } };
    }
    return {
      a: segment.a,
      b: segment.b,
      ...(carriesCrease
        ? { crease: { color: segment.color, foldMagnitude: segment.fold_magnitude } }
        : {}),
    };
  });
}
