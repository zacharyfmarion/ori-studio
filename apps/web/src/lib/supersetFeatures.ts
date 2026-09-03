import type { CpImage } from '../cp-workspace/images/cpImage';
import type { TextAnnotation } from '../cp-workspace/annotations/textAnnotation';
import type { CpSuppressionRegion } from '../cp-workspace/annotations/suppressionRegion';
import type { InlineSimulation } from '../cp-workspace/inlineSimulation/inlineSimulation';
import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpLineSegment,
} from '../engine/oristudioCpTypes';
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
 * The module is deliberately free of React and of the translator: it decides
 * *what* is lost, never how to name it. The user-facing names live beside the
 * other localized data labels, in `i18n/supersetFeatureLabels.ts`.
 *
 * See `apps/web/docs/superset-features.md`. Adding the next superset feature is
 * a one-line addition here plus its name in that helper, which the compiler
 * requires.
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
   * Check-suppression regions. No Oriedita format has a concept of "do not
   * check inside here", so they are dropped whole.
   *
   * Required, like its neighbours. Optional would let a sampler forget the kind
   * and still compile — and the export-loss warning is the *only* thing standing
   * between a user and silently dropping their regions on a `.cp` export, so a
   * missing field has to be a type error rather than a zero.
   */
  suppressionRegions: readonly CpSuppressionRegion[];
  /**
   * Crease line segments, for counting non-180 fold angles. Unlike the other
   * entries this is sourced from kernel geometry rather than frontend state.
   */
  lineSegments: readonly OristudioCpLineSegment[];
  /**
   * Folded figures on the crease-pattern canvas, for counting the **3D** ones.
   * A flat folded figure is not a superset feature — every format drops it and
   * nobody expects otherwise, because it is derived from the creases and any
   * reader can recompute it. A 3D one is different: no format carries a
   * non-180 fold angle except `.fold`, so there is nothing to recompute it from.
   */
  foldedFigures: readonly OristudioCpFoldedFigureEntry[];
  /**
   * Box-pleat mirror-draw state. Unlike the entries above this belongs to the
   * Design surface, not the crease pattern.
   */
  bpSymmetry: BpDocumentSymmetry;
}

/**
 * Stable identifier for a superset feature. A closed union rather than `string`
 * so `i18n/supersetFeatureLabels.ts` can name every one of them exhaustively —
 * adding a feature here without a translation is a type error, which is what
 * keeps these names from reaching the export dialog in English.
 */
export type SupersetFeatureId =
  | 'images'
  | 'richText'
  | 'inlineSimulations'
  | 'suppressionRegions'
  | 'symmetry'
  | 'foldAngles'
  | 'unassignedCreases'
  | 'directionHints'
  | 'foldedForm3d'
  | 'foldedForm3dDetached';

