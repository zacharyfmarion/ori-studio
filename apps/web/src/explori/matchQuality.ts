import type { TFunction } from 'i18next';

/**
 * How close a result is, in the five buckets ExplOri shows.
 *
 * Thresholds are upstream's current ones, on the **raw** distance — the variant
 * that normalizes by the query's own spectral norm survives only in their detail
 * view, and their results grid has already stopped using it (`results.js`, where
 * the normalization sits commented out above a call taking `result.distance`).
 * Pinned here, in one place, with that provenance, so a future divergence is
 * something we notice rather than something we inherit.
 *
 * The raw number is deliberately not shown, as upstream does not show it: the
 * distance is only meaningful relative to other results of the same query.
 */

export type ExploriMatchQuality = 'great' | 'good' | 'acceptable' | 'poor' | 'terrible';

export function exploriMatchQuality(distance: number): ExploriMatchQuality {
  const scaled = distance * 1000;
  if (scaled < 0.75) return 'great';
  if (scaled < 1.5) return 'good';
  if (scaled < 3) return 'acceptable';
  if (scaled < 4) return 'poor';
  return 'terrible';
}

export function exploriMatchQualityLabel(t: TFunction, quality: ExploriMatchQuality): string {
  switch (quality) {
    case 'great':
      return t('panels:explori.qualityGreat', 'Great match');
    case 'good':
      return t('panels:explori.qualityGood', 'Good match');
    case 'acceptable':
      return t('panels:explori.qualityAcceptable', 'Acceptable match');
    case 'poor':
      return t('panels:explori.qualityPoor', 'Poor match');
    default:
      return t('panels:explori.qualityTerrible', 'Distant match');
  }
}
