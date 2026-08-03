import type { CpImage } from '../cp-workspace/images/cpImage';
import type { TextAnnotation } from '../cp-workspace/annotations/textAnnotation';
import type { InlineSimulation } from '../cp-workspace/inlineSimulation/inlineSimulation';
import type { OristudioCpLineSegment } from '../engine/oristudioCpTypes';
import { isClassicCrease, isFoldingCrease } from './foldAngle';
import { defaultBpDocumentSymmetry, type BpDocumentSymmetry } from './bpTreeSymmetry';

/**
 * Registry of *superset features* — capabilities Ori Studio's native `.osf`
 * stores but that no upstream export format can. This is the single place that
 * knows "feature X is dropped by export format Y", so every export / save
 * handler can warn the user consistently before writing.
 *
 * It spans surfaces: most entries are crease-pattern features with no Oriedita
 * equivalent, and `symmetry` is a box-pleat feature with no Box Pleating Studio
 * equivalent. Since a design is only ever exported to its own upstream's
 * formats, each feature simply lists the formats that drop it and the two sets
 * do not overlap.
 *
 * See `apps/web/docs/superset-features.md`. Adding the next superset feature is a
 * one-line addition here.
 */

/**
 * Export formats that can lose superset data (every format except `.osf`).
 *
 * `bps` is the Box Pleating Studio project format. There is no `bpz` here
 * because that is an import-only workspace bundle — nothing exports one.
 */
export type ExportFormat = 'cp' | 'fold' | 'ori' | 'orh' | 'dxf' | 'obj' | 'svg' | 'png' | 'bps';

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
  /**
   * Crease line segments, for counting non-180 fold angles. Unlike the other
   * entries this is sourced from kernel geometry rather than frontend state.
   */
  lineSegments: readonly OristudioCpLineSegment[];
  /**
   * Box-pleat mirror-draw state. Unlike the entries above this belongs to the
   * Design surface, not the crease pattern.
   */
  bpSymmetry: BpDocumentSymmetry;
}

interface SupersetFeature {
  id: string;
  label: string;
  /** How many are present (0 ⇒ absent). */
  count(presence: SupersetPresence): number;
  /** Formats that cannot store this feature. */
  droppedByFormats: readonly ExportFormat[];
  /**
   * When true, a format that cannot store this feature is **refused** rather
   * than offered with an "export anyway" confirmation.
   *
   * The distinction is whether losing the feature is recoverable. Images and
   * rich text are decoration: the crease pattern still means what it meant, and
   * the user still has the `.osf`. A dropped fold angle silently changes what
   * the pattern *is* — re-import it and every crease reads as a full ±180, with
   * nothing to indicate it was ever otherwise.
   */
  blocking?: boolean;
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

/**
 * Formats that round-trip crease semantics and would therefore lose a fold
 * angle silently. `.fold` carries `edges_foldAngle` and is lossless. `.svg` and
 * `.png` are pictures — nobody re-imports them as a crease pattern, so there is
 * no data to lose. `.dxf` and `.obj` both carry the crease colour and can be
 * re-imported, so they belong here.
 */
const FOLD_ANGLE_LOSSY_FORMATS: readonly ExportFormat[] = ['cp', 'ori', 'orh', 'dxf', 'obj'];

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
  {
    id: 'symmetry',
    label: 'Mirror symmetry',
    /**
     * One feature, not a tally: `.bps` loses the pairing, the on/off state, and
     * the fold together, and they are not comparable units to add up. Zero when
     * the design's symmetry is what a fresh open would give anyway, so exporting
     * a design nobody has mirrored raises nothing.
     */
    count: (presence) => {
      const defaults = defaultBpDocumentSymmetry();
      const { enabled, fold, pairs } = presence.bpSymmetry;
      const differs = enabled !== defaults.enabled || fold !== defaults.fold || pairs.length > 0;
      return differs ? 1 : 0;
    },
    droppedByFormats: ['bps'],
  },
  {
    id: 'foldAngles',
    label: 'Non-flat fold angles',
    count: (presence) =>
      presence.lineSegments.filter(
        (segment) => isFoldingCrease(segment.color) && !isClassicCrease(segment)
      ).length,
    droppedByFormats: FOLD_ANGLE_LOSSY_FORMATS,
    blocking: true,
  },
];

export interface ExportLossWarning {
  id: string;
  label: string;
  count: number;
  /** See {@link SupersetFeature.blocking}. */
  blocking: boolean;
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
    if (count > 0) {
      warnings.push({
        id: feature.id,
        label: feature.label,
        count,
        blocking: feature.blocking === true,
      });
    }
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

/** The warnings that make an export impossible rather than merely lossy. */
export function blockingExportLoss(
  warnings: readonly ExportLossWarning[]
): ExportLossWarning[] {
  return warnings.filter((warning) => warning.blocking);
}
