/**
 * The thumbnail a linked step keeps of its pattern (D2): the corner of its
 * card, and what the picker shows for a step whose pattern is gone. Drawn the
 * way the pattern pickers draw a sheet, and kept small.
 *
 * Pure.
 */
import type { FoldArtifacts } from '../../engine/types';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { segmentSheetThumbnail } from '../../cp-workspace/sheets/segmentSheet';
import {
  fitSheetThumbnail,
  type SheetStroke,
  type SheetStrokeRole,
  type SheetThumbnail,
} from '../../cp-workspace/sheets/sheetThumbnail';
import type { StepCreases } from './captureCreases';
import { clipToBox } from './creasePatternScene';

const EMPTY_THUMBNAIL: SheetThumbnail = { viewBox: '0 0 100 100', strokes: [] };

/** What a kernel line is on a thumbnail, by its colour: the roles the pickers ink. */
function strokeRole(color: string): SheetStrokeRole {
  switch (color) {
    case 'Black0':
      return 'edge';
    case 'Red1':
      return 'mountain';
    case 'Blue2':
      return 'valley';
    case 'Cyan3':
      return 'aux';
    default:
      return 'unassigned';
  }
}

/**
 * The scope's thumbnail: a region's, as the Simulate rail draws it; a figure
 * box's from the lines it chose, cut to the box.
 */
export function creasesThumbnail(
  document: OristudioCpDocumentSnapshot,
  creases: StepCreases,
  segmentation: FoldArtifacts | null
): SheetThumbnail {
  let thumbnail: SheetThumbnail | null;
  if (creases.segment && segmentation) {
    thumbnail = segmentSheetThumbnail(segmentation.fold, creases.segment);
  } else {
    const strokes: SheetStroke[] = [];
    for (const id of creases.scopedLineIds) {
      const line = document.crease_pattern.line_segments[id - 1];
      if (!line) continue;
      const piece = creases.clip ? clipToBox(line.a, line.b, creases.clip) : ([line.a, line.b] as const);
      if (!piece) continue;
      const [a, b] = piece;
      strokes.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, role: strokeRole(line.color) });
    }
    thumbnail = fitSheetThumbnail(strokes);
  }
  if (!thumbnail) return EMPTY_THUMBNAIL;
  // To a tenth of the 100-unit box: plenty for a corner, and short in the file.
  const snap = (value: number) => Math.round(value * 10) / 10 + 0;
  return {
    viewBox: thumbnail.viewBox,
    strokes: thumbnail.strokes.map((stroke) => ({
      x1: snap(stroke.x1),
      y1: snap(stroke.y1),
      x2: snap(stroke.x2),
      y2: snap(stroke.y2),
      role: stroke.role,
    })),
  };
}
