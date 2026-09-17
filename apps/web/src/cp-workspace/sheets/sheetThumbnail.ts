/**
 * A crease pattern drawn small enough to pick from a list.
 *
 * The one thumbnail both pickers of the document's patterns draw — the
 * References rail and the Simulate rail — so the two lists read as the same
 * list. What differs is where the lines come from: References reads a precrease
 * component out of `CpGeometryTransport`, Simulate a segment's faces out of a
 * FOLD document. Each of those collects its lines in model space and hands them
 * here; this module knows nothing about either source and only fits.
 *
 * Model space is y-down and so is SVG, so the strokes go through unflipped; the
 * only transform is the uniform fit, which keeps the pattern's aspect ratio — a
 * squashed thumbnail is a different crease pattern.
 */

/** Which class a stroke takes; `border` is the paper's own edge. */
export type SheetStrokeKind = 'border' | 'mountain' | 'valley' | 'other';

/** A line of the pattern, in the pattern's own coordinates. */
export interface SheetStroke {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: SheetStrokeKind;
}

export interface SheetThumbnail {
  viewBox: string;
  /** Fitted into the box, border last so the paper's edge draws over the creases that end on it. */
  strokes: SheetStroke[];
}

/**
 * The strokes fitted into a `size`-unit square, centred on the shorter axis.
 *
 * `null` for nothing drawable: no strokes, or strokes with no extent (a single
 * point), which no fit can make visible.
 */
export function fitSheetThumbnail(strokes: readonly SheetStroke[], size = 100): SheetThumbnail | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    minX = Math.min(minX, stroke.x1, stroke.x2);
    maxX = Math.max(maxX, stroke.x1, stroke.x2);
    minY = Math.min(minY, stroke.y1, stroke.y2);
    maxY = Math.max(maxY, stroke.y1, stroke.y2);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const span = Math.max(maxX - minX, maxY - minY);
  if (!(span > 0)) return null;
  const scale = size / span;
  const offsetX = (size - (maxX - minX) * scale) / 2;
  const offsetY = (size - (maxY - minY) * scale) / 2;
  const fitted = strokes.map((stroke) => ({
    x1: (stroke.x1 - minX) * scale + offsetX,
    y1: (stroke.y1 - minY) * scale + offsetY,
    x2: (stroke.x2 - minX) * scale + offsetX,
    y2: (stroke.y2 - minY) * scale + offsetY,
    kind: stroke.kind,
  }));
  fitted.sort((a, b) => Number(a.kind === 'border') - Number(b.kind === 'border'));
  return { viewBox: `0 0 ${size} ${size}`, strokes: fitted };
}
