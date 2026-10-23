/**
 * A flat folded picture's layer spread as a setting (Phase 13 of the diagram
 * workspace, `implementation-plans/diagram-distortion.md`): how far each
 * value may go, the spread a picture starts from, the rule that picks that
 * start from the pictures before it, one value set by a control, and the
 * value as a file holds it.
 *
 * Shared by every surface that spreads a flat picture's layers — a Diagram
 * step's pose, a Fold step's picture — so a spread means one thing in both,
 * and a Fold step sent to the Diagram keeps the spread it had. The geometry is
 * `foldedLayerSpread.ts`'s; this is the setting.
 *
 * Pure.
 */

import { finiteNumber, hasNewerKey, isRecord, NEWER } from '../../lib/documentFile';
import {
  SPREAD_DIRECTIONS,
  SPREAD_KEEPS,
  SPREAD_KINDS,
  type AffineSpreadOptions,
  type DepthSpreadOptions,
  type LayerSpreadOptions,
  type SpreadDirection,
  type SpreadKeep,
  type SpreadKind,
} from './foldedLayerSpread';

/**
 * How far a spread may go, by kind: a depth spread steps the deepest layer
 * 0.5% to 20% of the model; an affine one moves a point 0.5% to 25% of the
 * way back to the sheet along its axis (in every direction only at no skew).
 */
export const SPREAD_AMOUNT_RANGE: Readonly<Record<SpreadKind, { readonly min: number; readonly max: number }>> = {
  depth: { min: 0.005, max: 0.2 },
  affine: { min: 0.005, max: 0.25 },
};

/** An affine spread's skew: none (an even lerp toward the sheet) to all (about its axis). */
export const SPREAD_SKEW_RANGE = { min: 0, max: 1 } as const;

/** An affine spread's axis, in whole degrees: an axis at 180° is the one at 0°. */
export const SPREAD_AXIS_RANGE = { min: 0, max: 179 } as const;

/**
 * The depth spread Depth starts from when no earlier picture has one — Zach,
 * 2026-10-04: "depth based ON for folded figures, set to down and 2.5%". It
 * was every new flat pose's until affine took its place (2026-10-05).
 */
export const DEFAULT_DEPTH_SPREAD: DepthSpreadOptions = { kind: 'depth', amount: 0.025, toward: 'down' };

/**
 * The affine spread Affine starts from when no earlier picture has one: the
 * playground's bird base, DEFOX's angle 0.95 (φ = 162°, so θ = 81°), fully
 * skewed, 3%. Held still: the top as the front sees it — the playground drew
 * that fold from the side the kernel calls its back, so its bottom is the
 * front's top (`implementation-plans/diagram-distortion.md`, 13g).
 */
export const DEFAULT_AFFINE_SPREAD: AffineSpreadOptions = {
  kind: 'affine',
  amount: 0.03,
  keep: 'top',
  skew: 1,
  axisDeg: 81,
};

/**
 * The spread a flat picture starts with when no earlier one has one, and
 * Spread Layers turned on takes then — Zach, 2026-10-05: "I want affine to be
 * the default option and the first displayed, and default to on".
 */
export const DEFAULT_LAYER_SPREAD: LayerSpreadOptions = DEFAULT_AFFINE_SPREAD;

/**
 * An amount a spread of `kind` may take: within {@link SPREAD_AMOUNT_RANGE},
 * to a hundredth of a percent, so a slider's float noise is not written.
 */
export function clampSpreadAmount(kind: SpreadKind, amount: number): number {
  const { min, max } = SPREAD_AMOUNT_RANGE[kind];
  const fallback = kind === 'depth' ? DEFAULT_DEPTH_SPREAD.amount : DEFAULT_AFFINE_SPREAD.amount;
  const within = Number.isFinite(amount) ? Math.min(max, Math.max(min, amount)) : fallback;
  return Number(within.toFixed(4));
}

/** A skew an affine spread may take: 0 to 1, to a hundredth. */
export function clampSpreadSkew(skew: number): number {
  const within = Number.isFinite(skew) ? Math.min(1, Math.max(0, skew)) : DEFAULT_AFFINE_SPREAD.skew;
  return Number(within.toFixed(2));
}

