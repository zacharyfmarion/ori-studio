import { DEFAULT_PAPER_PAGE, normalizePaperPage, type PaperPage } from './paper/paperPage';
import { DEFAULT_PAPER_PNG_DPI, PAPER_PNG_DPI_RANGE } from './paper/paperPng';

/**
 * The page a paper export is painted onto, as it is persisted: the painter's
 * {@link PaperPage} plus the density a PNG rasterises at.
 *
 * Pure data plus a normaliser, with no React or store dependency, in the
 * `paperStyleSettings` pattern: the settings store reads and writes this shape
 * and nothing else interprets the stored JSON. Export options, not style — the
 * same picture goes out on any page (D3, D4 in the plan).
 */
export interface PaperExportSettings extends PaperPage {
  pngDpi: number;
}

export type PaperExportField = keyof PaperExportSettings;

export const DEFAULT_PAPER_EXPORT_SETTINGS: PaperExportSettings = {
  ...DEFAULT_PAPER_PAGE,
  pngDpi: DEFAULT_PAPER_PNG_DPI,
};

/** Hold a density inside the range the UI offers; anything non-finite is the default. */
export function clampPaperPngDpi(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PAPER_PNG_DPI;
  return Math.min(PAPER_PNG_DPI_RANGE.max, Math.max(PAPER_PNG_DPI_RANGE.min, Math.round(value)));
}

/** The painter's page, without the PNG density that only the rasteriser reads. */
export function paperPageOf(settings: PaperExportSettings): PaperPage {
  const { sheet, paddingMm, background, keepHiddenFaces } = settings;
  return { sheet, paddingMm, background, keepHiddenFaces };
}

/**
 * Normalise an untrusted (persisted) settings object into a complete one: the
 * page field by field through `normalizePaperPage`, the density clamped.
 */
export function normalizePaperExportSettings(source: unknown): PaperExportSettings {
  if (!source || typeof source !== 'object') return DEFAULT_PAPER_EXPORT_SETTINGS;
  const { pngDpi } = source as Record<string, unknown>;
  return {
    ...normalizePaperPage(source),
    pngDpi: typeof pngDpi === 'number' ? clampPaperPngDpi(pngDpi) : DEFAULT_PAPER_PNG_DPI,
  };
}

/**
 * The export page a user's old simulator settings amount to.
 *
 * Before there was a page, the simulator held its own `exportBackground`:
 * `'transparent'`, `'white'` or `'theme'`. A user who had chosen white should
 * keep exporting onto white, so the first read of the page — and only the
 * first — carries it across as `#ffffff`. `'theme'` was the app's own ground,
 * which a file should not carry (the plan's D1 has no theme value anywhere),
 * so it and `'transparent'` both read as a transparent page.
 */
export function paperExportFromSimulatorSettings(source: unknown): PaperExportSettings {
  if (!source || typeof source !== 'object') return DEFAULT_PAPER_EXPORT_SETTINGS;
  const { exportBackground } = source as Record<string, unknown>;
  if (exportBackground !== 'white') return DEFAULT_PAPER_EXPORT_SETTINGS;
  return { ...DEFAULT_PAPER_EXPORT_SETTINGS, background: '#ffffff' };
}
