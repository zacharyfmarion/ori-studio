import type { CpImage } from '../cp-workspace/images/cpImage';
import type { TextAnnotation } from '../cp-workspace/annotations/textAnnotation';
import type { InlineSimulation } from '../cp-workspace/inlineSimulation/inlineSimulation';

/**
 * Registry of *superset features* — capabilities Ori Studio's native `.osf`
 * stores but that no Oriedita-compatible export format can. This is the single
 * place that knows "feature X is dropped by export format Y", so every export /
 * save handler can warn the user consistently before writing.
 *
 * See `apps/web/docs/superset-features.md`. Adding the next superset feature is a
 * one-line addition here.
 */

/** Export formats that can lose superset data (every format except `.osf`). */
export type ExportFormat = 'cp' | 'fold' | 'ori' | 'orh' | 'dxf' | 'obj' | 'svg' | 'png';

/** Current presence of every superset feature, sampled from the workspace. */
export interface SupersetPresence {
  images: readonly CpImage[];
  /**
   * Rich-text boxes. Their content flattens to plain `{x, y, text}` in the
   * Oriedita formats that support text (`.ori`/`.fold`/`.orh`), but the
   * formatting, box, and reflow are always lost — so they count as a superset
   * feature dropped by every non-`.osf` format.
   */
  richText: readonly TextAnnotation[];
  /**
   * Inline simulation windows. Placement and the region each was taken from;
   * no Oriedita format has anywhere to put either, so they are dropped whole.
   */
  inlineSimulations: readonly InlineSimulation[];
}

interface SupersetFeature {
  id: string;
  label: string;
  /** How many are present (0 ⇒ absent). */
  count(presence: SupersetPresence): number;
  /** Formats that cannot store this feature. */
  droppedByFormats: readonly ExportFormat[];
}

const ALL_LOSSY_FORMATS: readonly ExportFormat[] = [
  'cp',
  'fold',
  'ori',
  'orh',
  'dxf',
  'obj',
  'svg',
  'png',
];

const SUPERSET_FEATURES: readonly SupersetFeature[] = [
  {
    id: 'images',
    label: 'Images',
    count: (presence) => presence.images.length,
    droppedByFormats: ALL_LOSSY_FORMATS,
  },
  {
    id: 'richText',
    label: 'Rich text formatting',
    count: (presence) => presence.richText.length,
    droppedByFormats: ALL_LOSSY_FORMATS,
  },
  {
    id: 'inlineSimulations',
    label: 'Simulation windows',
    count: (presence) => presence.inlineSimulations.length,
    droppedByFormats: ALL_LOSSY_FORMATS,
  },
];

export interface ExportLossWarning {
  id: string;
  label: string;
  count: number;
}

/**
 * The superset features present in `presence` that the given export `format`
 * cannot store. Empty when the export is lossless.
 */
export function collectExportLossWarnings(
  format: ExportFormat,
  presence: SupersetPresence
): ExportLossWarning[] {
  const warnings: ExportLossWarning[] = [];
  for (const feature of SUPERSET_FEATURES) {
    if (!feature.droppedByFormats.includes(format)) continue;
    const count = feature.count(presence);
    if (count > 0) warnings.push({ id: feature.id, label: feature.label, count });
  }
  return warnings;
}

/** Human-readable summary of the dropped features, e.g. "Images (3)". */
export function describeExportLoss(warnings: readonly ExportLossWarning[]): string {
  return warnings.map((warning) => `${warning.label} (${warning.count})`).join(', ');
}

/** Uppercase label for an export format, for the warning copy. */
export function exportFormatLabel(format: ExportFormat): string {
  return format.toUpperCase();
}