/** An axis an affine spread may take: whole degrees, 0 to 179, one half-turn being the same axis. */
export function clampSpreadAxis(degrees: number): number {
  if (!Number.isFinite(degrees)) return DEFAULT_AFFINE_SPREAD.axisDeg;
  return ((Math.round(degrees) % 180) + 180) % 180;
}

/**
 * What a picture's spread starts from: a new flat picture, or Spread Layers
 * turned on (`any`), and either kind chosen (`depth`, `affine`) — each the
 * nearest earlier picture's, else its default.
 */
export interface LayerSpreadStarts {
  any: LayerSpreadOptions;
  depth: DepthSpreadOptions;
  affine: AffineSpreadOptions;
}

/** The starts when there is nothing earlier to look in: the defaults. */
export const DEFAULT_SPREAD_STARTS: LayerSpreadStarts = {
  any: DEFAULT_LAYER_SPREAD,
  depth: DEFAULT_DEPTH_SPREAD,
  affine: DEFAULT_AFFINE_SPREAD,
};

/**
 * The start rule (13g): a picture's spreads start from the nearest earlier
 * picture's — of the kind asked for, for a kind — else the defaults, so a
 * sequence's pictures spread alike without a setting of their own. `earlier`
 * is the spreads of the pictures before, nearest first; how a surface walks
 * back to them — a diagram's order, a Fold step's path — is its own.
 */
export function spreadStartsAmong(earlier: Iterable<LayerSpreadOptions>): LayerSpreadStarts {
  let any: LayerSpreadOptions | null = null;
  let depth: DepthSpreadOptions | null = null;
  let affine: AffineSpreadOptions | null = null;
  for (const spread of earlier) {
    any ??= spread;
    if (spread.kind === 'depth') depth ??= spread;
    else affine ??= spread;
    if (depth && affine) break;
  }
  return {
    any: any ?? DEFAULT_LAYER_SPREAD,
    depth: depth ?? DEFAULT_DEPTH_SPREAD,
    affine: affine ?? DEFAULT_AFFINE_SPREAD,
  };
}

/** Whether two spreads, or their absence, are one. */
export function sameSpread(a: LayerSpreadOptions | null | undefined, b: LayerSpreadOptions | null | undefined): boolean {
  if (a === b || (a == null && b == null)) return true;
  if (a == null || b == null || a.kind !== b.kind || a.amount !== b.amount) return false;
  if (a.kind === 'depth') return b.kind === 'depth' && a.toward === b.toward;
  return b.kind === 'affine' && a.keep === b.keep && a.skew === b.skew && a.axisDeg === b.axisDeg;
}

/**
 * One value of a spread, as a control sets it: an amount — with the kind of
 * spread it was set on, when it was dragged, since an amount is a share of
 * the model by depth and τ for an affine one — a depth spread's direction, or
 * an affine one's layer held still, skew or axis.
 */
export type LayerSpreadEdit =
  | { verb: 'spread-amount'; amount: number; kind?: SpreadKind }
  | { verb: 'spread-direction'; toward: SpreadDirection }
  | { verb: 'spread-keep'; keep: SpreadKeep }
  | { verb: 'spread-skew'; skew: number }
  | { verb: 'spread-axis'; axisDeg: number };

/** The verbs of {@link LayerSpreadEdit}. */
export const LAYER_SPREAD_EDIT_VERBS: ReadonlySet<string> = new Set([
  'spread-amount',
  'spread-direction',
  'spread-keep',
  'spread-skew',
  'spread-axis',
]);

/**
 * A spread with one value set as `edit` asks, within its range; the spread
 * itself when the edit is not for its kind — a direction for an affine one, a
 * skew for one by depth — which an edit undone under a drag can leave.
 */
