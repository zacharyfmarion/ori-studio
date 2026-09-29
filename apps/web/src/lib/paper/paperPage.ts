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
  /** The unfolded sheet spans this many mm; the pens keep their pt widths. */
  | { mm: number };

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
 * The sheet size a user gets when they leave "as shown", on every kind of
 * export, and a folded figure's first-run sheet: a round number about the
 * size of a sheet of printer paper, well inside the range. Big enough that a
 * figure's pens, which keep their pt widths at any size, read as fine lines
 * rather than outweighing the picture.
 */
export const DEFAULT_PAPER_SHEET_MM = 250;

/** The page colour a transparent page turns into when the user asks for one. */
export const DEFAULT_PAPER_BACKGROUND: Hex = '#ffffff';

/** The sheet size in mm the size field shows: the chosen one, or the default while "as shown". */
export function sheetMmOf(sheet: PaperSheetSize): number {
  return sheet === 'as-shown' ? DEFAULT_PAPER_SHEET_MM : sheet.mm;
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
