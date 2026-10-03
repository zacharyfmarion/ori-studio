/**
 * What the diagram's export remembers (D11): the file it last wrote — one PDF
 * of the pages, or the steps as files — and how. The dialog opens on it, and
 * a save remembers what the dialog wrote.
 *
 * Pure data and its normaliser; the settings store reads and writes this
 * shape and nothing else reads the stored JSON.
 */
import type { DiagramPdfMode } from './diagramPdf';
import { STEP_FILE_MM_RANGE, stepFileMinHeightMm, type StepFileOptions } from './stepFileGeometry';

/** One PDF of the pages, or a ZIP with a file for each step. */
export type DiagramExportKind = 'pdf' | 'steps';

export type StepFileFormat = 'svg' | 'png';

/** The densities a step's PNG is offered at: a print's, and a fine print's. */
export const STEP_FILE_DPIS = [300, 600] as const;
export type StepFileDpi = (typeof STEP_FILE_DPIS)[number];

export interface DiagramExportSettings extends StepFileOptions {
  kind: DiagramExportKind;
  /** The PDF's: to print at home, or to send to a print shop. */
  pdf: DiagramPdfMode;
  /** The step files'. */
  format: StepFileFormat;
  dpi: StepFileDpi;
}

export const DEFAULT_DIAGRAM_EXPORT_SETTINGS: DiagramExportSettings = {
  kind: 'pdf',
  pdf: 'home',
  format: 'svg',
  dpi: 300,
  number: true,
  text: true,
  sameSize: true,
  widthMm: 80,
  heightMm: 100,
  transparent: true,
};

/**
 * Read untrusted settings field by field: what is missing or wrong is the
 * default, and the canvas is held to its range, tall enough for the number and
 * the text it carries.
 */
export function normalizeDiagramExportSettings(source: unknown): DiagramExportSettings {
  const raw = source && typeof source === 'object' ? (source as Record<string, unknown>) : {};
  const fallback = DEFAULT_DIAGRAM_EXPORT_SETTINGS;
  const oneOf = <T extends string | number>(value: unknown, options: readonly T[], otherwise: T): T =>
    options.includes(value as T) ? (value as T) : otherwise;
  const flag = (value: unknown, otherwise: boolean) => (typeof value === 'boolean' ? value : otherwise);
  const number = flag(raw.number, fallback.number);
  const text = flag(raw.text, fallback.text);
  return {
    kind: oneOf(raw.kind, ['pdf', 'steps'] as const, fallback.kind),
    pdf: oneOf(raw.pdf, ['home', 'print-shop'] as const, fallback.pdf),
    format: oneOf(raw.format, ['svg', 'png'] as const, fallback.format),
    dpi: oneOf(raw.dpi, STEP_FILE_DPIS, fallback.dpi),
    number,
    text,
    sameSize: flag(raw.sameSize, fallback.sameSize),
    widthMm: clampMm(raw.widthMm, fallback.widthMm, STEP_FILE_MM_RANGE.min),
    heightMm: clampMm(raw.heightMm, fallback.heightMm, stepFileMinHeightMm({ number, text })),
    transparent: flag(raw.transparent, fallback.transparent),
  };
}

function clampMm(value: unknown, otherwise: number, min: number): number {
  const mm = typeof value === 'number' && Number.isFinite(value) ? value : otherwise;
  return Math.min(STEP_FILE_MM_RANGE.max, Math.max(Math.ceil(min), mm));
}
