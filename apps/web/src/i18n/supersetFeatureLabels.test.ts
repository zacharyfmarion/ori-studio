import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import i18n from './index';
import type { ExportLossWarning, SupersetFeatureId } from '../lib/supersetFeatures';
import { describeExportLoss, supersetFeatureLabel } from './supersetFeatureLabels';

/**
 * Every feature the data table can report. Written out rather than derived, so
 * that adding a feature without naming it fails here as well as in the
 * compiler — the bug this file exists to prevent is a name that never reaches
 * the translator.
 */
const ALL_IDS: readonly SupersetFeatureId[] = [
  'images',
  'richText',
  'inlineSimulations',
  'symmetry',
  'foldAngles',
];

/** A translator that echoes the key it was asked for, ignoring the English default. */
const echoKeys = ((key: string) => key) as unknown as TFunction;

const warning = (id: SupersetFeatureId, count: number): ExportLossWarning => ({
  id,
  count,
  blocking: false,
});

describe('supersetFeatureLabel', () => {
  it('asks the translator for every feature, under a distinct key', () => {
    // The point of the assertion is that nothing comes back as literal English:
    // if a name were hard-coded, its entry here would be the prose, not a key.
    const keys = ALL_IDS.map((id) => supersetFeatureLabel(echoKeys, id));
    expect(keys).toEqual([
      'dialogs:exportLoss.feature.images',
      'dialogs:exportLoss.feature.richText',
      'dialogs:exportLoss.feature.inlineSimulations',
      'dialogs:exportLoss.feature.symmetry',
      'dialogs:exportLoss.feature.foldAngles',
    ]);
    expect(new Set(keys).size).toBe(ALL_IDS.length);
  });

  it('falls back to the English name when a catalog has not loaded', () => {
    expect(ALL_IDS.map((id) => supersetFeatureLabel(i18n.t, id))).toEqual([
      'Images',
      'Rich text formatting',
      'Simulation windows',
      'Mirror symmetry',
      'Non-flat fold angles',
    ]);
  });
});

describe('describeExportLoss', () => {
  it('reads as it did before the names were localized', () => {
    expect(describeExportLoss(i18n.t, [warning('images', 3)])).toBe('Images (3)');
    expect(describeExportLoss(i18n.t, [warning('images', 3), warning('foldAngles', 1)])).toBe(
      'Images (3), Non-flat fold angles (1)',
    );
  });

  it('is empty for a lossless export', () => {
    expect(describeExportLoss(i18n.t, [])).toBe('');
  });

  it('leaves the count in the translator’s hands rather than concatenating it', () => {
    // A locale that brackets differently (CJK sets them full-width) can only do
    // so if the pairing is one translatable string.
    const bracketed = ((key: string, _default: string, options: Record<string, unknown>) =>
      key === 'dialogs:exportLoss.featureCount'
        ? `${String(options.feature)}【${String(options.total)}】`
        : key) as unknown as TFunction;
    expect(describeExportLoss(bracketed, [warning('symmetry', 2)])).toBe(
      'dialogs:exportLoss.feature.symmetry【2】',
    );
  });
});
