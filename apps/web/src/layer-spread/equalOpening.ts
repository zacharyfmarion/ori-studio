import { spreadOpening, type ConnectedSpread, type SpreadOpening, type SpreadSolution } from '@oristudio/layer-spread';
import { SPREAD_AMOUNT_RANGE } from '../cp-workspace/folded/layerSpreadSettings';
import type { LayerSpreadOptions } from '../cp-workspace/folded/foldedLayerSpread';
import type { PreparedConnectedSpread } from './connectedScene';
import type { SpreadPresentation } from './presentation';

/**
 * How Perspective 3D turns a Default spread's Amount into height, by the
 * spread's version (`implementation-plans/spread-equal-opening.md`).
 *
 * Version 1 doubles the stored amount: 100% is four times the model's own
 * solve, so a two-face fold's layers part by 40° and a deep stack's barely
 * part. Every spread saved before version 2 is version 1 and is drawn so,
 * unchanged.
 *
 * Version 2 opens models alike: at 100% neighbouring layers part by
 * {@link FULL_OPENING_DEG} on average, unless that would tilt all but the
 * steepest 1% of the paper past {@link STEEPEST_AT_FULL_DEG} or lift some of
 * it past {@link HIGHEST_AT_FULL}, which hold a model back
 * (`equalOpeningGainOf`).
 * Diagram draws both versions alike, so version 2 is written only where
 * Perspective shows it.
 *
 * The numbers below, and what `spreadOpening` measures, define version 2 as
 * saved files draw it: a recalibration that moves a picture is version 3, and
 * version 2 keeps these. Version 3 uses the same gain at the stored Amount
 * in both head-on and Perspective views (2× at full Amount before gain).
 */

/** How many times its solved heights version 1 draws a stored amount. */
const DOUBLED = 2;
/** The height multiplier at 100% in version 1: the slider's top, doubled. */
const FULL_HEIGHT = DOUBLED * SPREAD_AMOUNT_RANGE.connected.max;
/** How far neighbouring layers open at 100% in version 2: the cpoogle median at version 1, so a typical design looks as it did. */
export const FULL_OPENING_DEG = 12.4;
/**
 * How steep all but the steepest 1% of the paper (its 99th-percentile slope,
 * by area) may be at 100%, unless version 1 already draws it steeper. The
 * slivers in that 1% may be steeper: that is the point of the percentile.
 */
export const STEEPEST_AT_FULL_DEG = 65;
/**
 * How high any of the paper may rise at 100%, as a share of the flat paper's
 * diagonal, unless version 1 already lifts it higher: height is slope times
 * lever arm, so a deep strip can stay within the slope limit and still rise
 * far, and the Perspective eye stands about two diagonals away.
 */
export const HIGHEST_AT_FULL = 0.5;
/** No model is drawn more than this many times its version 1 height. */
const MAX_GAIN = 20;

const tanDeg = (degrees: number) => Math.tan((degrees * Math.PI) / 180);
const gains = new WeakMap<SpreadSolution, number>();

/**
 * How many times its version 1 height a model is drawn in version 2, from
 * how its solve opens (`spreadOpening`): what opens its neighbouring layers
 * {@link FULL_OPENING_DEG} at 100%, no more than keeps all but its steepest
 * 1% within {@link STEEPEST_AT_FULL_DEG} and its highest within
 * {@link HIGHEST_AT_FULL} — limits that only ever hold a gain back, never
 * take a model below version 1. A solve that opens nothing keeps its height.
 */
export function equalOpeningGainOf({ opening, steep, reach }: SpreadOpening): number {
  const wanted = opening > 1e-9 ? tanDeg(FULL_OPENING_DEG) / (FULL_HEIGHT * opening) : 1;
  const steepest = steep > 0 ? Math.max(1, tanDeg(STEEPEST_AT_FULL_DEG) / (FULL_HEIGHT * steep)) : Infinity;
  const highest = reach > 0 ? Math.max(1, HIGHEST_AT_FULL / (FULL_HEIGHT * reach)) : Infinity;
  return Math.min(wanted, steepest, highest, MAX_GAIN);
}

/** {@link equalOpeningGainOf} a prepared spread's solve, measured once per solution. */
export function equalOpeningGain({ source, solution }: PreparedConnectedSpread): number {
  const known = gains.get(solution);
  if (known !== undefined) return known;
  const gain = equalOpeningGainOf(spreadOpening(source.input, solution.heights));
  gains.set(solution, gain);
  return gain;
}

/** Multiplier on the stored Amount. Versions 1 and 2 retain their saved policy. */
export function connectedHeightScale(spread: Pick<ConnectedSpread, 'version'>, prepared: PreparedConnectedSpread, perspective: boolean): number {
  if (spread.version === 3) return equalOpeningGain(prepared);
  if (!perspective) return 1;
  return spread.version === 1 ? DOUBLED : DOUBLED * equalOpeningGain(prepared);
}

/**
 * How far a spread lifts its solve's unit heights in a view: the stored
 * Amount by its version's multiplier. Every lift reads this one — the picture,
 * its picking and captures (`connectedDrawing`), and a flat figure's OBJ,
 * which is the paper as Perspective 3D lifts it.
 */
export function connectedDrawAmount(spread: Pick<ConnectedSpread, 'version' | 'amount'>, prepared: PreparedConnectedSpread, perspective: boolean): number {
  return spread.amount * connectedHeightScale(spread, prepared, perspective);
}

/** Historical first visit to Perspective on a v1 flat pose. */
export function spreadInPerspective<Spread extends LayerSpreadOptions>(spread: Spread): Spread {
  return spread.kind === 'connected' && spread.version === 1 ? { ...spread, version: 2 } : spread;
}

/**
 * Whether a presentation change shows a pose in Perspective 3D for the first
 * time. A pose that has a presentation has been in Perspective 3D: Diagram
 * keeps the one it came from so switching back is reversible
 * (`presentation.ts`), and the pose comes back at its own version — a
 * version 1 picture as it was saved, with its Update.
 */
export function entersPerspective(from: SpreadPresentation | undefined, to: SpreadPresentation['kind']): boolean {
  return to === 'perspective' && from === undefined;
}

/** Unclamped so the controls can disclose when preserving this view exceeds 100%. */
export function sharedOpeningAmount(spread: ConnectedSpread, prepared: PreparedConnectedSpread, perspective: boolean): number {
  if (spread.version === 2 && perspective) return DOUBLED * spread.amount;
  return connectedDrawAmount(spread, prepared, perspective) / equalOpeningGain(prepared);
}
