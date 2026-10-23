/**
 * The thumbnail a linked step keeps of its pattern (D2): the corner of its
 * card, and what the picker shows for a step whose pattern is gone. Drawn the
 * way the pattern pickers draw a sheet, and kept small.
 *
 * Pure.
 */
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { linesSheetThumbnail } from '../../cp-workspace/sheets/linesSheetThumbnail';
import { storedSheetThumbnail, type SheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import type { StepCreases } from './captureCreases';

/**
 * The sheet's thumbnail, as the pattern picker draws it: every line the step
 * covers, from the document its creases were chosen in — kept as every step
 * keeps one (`storedSheetThumbnail`: snapped, and within what a file takes
 * back).
 */
export function creasesThumbnail(
  document: OristudioCpDocumentSnapshot,
  creases: StepCreases
): SheetThumbnail {
  return storedSheetThumbnail(linesSheetThumbnail(document, creases.scopedLineIds));
}