interface SupersetFeature {
  id: SupersetFeatureId;
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

/**
 * Formats that cannot say "this crease is undecided", and what they do instead.
 *
 * `.fold` is not here: it writes `edges_assignment: "U"` and round-trips both
 * the crease and its hint, which is why the whole encoding was chosen. `.ori`
 * and `.orh` keep `LineColor::None`, so they lose the hint but not the
 * undecided-ness — they appear under `directionHints` alone.
 *
 * `.cp` is the sharp one. Measured by round-tripping a hinted pair through the
 * real exporter and importer: both creases come back **`Cyan3`**, an auxiliary
 * line, which is not a crease at all. So a `.cp` export does not merely forget
 * which way you meant it to fold, it forgets that it was a crease.
 */
const UNASSIGNED_CREASE_LOSSY_FORMATS: readonly ExportFormat[] = ['cp', 'dxf', 'obj'];

/** Everything that cannot carry the hint, which is every format but `.fold`. */
const DIRECTION_HINT_LOSSY_FORMATS: readonly ExportFormat[] = ['cp', 'ori', 'orh', 'dxf', 'obj'];

const SUPERSET_FEATURES: readonly SupersetFeature[] = [
  {
    id: 'images',
    count: (presence) => presence.images.length,
    droppedByFormats: ALL_LOSSY_FORMATS,
  },
  {
    id: 'richText',
    count: (presence) => presence.richText.length,
    droppedByFormats: ALL_LOSSY_FORMATS,
  },
  {
    id: 'inlineSimulations',
    count: (presence) => presence.inlineSimulations.length,
    droppedByFormats: ALL_LOSSY_FORMATS,
  },
  {
    id: 'suppressionRegions',
    count: (presence) => presence.suppressionRegions.length,
    droppedByFormats: ALL_LOSSY_FORMATS,
    /**
     * Not blocking, for the same reason images are not: the crease pattern
     * still means what it meant. What is lost is an instruction about *which
     * findings not to report*, so a re-import shows more than the author saw —
     * noisier, never wrong, and the `.osf` still has the regions.
     *
     * An attached `ExactSolveInput` goes with them, which is the sharper loss:
     * a re-imported pattern can no longer offer a warm Solve. Still recoverable
     * — the cold rebuild derives one from geometry — so it does not earn a
     * refusal either.
     */
  },
  {
    id: 'symmetry',
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
    count: (presence) =>
      presence.lineSegments.filter(
        (segment) => isFoldingCrease(segment.color) && !isClassicCrease(segment)
      ).length,
    droppedByFormats: FOLD_ANGLE_LOSSY_FORMATS,
    blocking: true,
  },
  {
    id: 'unassignedCreases',
    count: (presence) => presence.lineSegments.filter((segment) => segment.color === 'None').length,
    droppedByFormats: UNASSIGNED_CREASE_LOSSY_FORMATS,
    /**
     * Blocking, for the same reason `foldAngles` is: the crease does not come
     * back weaker, it comes back *different*. A `.cp` round trip turns it into
     * an auxiliary line, so a pattern you exported to share is one whose
     * undecided creases have quietly stopped being creases.
     */
    blocking: true,
  },
  {
    id: 'directionHints',
    count: (presence) =>
      presence.lineSegments.filter(
        (segment) => segment.color === 'None' && (segment.fold_direction_hint ?? null) !== null
      ).length,
    droppedByFormats: DIRECTION_HINT_LOSSY_FORMATS,
    /**
     * Not blocking. Unlike the two above, losing a hint degrades rather than
     * changes: the crease comes back undecided, which is what it is. The hint
     * was a note about which way you meant it to go, and the same file reopened
     * in Ori Studio is still solvable — it just asks you the question again.
     */
  },
  {
    id: 'foldedForm3d',
    count: (presence) =>
      presence.foldedFigures.filter(
        (figure) => (figure.folded3d ?? null) !== null && figure.handle != null
      ).length,
    /**
     * `.fold` is **not** in this list: the export writes one `foldedForm` frame
     * per 3D figure, with three-component `vertices_coords` and `faceOrders`.
     *
     * `.svg`/`.png` are excluded because a folded figure is a picture and those
     * formats *are* the picture — the per-figure export writes it directly from
     * the stored primitives. `.bps` is excluded because a crease pattern is
     * never exported as one.
     *
     * Not blocking. The `foldAngles` entry above already refuses every format
     * here, on the same documents, because losing the *angles* changes what the
     * pattern is; losing the figure derived from them does not, and the `.osf`
     * still has it.
     */
    droppedByFormats: ['cp', 'ori', 'orh', 'dxf', 'obj'],
  },
  {
    id: 'foldedForm3dDetached',
    /**
     * The `foldedForm` frame is built in the kernel from the live
     * `Fold3dSession` — placement rings, plane frames, the layer relation —
     * none of which is persisted. A figure reopened from an `.osf` has no
     * handle, so it draws from its stored primitives but cannot describe
     * itself, and `.fold` genuinely does drop it.
     *
     * A separate entry rather than a caveat on the one above, because the two
     * differ in exactly one format and merging them would have to lie about
     * `.fold` in one direction or the other. Refold is the escape hatch, and
     * for a 3D figure it reproduces the same solution exactly.
     */
    count: (presence) =>
      presence.foldedFigures.filter(
        (figure) => (figure.folded3d ?? null) !== null && figure.handle == null
      ).length,
    droppedByFormats: ['cp', 'fold', 'ori', 'orh', 'dxf', 'obj'],
  },
];

export interface ExportLossWarning {
  id: SupersetFeatureId;
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
        count,
        blocking: feature.blocking === true,
      });
    }
  }
  return warnings;
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
