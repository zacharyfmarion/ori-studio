/**
 * The thumbnail a linked step keeps of its pattern (D2): the corner of its
 * card, and what the picker shows for a step whose pattern is gone. Drawn the
 * way the pattern pickers draw a sheet, and kept small.
 *
 * Pure.
 */
import type { FoldArtifacts } from '../../engine/types';
import { segmentSheetThumbnail } from '../../cp-workspace/sheets/segmentSheet';
import {
  MAX_STORED_STROKES,
  type SheetStroke,
  type SheetThumbnail,
} from '../../cp-workspace/sheets/sheetThumbnail';
import type { StepCreases } from './captureCreases';

const EMPTY_THUMBNAIL: SheetThumbnail = { viewBox: '0 0 100 100', strokes: [] };

/**
 * The region's thumbnail, as the Simulate rail draws it, from the
 * segmentation its creases were chosen in — every capture has one, since a
 * region is found by its rim in it.
 */
export function creasesThumbnail(creases: StepCreases, segmentation: FoldArtifacts): SheetThumbnail {
  const thumbnail = segmentSheetThumbnail(segmentation.fold, creases.segment);
  if (!thumbnail) return EMPTY_THUMBNAIL;
  // To a tenth of the 100-unit box: plenty for a corner, and short in the file.
  const snap = (value: number) => Math.round(value * 10) / 10 + 0;
  const snapped = thumbnail.strokes.map((stroke) => ({
    x1: snap(stroke.x1),
    y1: snap(stroke.y1),
    x2: snap(stroke.x2),
    y2: snap(stroke.y2),
    role: stroke.role,
  }));
  return { viewBox: thumbnail.viewBox, strokes: withinStoredBudget(snapped) };
}

/**
 * The strokes a file will take back (`readSheetThumbnail` refuses more than
 * {@link MAX_STORED_STROKES}), so a dense pattern can still be linked: first
 * every stroke the snap shrank to a dot and every repeat goes — neither shows
 * at a thumbnail's size — then, if that is not enough, the shortest creases,
 * never the sheet's edge. Order is kept, so the roles still layer as fitted.
 */
export function withinStoredBudget(strokes: readonly SheetStroke[]): SheetStroke[] {
  if (strokes.length <= MAX_STORED_STROKES) return [...strokes];
  const seen = new Set<string>();
  const kept = strokes.filter((stroke) => {
    if (stroke.x1 === stroke.x2 && stroke.y1 === stroke.y2) return false;
    const key = `${stroke.role} ${stroke.x1} ${stroke.y1} ${stroke.x2} ${stroke.y2}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (kept.length <= MAX_STORED_STROKES) return kept;
  const length = (stroke: SheetStroke) => Math.hypot(stroke.x2 - stroke.x1, stroke.y2 - stroke.y1);
  const edges = kept.filter((stroke) => stroke.role === 'edge').length;
  // The longest creases that fit beside the edge, ties to the earlier.
  const creases = kept
    .map((stroke, index) => ({ stroke, index }))
    .filter(({ stroke }) => stroke.role !== 'edge')
    .sort((a, b) => length(b.stroke) - length(a.stroke) || a.index - b.index)
    .slice(0, Math.max(0, MAX_STORED_STROKES - edges));
  const chosen = new Set(creases.map(({ index }) => index));
  return kept
    .filter((stroke, index) => stroke.role === 'edge' || chosen.has(index))
    .slice(0, MAX_STORED_STROKES);
}
