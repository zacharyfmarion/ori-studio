/**
 * The thumbnail a linked step keeps of its pattern (D2): the corner of its
 * card, and what the picker shows for a step whose pattern is gone. Drawn the
 * way the pattern pickers draw a sheet, and kept small.
 *
 * Pure.
 */
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import {
  MAX_STORED_STROKES,
  fitSheetThumbnail,
  type SheetStroke,
  type SheetThumbnail,
} from '../../cp-workspace/sheets/sheetThumbnail';
import type { StepCreases } from './captureCreases';

const EMPTY_THUMBNAIL: SheetThumbnail = { viewBox: '0 0 100 100', strokes: [] };

/**
 * The same scoped creases the capture draws, fitted with the shared sheet
 * thumbnail painter. Selecting a region has already found these line ids;
 * rebuilding a whole-document FOLD index here made Show as cost hundreds of
 * milliseconds on a large batch. Work is proportional to this sheet alone.
 */
export function creasesThumbnail(creases: StepCreases, document: OristudioCpDocumentSnapshot): SheetThumbnail {
  const strokes: SheetStroke[] = [];
  for (const id of creases.scopedLineIds) {
    const line = document.crease_pattern.line_segments[id - 1];
    if (!line) continue;
    const role = line.color === 'Black0' ? 'edge' : line.color === 'Red1' ? 'mountain' : line.color === 'Blue2' ? 'valley' : 'aux';
    strokes.push({ x1: line.a.x, y1: line.a.y, x2: line.b.x, y2: line.b.y, role });
  }
  const thumbnail = fitSheetThumbnail(strokes);
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
