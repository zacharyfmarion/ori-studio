import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { partialFoldDegrees } from '../../lib/foldAngle';
import { creaseRoleOf } from '../references/creaseRole';
import { fitSheetThumbnail, type SheetStroke, type SheetThumbnail } from './sheetThumbnail';

/**
 * A sheet's card thumbnail from its own lines, read as the References rail
 * reads them (`creaseRole`): the document's lines by id, each inked by its
 * role — and a crease folded short of 180° carrying its angle, which the
 * painters shade as Edit's canvas does — fitted. No faces are needed, so a
 * sheet of the index is drawn without building any — and the lines are the
 * ones drawn, not their face edges.
 */
export function linesSheetThumbnail(
  document: OristudioCpDocumentSnapshot,
  lineIds: readonly number[]
): SheetThumbnail | null {
  const lines = document.crease_pattern.line_segments;
  const strokes: SheetStroke[] = [];
  for (const id of lineIds) {
    const line = lines[id - 1];
    if (!line) continue;
    strokes.push({
      x1: line.a.x,
      y1: line.a.y,
      x2: line.b.x,
      y2: line.b.y,
      role: creaseRoleOf(line),
      foldDegrees: partialFoldDegrees(line.fold_magnitude),
    });
  }
  return fitSheetThumbnail(strokes);
}
