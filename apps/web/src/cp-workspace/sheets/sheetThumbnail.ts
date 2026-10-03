/**
 * A crease pattern drawn small enough to pick from a list.
 *
 * The one thumbnail both pickers of the document's patterns draw — the
 * References rail and the Simulate rail — so the two lists read as the same
 * list. What differs is where the lines come from: References reads a precrease
 * component out of `CpGeometryTransport`, Simulate a segment's edges out of a
 * FOLD document. Each of those collects its lines in model space, says which
 * role each plays, and hands them here; this module knows nothing about either
 * source and only fits.
 *
 * Roles rather than colours: the card's stylesheet inks each role
 * (`.sheet-card__stroke--*` in `theme.css`), so both rails read one pattern's
 * lines the same way and draw them alike.
 *
 * Model space is y-down and so is SVG, so the strokes go through unflipped; the
 * only transform is the uniform fit, which keeps the pattern's aspect ratio — a
 * squashed thumbnail is a different crease pattern.
 */

/**
 * What a line is on the paper, which decides its ink: the paper's edge (its
 * border, or a cut), a mountain or valley fold, a crease with no direction
 * yet, or an aux line — the kernel's `F`, drawn only where the rail shows aux
 * lines.
 */
export type SheetStrokeRole = 'edge' | 'mountain' | 'valley' | 'unassigned' | 'aux';

/** A line of the pattern, in the pattern's own coordinates. */
export interface SheetStroke {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  role: SheetStrokeRole;
}

export interface SheetThumbnail {
  viewBox: string;
  /** Fitted, in drawing order: aux and unassigned lines under the folds, the paper's edge over all. */
  strokes: SheetStroke[];
}

/** Which draws over which; ties keep the rail's order. */
const ROLE_LAYER: Record<SheetStrokeRole, number> = {
  aux: 0,
  unassigned: 1,
  mountain: 2,
  valley: 2,
  edge: 3,
};

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
    role: stroke.role,
  }));
  fitted.sort((a, b) => ROLE_LAYER[a.role] - ROLE_LAYER[b.role]);
  return { viewBox: `0 0 ${size} ${size}`, strokes: fitted };
}

const STROKE_ROLES: ReadonlySet<string> = new Set<SheetStrokeRole>([
  'edge',
  'mountain',
  'valley',
  'unassigned',
  'aux',
]);

/** The most strokes a stored thumbnail may hold: a dense box-pleat sheet, with room. */
export const MAX_STORED_STROKES = 20_000;

/**
 * A thumbnail as a file holds it (a Diagram step keeps the one it was linked
 * with), or null: a numeric viewBox and finite strokes of known roles, every
 * one — a thumbnail missing lines is a different pattern.
 */
export function readSheetThumbnail(value: unknown): SheetThumbnail | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const viewBox = record.viewBox;
  if (typeof viewBox !== 'string') return null;
  const box = viewBox.trim().split(/\s+/).map(Number);
  if (box.length !== 4 || box.some((n) => !Number.isFinite(n)) || box[2] <= 0 || box[3] <= 0) return null;
  if (!Array.isArray(record.strokes) || record.strokes.length > MAX_STORED_STROKES) return null;
  const strokes: SheetStroke[] = [];
  for (const entry of record.strokes) {
    if (entry === null || typeof entry !== 'object') return null;
    const { x1, y1, x2, y2, role } = entry as Record<string, unknown>;
    const coords = [x1, y1, x2, y2];
    if (coords.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
    if (typeof role !== 'string' || !STROKE_ROLES.has(role)) return null;
    strokes.push({
      x1: x1 as number,
      y1: y1 as number,
      x2: x2 as number,
      y2: y2 as number,
      role: role as SheetStrokeRole,
    });
  }
  return { viewBox: box.join(' '), strokes };
}
