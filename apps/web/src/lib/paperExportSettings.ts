import type { PaperExportFormat, PaperExportSurface } from '../analytics/events';
import { DEFAULT_PAPER_PAGE, normalizePaperPage, type PaperPage } from './paper/paperPage';
import { DEFAULT_PAPER_PNG_DPI, PAPER_PNG_DPI_RANGE } from './paper/paperPng';

/**
 * What one kind of paper export remembers (X6): the format and style it was
 * last saved in, the painter's {@link PaperPage}, and the density a PNG
 * rasterises at.
 *
 * Pure data plus normalisers, with no React or store dependency, in the
 * `paperStyleSettings` pattern: the settings store reads and writes these
 * shapes and nothing else interprets the stored JSON. Export options, not
 * style — the same picture goes out on any page (D3, D4 in the plan).
 */
export interface PaperExportSettings extends PaperPage {
  pngDpi: number;
  /** The format the export dialog opens on: the last one a file of this kind was saved in. */
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
 * The export page a user's old simulator settings amount to: every kind's
 * first-run options.
 *
 * Before there was a page, the simulator held its own `exportBackground`:
 * `'transparent'`, `'white'` or `'theme'`. A user who had chosen white should
 * keep exporting onto white, so the first read of the options — and only the
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

/**
 * The kinds of paper export, each remembering its own options (X6): a
 * simulation — the Simulate view and inline windows — a folded figure, 3D or
 * flat, and a References step. A figure exported in PNG at 600 dpi says
 * nothing about how the next step should go out.
 */
export type PaperExportKind = 'simulation' | 'folded-figure' | 'step';

export const PAPER_EXPORT_KINDS: readonly PaperExportKind[] = ['simulation', 'folded-figure', 'step'];

/** What every kind last exported with. */
export type PaperExportMemory = Readonly<Record<PaperExportKind, PaperExportSettings>>;

/** The stored form: versioned, so a single object from before the split reads as a seed. */
export interface PersistedPaperExport {
  version: 2;
  kinds: PaperExportMemory;
}

/** Which kind of export a surface's dialog remembers its options as. */
export function paperExportKindOf(surface: PaperExportSurface): PaperExportKind {
  switch (surface) {
    case 'simulator':
    case 'inline-simulation':
      return 'simulation';
    case 'folded-3d':
    case 'folded-flat':
      return 'folded-figure';
    case 'references':
      return 'step';
  }
}

/** Every kind on the same options. */
export function paperExportMemoryOf(settings: PaperExportSettings): PaperExportMemory {
  return { simulation: settings, 'folded-figure': settings, step: settings };
}

/**
 * Read a stored value, whatever it is, as every kind's options:
 *
 * - v2: each kind normalised on its own, so a malformed kind defaults alone;
 * - a single object from before the split: its page — sheet, margin,
 *   background, hidden faces, density — seeds every kind, at the default
 *   format and style, which were one kind's choice and not the others', so
 *   nobody's page resets;
 * - nothing: `firstRun` for every kind (the old simulator setting's seed).
 */
export function normalizePaperExportMemory(
  source: unknown,
  firstRun: PaperExportSettings = DEFAULT_PAPER_EXPORT_SETTINGS
): PaperExportMemory {
  if (!source || typeof source !== 'object') return paperExportMemoryOf(firstRun);
  const { version, kinds } = source as { version?: unknown; kinds?: unknown };
  if (version === 2) {
    const stored = kinds && typeof kinds === 'object' ? (kinds as Record<string, unknown>) : {};
    const memory = {} as Record<PaperExportKind, PaperExportSettings>;
    for (const kind of PAPER_EXPORT_KINDS) memory[kind] = normalizePaperExportSettings(stored[kind]);
    return memory;
  }
  const { format, style } = DEFAULT_PAPER_EXPORT_SETTINGS;
  return paperExportMemoryOf({ ...normalizePaperExportSettings(source), format, style });
}

/** The value to store for `memory`. */
export function persistedPaperExport(memory: PaperExportMemory): PersistedPaperExport {
  return { version: 2, kinds: memory };
}
