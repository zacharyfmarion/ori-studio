/**
 * A crease pattern drawn small enough to pick from a list.
 *
 * The one thumbnail both pickers of the document's patterns draw — the
 * References rail and the Simulate rail — so the two lists read as the same
 * list. What differs is where the lines come from: References reads a precrease
 * component out of `CpGeometryTransport`, Simulate a segment's edges out of a
 * FOLD document. Each of those collects its lines in model space, says which
 * role each plays, and hands them here with the paper's outline; this module
 * knows nothing about either source and only fits.
 *
 * Roles rather than colours: which pen a line is drawn in is the paper style's
 * to say (`sheetThumbnailInk`), so a card draws the pattern the way the style
 * draws it on paper, and the same way in both rails.
 *
 * Model space is y-down and so is SVG, so the strokes go through unflipped; the
 * only transform is the uniform fit, which keeps the pattern's aspect ratio — a
 * squashed thumbnail is a different crease pattern.
 */

/**
 * What a line is on the paper, which decides its pen: the paper's edge (its
 * border, or a cut), a mountain or valley fold, a crease with no direction
 * yet, or an aux line — the kernel's `F`, drawn only while the style shows aux
 * creases.
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

/** One closed outline of the paper, in the pattern's own coordinates. */
export type SheetRing = readonly (readonly [number, number])[];

/** A stroke fitted into the thumbnail's box. */
export interface ThumbnailStroke extends SheetStroke {
  /**
   * Which ends lie on the paper's outline — where erode pulls an aux line
   * back from the edge (D8). Always false for every other role.
   */
  onBoundary: readonly [boolean, boolean];
}

export interface SheetThumbnail {
  viewBox: string;
  /** The box's side in viewBox units: the pattern's longer extent, the unit erode is a share of. */
  size: number;
  /** The paper: its outline rings as one path, filled even-odd; null when the rail gave none. */
  paper: string | null;
  /** Fitted, in drawing order: aux and unassigned lines under the folds, the paper's edge over all. */
  strokes: ThumbnailStroke[];
}

/** Which draws over which; ties keep the rail's order. */
const ROLE_LAYER: Record<SheetStrokeRole, number> = {
  aux: 0,
  unassigned: 1,
  mountain: 2,
  valley: 2,
  edge: 3,
};

/** How near the outline, as a share of the pattern's extent, an aux end is on it. */
const ON_OUTLINE_RELATIVE = 1e-6;

/**
 * The strokes and the paper fitted into a `size`-unit square, centred on the
 * shorter axis.
 *
 * `null` for nothing drawable: no strokes, or strokes with no extent (a single
 * point), which no fit can make visible.
 */
export function fitSheetThumbnail(
  strokes: readonly SheetStroke[],
  size = 100,
  rings: readonly SheetRing[] = []
): SheetThumbnail | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const stroke of strokes) {
    include(stroke.x1, stroke.y1);
    include(stroke.x2, stroke.y2);
  }
  if (strokes.length === 0) return null;
  for (const ring of rings) for (const [x, y] of ring) include(x, y);
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const span = Math.max(maxX - minX, maxY - minY);
  if (!(span > 0)) return null;
  const scale = size / span;
  const offsetX = (size - (maxX - minX) * scale) / 2;
  const offsetY = (size - (maxY - minY) * scale) / 2;
  const fitX = (x: number) => (x - minX) * scale + offsetX;
  const fitY = (y: number) => (y - minY) * scale + offsetY;

  const tolerance = ON_OUTLINE_RELATIVE * span;
  const onOutline = (x: number, y: number) =>
    rings.some((ring) => pointOnRing(ring, x, y, tolerance));
  const fitted: ThumbnailStroke[] = strokes.map((stroke) => ({
    x1: fitX(stroke.x1),
    y1: fitY(stroke.y1),
    x2: fitX(stroke.x2),
    y2: fitY(stroke.y2),
    role: stroke.role,
    onBoundary:
      stroke.role === 'aux'
        ? [onOutline(stroke.x1, stroke.y1), onOutline(stroke.x2, stroke.y2)]
        : [false, false],
  }));
  fitted.sort((a, b) => ROLE_LAYER[a.role] - ROLE_LAYER[b.role]);

  const outlines = rings.filter((ring) => ring.length >= 3);
  const paper =
    outlines.length > 0
      ? outlines
          .map(
            (ring) =>
              `M${ring.map(([x, y]) => `${round(fitX(x))} ${round(fitY(y))}`).join('L')}Z`
          )
          .join('')
      : null;
  return { viewBox: `0 0 ${size} ${size}`, size, paper, strokes: fitted };
}

/** Whether `(x, y)` lies within `tolerance` of the closed ring's outline. */
function pointOnRing(ring: SheetRing, x: number, y: number, tolerance: number): boolean {
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, ay] = ring[i]!;
    const [bx, by] = ring[(i + 1) % ring.length]!;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / lengthSq)) : 0;
    if (Math.hypot(x - (ax + dx * t), y - (ay + dy * t)) <= tolerance) return true;
  }
  return false;
}

/** Two decimals of a 100-unit box: well under a pixel, and a short path. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
