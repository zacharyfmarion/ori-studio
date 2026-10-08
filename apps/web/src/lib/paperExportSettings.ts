import type { PaperExportFormat, PaperExportSurface } from '../analytics/events';
import { DEFAULT_PAPER_PAGE, normalizePaperPage, type PaperPage } from './paper/paperPage';
import { DEFAULT_PAPER_PNG_DPI, PAPER_PNG_DPI_RANGE } from './paper/paperPng';

/**
 * What one kind of paper export remembers (X6): the format and style it was
 * last saved in, the painter's {@link PaperPage}, the density a PNG
 * rasterises at, and which of a diagram's marks the page carries.
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
  /**
   * The marks a diagram's page carries, for a target that can leave them out
   * (`PaperExportTarget.marks`); every other target draws its picture whole
   * and never reads this.
   */
  marks: PaperExportMarks;
}

/**
 * A mark a step's diagram can be exported without: its letters — the names of
 * the points a step refers to — and its reference lines, the accent over the
 * lines a step lines up. Both help a reader on screen; a page going into a
 * diagram of one's own may want neither.
 */
export type PaperExportMark = 'letters' | 'highlights';

export const PAPER_EXPORT_MARKS: readonly PaperExportMark[] = ['letters', 'highlights'];

/** Which marks a page carries: true draws it. */
export type PaperExportMarks = Readonly<Record<PaperExportMark, boolean>>;

export const DEFAULT_PAPER_EXPORT_MARKS: PaperExportMarks = { letters: true, highlights: true };

/** Read an untrusted marks object field by field: a missing or non-boolean mark is shown. */
export function normalizePaperExportMarks(source: unknown): PaperExportMarks {
  if (!source || typeof source !== 'object') return DEFAULT_PAPER_EXPORT_MARKS;
  const raw = source as Record<string, unknown>;
  const marks: Record<PaperExportMark, boolean> = { ...DEFAULT_PAPER_EXPORT_MARKS };
  for (const mark of PAPER_EXPORT_MARKS) {
    const value = raw[mark];
    if (typeof value === 'boolean') marks[mark] = value;
  }
  return marks;
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
  marks: DEFAULT_PAPER_EXPORT_MARKS,
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
 * page field by field through `normalizePaperPage`, the density clamped, and
 * each mark on its own.
 */
export function normalizePaperExportSettings(source: unknown): PaperExportSettings {
  if (!source || typeof source !== 'object') return DEFAULT_PAPER_EXPORT_SETTINGS;
  const { pngDpi, format, style, marks } = source as Record<string, unknown>;
  return {
    ...normalizePaperPage(source),
    pngDpi: typeof pngDpi === 'number' ? clampPaperPngDpi(pngDpi) : DEFAULT_PAPER_PNG_DPI,
    format: format === 'svg' || format === 'png' ? format : DEFAULT_PAPER_EXPORT_SETTINGS.format,
    style: typeof style === 'string' && style.length > 0 ? style : DEFAULT_PAPER_EXPORT_SETTINGS.style,
    marks: normalizePaperExportMarks(marks),
  };
}

/**
 * The export page a user's old simulator settings amount to: the seed of every
 * kind's first-run options (`paperExportMemoryOf` of it).
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

/**
 * Every kind on the same options — which is also every kind's first run, from
 * the defaults: every page opens at one size in mm (`DEFAULT_PAPER_SIZE_MM`),
 * never the picture's size on screen. A figure beside its crease pattern is a
 * few centimetres across at whatever zoom the pattern is at, and its pens,
 * drawn in pt, outweighed it there.
 */
export function paperExportMemoryOf(settings: PaperExportSettings): PaperExportMemory {
  return { simulation: settings, 'folded-figure': settings, step: settings };
}

/**
 * Read a stored value, whatever it is, as every kind's options:
 *
 * - v2: each kind normalised on its own, so a malformed or missing kind takes
 *   its own first-run options alone;
 * - a value from a newer build, which this one cannot read: every kind's
 *   first-run options;
 * - a single object from before the split: its page — sheet, margin,
 *   background, hidden faces, density — seeds every kind, at the default
 *   format and style, which were one kind's choice and not the others', so
 *   nobody's page resets;
 * - nothing: every kind's first-run options from `firstRun` (the old
 *   simulator setting's seed).
 */
export function normalizePaperExportMemory(
  source: unknown,
  firstRun: PaperExportSettings = DEFAULT_PAPER_EXPORT_SETTINGS
): PaperExportMemory {
  if (!source || typeof source !== 'object') return paperExportMemoryOf(firstRun);
  const { version, kinds } = source as { version?: unknown; kinds?: unknown };
  if (version === 2) {
    const stored = kinds && typeof kinds === 'object' ? (kinds as Record<string, unknown>) : {};
    const defaults = paperExportMemoryOf(DEFAULT_PAPER_EXPORT_SETTINGS);
    const memory = {} as Record<PaperExportKind, PaperExportSettings>;
    for (const kind of PAPER_EXPORT_KINDS) {
      const options = stored[kind];
      memory[kind] =
        options && typeof options === 'object' ? normalizePaperExportSettings(options) : defaults[kind];
    }
    return memory;
  }
  // Only the versioned form carries a version; the object from before the
  // split never had one.
  if (version !== undefined) return paperExportMemoryOf(DEFAULT_PAPER_EXPORT_SETTINGS);
  const { format, style } = DEFAULT_PAPER_EXPORT_SETTINGS;
  return paperExportMemoryOf({ ...normalizePaperExportSettings(source), format, style });
}

/** The value to store for `memory`. */
export function persistedPaperExport(memory: PaperExportMemory): PersistedPaperExport {
  return { version: 2, kinds: memory };
}
