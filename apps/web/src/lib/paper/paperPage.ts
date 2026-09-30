/**
 * The page a paper scene is painted onto: how big the artwork is, how much
 * margin it gets, what is behind it and whether buried faces are kept.
 *
 * These are export options, not style — the same picture goes out on any page
 * (D3, D4). The page is in physical units because the file is opened in
 * Illustrator, Affinity or Inkscape, where a 0.75 pt stroke should read as
 * 0.75 pt: the painter writes `width`/`height` in pt with a matching viewBox.
 */
import { parseHex, type Hex } from './paperStyle';

export type PaperSheetSize =
  /** The sheet's on-screen size, 1 CSS px = 0.75 pt: exact WYSIWYG. */
  | 'as-shown'
  /**
   * The picture is this many mm across what its kind measures
   * ({@link PaperSizeMeasure}); the pens keep their pt widths.
   */
  | { mm: number };

/**
 * What a size in mm measures on a picture.
 *
 * `'sheet'`: the unfolded sheet, edge to edge — for a picture that shows it,
 * a diagram step, where the sheet is the frame the reader reads the step in.
 * `'figure'`: the drawing itself, across its longer side — for a folded figure
 * or a simulation, whose unfolded sheet is nowhere in the picture. Measured by
 * the sheet, a folded model came out a third of the size asked for, and its
 * pens, which keep their pt widths, drew it like a cartoon.
 */
export type PaperSizeMeasure = 'sheet' | 'figure';

export interface PaperPage {
  sheet: PaperSheetSize;
  paddingMm: number;
  /** A page colour behind the artwork, or null for a transparent page. */
  background: Hex | null;
  /**
   * Keep the faces (and the lines on them) that no pixel of the page shows,
   * drawn in place under what covers them, so that deleting a face in an
   * editor reveals the one beneath. Off drops them for a lighter file.
   */
  keepHiddenFaces: boolean;
}

export const DEFAULT_PAPER_PAGE: PaperPage = {
  sheet: 'as-shown',
  paddingMm: 5,
  background: null,
  keepHiddenFaces: true,
};

/**
 * The size a figure's picture opens at — a folded figure's, and a simulation's
 * when a user leaves "as shown" — across its longer side: a finished model's
 * picture in a printed diagram, about half again a step's square. Its pens
 * keep their pt widths at any size, so this is what sets how fine they read.
 */
export const DEFAULT_PAPER_FIGURE_MM = 60;

/**
 * A diagram step's sheet: the square a printed diagram draws each step on,
 * about 41 mm a side — measured off a diagrammer's A4 template, whose front and
 * back squares are 40.85 mm with a 0.5 pt edge.
 */
export const DIAGRAM_STEP_SHEET_MM = 41;

/** The page colour a transparent page turns into when the user asks for one. */
export const DEFAULT_PAPER_BACKGROUND: Hex = '#ffffff';

/** The size in mm the size field shows: the chosen one, or a figure's default while "as shown". */
export function sheetMmOf(sheet: PaperSheetSize): number {
  return sheet === 'as-shown' ? DEFAULT_PAPER_FIGURE_MM : sheet.mm;
}

/** The sheet sizes the UI offers, in mm. */
export const PAPER_SHEET_MM_RANGE = { min: 10, max: 1000, step: 1 } as const;

/** The margins the UI offers, in mm. */
export const PAPER_PADDING_MM_RANGE = { min: 0, max: 100, step: 0.5 } as const;

function parseSheet(value: unknown): PaperSheetSize | undefined {
  if (value === 'as-shown') return value;
  if (!value || typeof value !== 'object') return undefined;
  const { mm } = value as Record<string, unknown>;
  if (typeof mm !== 'number' || !Number.isFinite(mm) || mm <= 0) return undefined;
  return { mm: Math.min(PAPER_SHEET_MM_RANGE.max, Math.max(PAPER_SHEET_MM_RANGE.min, mm)) };
}

function parsePadding(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(PAPER_PADDING_MM_RANGE.max, Math.max(PAPER_PADDING_MM_RANGE.min, value));
}

/**
 * Normalise an untrusted (persisted) page into a complete one: each field
 * that is missing or malformed takes its default, the `normalizePaperStyle`
 * pattern.
 */
export function normalizePaperPage(source: unknown): PaperPage {
  if (!source || typeof source !== 'object') return DEFAULT_PAPER_PAGE;
  const raw = source as Record<string, unknown>;
  const background =
    raw.background === null ? null : (parseHex(raw.background) ?? DEFAULT_PAPER_PAGE.background);
  return {
    sheet: parseSheet(raw.sheet) ?? DEFAULT_PAPER_PAGE.sheet,
    paddingMm: parsePadding(raw.paddingMm) ?? DEFAULT_PAPER_PAGE.paddingMm,
    background,
    keepHiddenFaces:
      typeof raw.keepHiddenFaces === 'boolean'
        ? raw.keepHiddenFaces
        : DEFAULT_PAPER_PAGE.keepHiddenFaces,
  };
}
