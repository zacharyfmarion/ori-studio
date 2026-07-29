/**
 * What a foldability violation says, in Oriedita's own words.
 *
 * The kernel reports a violation structurally — a `rule` (which theorem failed)
 * and a `violation_color` (how it failed) — and never a sentence. This is where
 * that pair becomes one, and it is the same join
 * {@link cpDiagnosticMarkerStyle} performs to pick the marker shape, with a
 * different codomain.
 *
 * # The vocabulary is shape *and* colour
 *
 * Oriedita's legend is two-dimensional, and the phrase is only the colour half:
 *
 * - **Triangles** — incorrect (odd) number of folds
 * - **Squares** — incorrect fold types
 * - **Circles** — incorrect angles (Kawasaki's theorem); solid is "like squares,
 *   but with incorrect angles", hollow is angles alone
 *
 * so "Not enough mountain folds" appears under three shapes meaning three
 * different things. On the canvas the legend disambiguates. In a list row there
 * is no legend, which is why:
 *
 * > **the row is `[what the shape says —] what the colour says`**, including the
 * > shape's half only when it is an independent fact.
 *
 * A square's "incorrect fold types" *is* its colour's fact, so it is not
 * repeated. A triangle's odd count and a circle's bad angles are separate facts,
 * so they lead. The circle case is not an invention — it is the legend's own
 * composition rule, written out.
 *
 * # Why here and not in the kernel
 *
 * The kernel builds an English `message` today. Leaving it alone and composing
 * in the frontend is what lets these strings pass through i18n at all — eight
 * locales are gated in CI, and a Rust string literal cannot satisfy that gate.
 * It also keeps the change additive: tests, the CLI, and the oracle still read
 * the kernel's `message`, and anything this table does not recognise falls back
 * to it.
 */
import type { TFunction } from 'i18next';
import type { OristudioCpDiagnosticEntry } from '../../engine/oristudioCpTypes';

/** `checks::FlatFoldabilityRule`, as it crosses the wasm boundary. */
export const FOLDABILITY_RULES = [
  'NumberOfFolds',
  'Angles',
  'Maekawa',
  'LittleBigLittle',
  'None',
] as const;

/** `checks::FlatFoldabilityColor`, as it crosses the wasm boundary. */
export const FOLDABILITY_COLORS = [
  'NotEnoughMountain',
  'NotEnoughValley',
  'Equal',
  'Correct',
  'Unknown',
] as const;

export type FoldabilityRule = (typeof FOLDABILITY_RULES)[number];
export type FoldabilityColor = (typeof FOLDABILITY_COLORS)[number];

function isRule(value: string | null | undefined): value is FoldabilityRule {
  return FOLDABILITY_RULES.includes(value as FoldabilityRule);
}

function isColor(value: string | null | undefined): value is FoldabilityColor {
  return FOLDABILITY_COLORS.includes(value as FoldabilityColor);
}

/** The colour half of the legend: how the vertex's fold types are wrong. */
function colorPhrase(t: TFunction, color: FoldabilityColor): string | null {
  switch (color) {
    case 'NotEnoughMountain':
      return t('panels:creasePattern.foldability.notEnoughMountain', 'not enough mountain folds');
    case 'NotEnoughValley':
      return t('panels:creasePattern.foldability.notEnoughValley', 'not enough valley folds');
    case 'Equal':
      return t(
        'panels:creasePattern.foldability.equalMountainValley',
        'equal amount of mountain and valley folds'
      );
    // `Correct` means the fold types are fine and only the shape's own fact is
    // wrong; `Unknown` is the edge-line case, which each shape words itself.
    case 'Correct':
    case 'Unknown':
      return null;
  }
}

/** Capitalise a phrase that is standing alone rather than following a clause. */
function leading(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function compose(t: TFunction, lead: string, tail: string | null): string {
  return tail === null
    ? lead
    : t('panels:creasePattern.foldability.compose', '{{lead}} — {{tail}}', { lead, tail });
}

/**
 * The sentence for a `(rule, colour)` pair, or `null` when the pair is not a
 * flat-foldability violation this table speaks for.
 */
export function foldabilityViolationMessage(
  t: TFunction,
  rule: FoldabilityRule,
  color: FoldabilityColor
): string | null {
  switch (rule) {
    // Triangle. The odd count is a fact the colour does not carry, so it leads.
    case 'NumberOfFolds': {
      if (color === 'Unknown') {
        return t(
          'panels:creasePattern.foldability.edgeLineCount',
          'Too many or not enough edge lines'
        );
      }
      const oddFolds = t('panels:creasePattern.foldability.oddFolds', 'Odd number of folds');
      return compose(t, oddFolds, colorPhrase(t, color));
    }

    // Square. "Incorrect fold types" is exactly what the colour says, so saying
    // it again would be noise.
    case 'Maekawa': {
      if (color === 'Unknown') {
        return t(
          'panels:creasePattern.foldability.edgeLineConfiguration',
          'Invalid configuration of edge lines'
        );
      }
      const phrase = colorPhrase(t, color);
      return phrase === null
        ? t('panels:creasePattern.foldability.incorrectFoldTypes', 'Incorrect fold types')
        : leading(phrase);
    }

    // Circle. Solid is "like squares, but with incorrect angles"; hollow is the
    // angles alone.
    case 'Angles': {
      const incorrectAngles = t(
        'panels:creasePattern.foldability.incorrectAngles',
        'Incorrect angles'
      );
      return compose(t, incorrectAngles, colorPhrase(t, color));
    }

    // No legend entry upstream: Oriedita draws this as angular sectors rather
    // than a marker, so the wording is ours.
    case 'LittleBigLittle':
      return t(
        'panels:creasePattern.foldability.littleBigLittle',
        'Angles cannot nest (little-big-little)'
      );

    // A violation is never reported with no rule; the kernel's message stands.
    case 'None':
      return null;
  }
}

/** The sentence for a diagnostic entry, or `null` if it is not one of ours. */
export function foldabilityEntryMessage(
  t: TFunction,
  entry: OristudioCpDiagnosticEntry
): string | null {
  if (!isRule(entry.rule) || !isColor(entry.violation_color)) return null;
  return foldabilityViolationMessage(t, entry.rule, entry.violation_color);
}

/**
 * What to show for any diagnostic entry.
 *
 * Falls back to the kernel's own `message` for everything this table does not
 * speak for — spatial-closure failures, overlap and T-junction checks — which
 * already read as prose. The fallback is deliberate rather than a gap: it means
 * a rule added to the kernel tomorrow surfaces its English message instead of
 * rendering blank.
 */
export function cpDiagnosticEntryMessage(t: TFunction, entry: OristudioCpDiagnosticEntry): string {
  return foldabilityEntryMessage(t, entry) ?? entry.message;
}