export function withSpreadField(spread: LayerSpreadOptions, edit: LayerSpreadEdit): LayerSpreadOptions {
  switch (edit.verb) {
    case 'spread-amount':
      return edit.kind === undefined || edit.kind === spread.kind
        ? { ...spread, amount: clampSpreadAmount(spread.kind, edit.amount) }
        : spread;
    case 'spread-direction':
      return spread.kind === 'depth' ? { ...spread, toward: edit.toward } : spread;
    case 'spread-keep':
      return spread.kind === 'affine' ? { ...spread, keep: edit.keep } : spread;
    case 'spread-skew':
      return spread.kind === 'affine' ? { ...spread, skew: clampSpreadSkew(edit.skew) } : spread;
    case 'spread-axis':
      return spread.kind === 'affine' ? { ...spread, axisDeg: clampSpreadAxis(edit.axisDeg) } : spread;
  }
}

/**
 * A spread part of the way on: its amount times `weight`, from 0 — no spread,
 * null — to 1, the spread itself. The seam a motion eases a spread in or out
 * through, so a picture that moves need not jump to its spread when it comes
 * to rest. Never stored: a weighted amount may be under the range's minimum.
 */
export function weightedSpread(spread: LayerSpreadOptions | null, weight: number): LayerSpreadOptions | null {
  if (!spread || !(weight > 0)) return null;
  return weight >= 1 ? spread : { ...spread, amount: spread.amount * weight };
}

/** A spread's fields, by its kind: any other makes the spread a newer build's. */
const SPREAD_FIELDS: Readonly<Record<SpreadKind, ReadonlySet<string>>> = {
  depth: new Set(['kind', 'amount', 'toward']),
  affine: new Set(['kind', 'amount', 'keep', 'skew', 'axisDeg']),
};

/**
 * A spread as a file holds it: undefined when it has none. One with no `kind`
 * is a depth spread, as every spread was before there were two (13g). A kind,
 * a field, a direction, a layer held still or a value past what this build
 * reads is a newer build's ({@link NEWER}); one of the wrong type, or no step
 * at all, is damage (null). What either means is the caller's: a Diagram step
 * becomes a newer build's, a Fold step carries it.
 */
export function readLayerSpread(value: unknown): LayerSpreadOptions | undefined | typeof NEWER | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const kind = value.kind === undefined ? 'depth' : value.kind;
  if (typeof kind !== 'string') return null;
  if (!(SPREAD_KINDS as readonly string[]).includes(kind)) return NEWER;
  const known = kind as SpreadKind;
  // A field it has no name for is news before a missing one is damage, as for an annotation.
  if (hasNewerKey(value, SPREAD_FIELDS[known])) return NEWER;
  const amount = finiteNumber(value.amount);
  if (amount === null || amount <= 0) return null;
  const past = amount > SPREAD_AMOUNT_RANGE[known].max;
  if (known === 'depth') {
    if (typeof value.toward !== 'string') return null;
    if (past || !(SPREAD_DIRECTIONS as readonly string[]).includes(value.toward)) return NEWER;
    return { kind: 'depth', amount, toward: value.toward as SpreadDirection };
  }
  const skew = finiteNumber(value.skew);
  const axisDeg = finiteNumber(value.axisDeg);
  if (typeof value.keep !== 'string' || skew === null || axisDeg === null) return null;
  if (
    past ||
    !(SPREAD_KEEPS as readonly string[]).includes(value.keep) ||
    skew < SPREAD_SKEW_RANGE.min ||
    skew > SPREAD_SKEW_RANGE.max ||
    axisDeg < SPREAD_AXIS_RANGE.min ||
    axisDeg > SPREAD_AXIS_RANGE.max
  ) {
    return NEWER;
  }
  return { kind: 'affine', amount, keep: value.keep as SpreadKeep, skew, axisDeg };
}

/** A spread as a file holds it: every field named, in a fixed order, so a read and a write give back the same bytes. */
export function writeLayerSpread(spread: LayerSpreadOptions): Record<string, unknown> {
  return spread.kind === 'depth'
    ? { kind: spread.kind, amount: spread.amount, toward: spread.toward }
    : { kind: spread.kind, amount: spread.amount, keep: spread.keep, skew: spread.skew, axisDeg: spread.axisDeg };
}
