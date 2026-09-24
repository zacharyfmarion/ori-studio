import type { PaperExportFormat } from '../analytics/events';
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
  /** The format the export dialog opens on: the last one a file was saved in. */
  format: PaperExportFormat;
  /**
   * The style the dialog's picker last exported with: the export slot, or a
   * preset by its `paperPresetKey`. A pointer, not a copy — the slot or the
   * preset as it is at the next export. A key that names no preset any more
   * reads as the export slot where the presets are known
   * (`resolvePaperExportStyleChoice`), not here.
   */
  style: PaperExportStyleChoice;
}

/** An image export's format: declared once, with the analytics enum that reports it. */
export type { PaperExportFormat };

/** The Settings export slot, as the dialog's style picker names it. */
export const PAPER_EXPORT_STYLE_SLOT = 'export-style';

/** Which style an export paints with: the export slot, or a preset's key. */
export type PaperExportStyleChoice = typeof PAPER_EXPORT_STYLE_SLOT | (string & {});

export type PaperExportField = keyof PaperExportSettings;

export const DEFAULT_PAPER_EXPORT_SETTINGS: PaperExportSettings = {
  ...DEFAULT_PAPER_PAGE,
  pngDpi: DEFAULT_PAPER_PNG_DPI,
  format: 'svg',
  style: PAPER_EXPORT_STYLE_SLOT,
};

/** Hold a density inside the range the UI offers; anything non-finite is the default. */
export function clampPaperPngDpi(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PAPER_PNG_DPI;
  return Math.min(PAPER_PNG_DPI_RANGE.max, Math.max(PAPER_PNG_DPI_RANGE.min, Math.round(value)));
}

/** The painter's page, without the PNG density that only the rasteriser reads. */
export function paperPageOf(settings: Pick<PaperExportSettings, keyof PaperPage>): PaperPage {
  const { sheet, paddingMm, background, keepHiddenFaces } = settings;
  return { sheet, paddingMm, background, keepHiddenFaces };
}

/**
 * Normalise an untrusted (persisted) settings object into a complete one: the
 * page field by field through `normalizePaperPage`, the density clamped.
 */
export function normalizePaperExportSettings(source: unknown): PaperExportSettings {
  if (!source || typeof source !== 'object') return DEFAULT_PAPER_EXPORT_SETTINGS;
  const { pngDpi, format, style } = source as Record<string, unknown>;
  return {
    ...normalizePaperPage(source),
    pngDpi: typeof pngDpi === 'number' ? clampPaperPngDpi(pngDpi) : DEFAULT_PAPER_PNG_DPI,
    format: format === 'svg' || format === 'png' ? format : DEFAULT_PAPER_EXPORT_SETTINGS.format,
    style: typeof style === 'string' && style.length > 0 ? style : DEFAULT_PAPER_EXPORT_SETTINGS.style,
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
