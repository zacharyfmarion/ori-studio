import type { TFunction } from 'i18next';
import type { ExportLossWarning, SupersetFeatureId } from '../lib/supersetFeatures';

/**
 * Render-time names for the superset features an export can drop.
 *
 * `lib/supersetFeatures.ts` is a React-free data table that decides *what* a
 * format loses; it carries no English, because a plain `label` field there is
 * invisible to the i18n extractor and shipped these names in English to every
 * locale. Literal `t()` keys are what the extractor can see, so the names live
 * here — same shape as `enumLabels.ts` and `paletteLabels.ts`.
 */

/** Localized name for one superset feature, keyed by its stable id. */
export function supersetFeatureLabel(t: TFunction, id: SupersetFeatureId): string {
  // No `default`: a new feature id with no name here fails to typecheck, which
  // is the whole point of the closed union.
  switch (id) {
    case 'images':
      return t('dialogs:exportLoss.feature.images', 'Images');
    case 'richText':
      return t('dialogs:exportLoss.feature.richText', 'Rich text formatting');
    case 'inlineSimulations':
      return t('dialogs:exportLoss.feature.inlineSimulations', 'Simulation windows');
    case 'symmetry':
      return t('dialogs:exportLoss.feature.symmetry', 'Mirror symmetry');
    case 'foldAngles':
      return t('dialogs:exportLoss.feature.foldAngles', 'Non-flat fold angles');
    case 'unassignedCreases':
      return t('dialogs:exportLoss.feature.unassignedCreases', 'Unassigned creases');
    case 'directionHints':
      return t(
        'dialogs:exportLoss.feature.directionHints',
        'Direction hints on unassigned creases'
      );
    case 'foldedForm3d':
      return t('dialogs:exportLoss.feature.foldedForm3d', '3D folded figures');
    case 'foldedForm3dDetached':
      return t(
        'dialogs:exportLoss.feature.foldedForm3dDetached',
        '3D folded figures needing a refold'
      );
  }
}

/**
 * Localized summary of the dropped features, e.g. "Images (3)". The count is
 * interpolated rather than concatenated so a locale can move or re-shape the
 * brackets — CJK sets them full-width.
 */
export function describeExportLoss(
  t: TFunction,
  warnings: readonly ExportLossWarning[]
): string {
  return warnings
    .map((warning) =>
      // `total`, not `count`: `count` would send i18next looking for plural
      // forms of a string that has none.
      t('dialogs:exportLoss.featureCount', '{{feature}} ({{total}})', {
        feature: supersetFeatureLabel(t, warning.id),
        total: warning.count,
      })
    )
    .join(', ');
}
