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
  'BigLittleBig',
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

/**
 * The `rule` codes the **spatial** half of `CheckCamv` emits.
 *
 * A separate vocabulary from Oriedita's five flat rules, and it needs its own
 * gate: `FOLDABILITY_RULES` is what `foldabilityMessages.test.ts` iterates, and
 * nothing gated a spatial rule at all — `foldabilityEntryMessage` special-cased
 * two of them before the `isRule` guard and everything else fell through to the
 * kernel's raw English message, in all eight locales.
 *
 * Paired with a Rust test over the same four literals
 * (`crates/oristudio-cp/tests/checks_spatial.rs`,
 * `the_spatial_check_emits_only_the_four_rules_the_frontend_words`). Neither
 * language can see the other's table, so a rename needs both gates to catch it.
 */
export const SPATIAL_RULES = ['Closure', 'Rigid', 'SelfIntersection', 'InteriorBorder'] as const;

export type FoldabilityRule = (typeof FOLDABILITY_RULES)[number];
export type FoldabilityColor = (typeof FOLDABILITY_COLORS)[number];
export type SpatialRule = (typeof SPATIAL_RULES)[number];

function isRule(value: string | null | undefined): value is FoldabilityRule {
  return FOLDABILITY_RULES.includes(value as FoldabilityRule);
}

function isSpatialRule(value: string | null | undefined): value is SpatialRule {
  return SPATIAL_RULES.includes(value as SpatialRule);
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
        'equal amount of mountain and valley folds',
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
  color: FoldabilityColor,
): string | null {
  switch (rule) {
    // Triangle. The odd count is a fact the colour does not carry, so it leads.
    case 'NumberOfFolds': {
      if (color === 'Unknown') {
        return t(
          'panels:creasePattern.foldability.edgeLineCount',
          'Too many or not enough edge lines',
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
          'Invalid configuration of edge lines',
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
        'Incorrect angles',
      );
      return compose(t, incorrectAngles, colorPhrase(t, color));
    }

    // No legend entry upstream: Oriedita draws this as angular sectors rather
    // than a marker, so the wording is ours.
    case 'BigLittleBig':
      return t(
        'panels:creasePattern.foldability.bigLittleBig',
        'Angles cannot nest (big-little-big)',
      );

    // A violation is never reported with no rule; the kernel's message stands.
    case 'None':
      return null;
  }
}

/**
 * The sentence for a spatial-check rule.
 *
 * Exhaustive over {@link SPATIAL_RULES} by construction — the switch has no
 * default, so adding a code without a sentence is a type error rather than a
 * blank row.
 */
export function spatialRuleMessage(
  t: TFunction,
  rule: SpatialRule,
  entry?: Pick<OristudioCpDiagnosticEntry, 'residual_degrees'>,
): string {
  // Literal keys so the i18n extractor can see them (see apps/web/CLAUDE.md).
  switch (rule) {
    // The creases at this vertex cannot all hold at once. The residual is the
    // one number that makes it actionable — a degree off is a typo, ninety is a
    // different design — so it is interpolated rather than described.
    case 'Closure': {
      const residual = entry?.residual_degrees;
      return residual == null
        ? t('panels:creasePattern.foldability.closure', 'The creases here do not close up')
        : t(
            'panels:creasePattern.foldability.closureResidual',
            'The creases here do not close up: {{degrees}}° off',
            { degrees: Math.round(residual * 100) / 100 },
          );
    }
    // Not a conflict to fix. A degree-1 or developable degree-3 vertex has one
    // solution and it is zero, so reporting disagreement would invite an
    // adjustment that cannot help.
    case 'Rigid':
      return t(
        'panels:creasePattern.foldability.rigidVertex',
        'This vertex is rigid, so every crease here must be flat',
      );
    // Not one of Oriedita's rules: this branch's own check, that the paper does
    // not pass through itself at a vertex whose fold angles do agree.
    case 'SelfIntersection':
      return t(
        'panels:creasePattern.foldability.selfIntersection',
        'Paper passes through itself here',
      );
    // Also not Oriedita's: an edge drawn inside the sheet rather than around it.
    // The point of the entry is that the check *cannot see* the vertices on it —
    // saying "not checked" is the whole message, so it must not read as a defect.
    case 'InteriorBorder':
      return t(
        'panels:creasePattern.foldability.interiorBorder',
        'Edge with paper on both sides — foldability is not checked along it',
      );
  }
}

/** The sentence for a diagnostic entry, or `null` if it is not one of ours. */
export function foldabilityEntryMessage(
  t: TFunction,
  entry: OristudioCpDiagnosticEntry,
): string | null {
  if (isSpatialRule(entry.rule)) return spatialRuleMessage(t, entry.rule, entry);
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
