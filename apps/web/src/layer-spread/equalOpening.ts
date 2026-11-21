import { spreadOpening, type ConnectedSpread, type SpreadOpening, type SpreadSolution } from '@oristudio/layer-spread';
import { clampSpreadAmount, SPREAD_AMOUNT_RANGE } from '../cp-workspace/folded/layerSpreadSettings';
import type { LayerSpreadOptions } from '../cp-workspace/folded/foldedLayerSpread';
import type { PreparedConnectedSpread } from './connectedScene';
import type { SpreadPresentation } from './presentation';

/**
 * How Perspective 3D turns a Default spread's Amount into height, by the
 * spread's version (`implementation-plans/spread-equal-opening.md`).
 *
 * Version 1 doubles the stored amount: 100% is four times the model's own
 * solve, so a two-face fold opens 46° and a deep stack barely parts. Every
 * spread saved before version 2 is version 1 and is drawn so, unchanged.
 *
 * Version 2 opens every model alike: at 100% neighbouring layers part by
 * {@link FULL_OPENING_DEG} on average, whatever the model. Diagram draws both
 * versions alike, so version 2 is written only where Perspective shows it.
 */

/** How many times its solved heights version 1 draws a stored amount. */
const DOUBLED = 2;
/** The height multiplier at 100% in version 1: the slider's top, doubled. */
const FULL_HEIGHT = DOUBLED * SPREAD_AMOUNT_RANGE.connected.max;
/** How far neighbouring layers open at 100% in version 2: the cpoogle median at version 1, so a typical design looks as it did. */
export const FULL_OPENING_DEG = 12.4;
/** How steep the steepest 1% of the paper may be at 100%, unless version 1 already draws it steeper. */
export const STEEPEST_AT_FULL_DEG = 65;
/** No model is drawn more than this many times its version 1 height. */
const MAX_GAIN = 20;

const tanDeg = (degrees: number) => Math.tan((degrees * Math.PI) / 180);
const gains = new WeakMap<SpreadSolution, number>();

/**
 * How many times its version 1 height a model is drawn in version 2, from
 * how its solve opens (`spreadOpening`): what opens its neighbouring layers
 * {@link FULL_OPENING_DEG} at 100%, no more than keeps its steepest paper
 * within {@link STEEPEST_AT_FULL_DEG} — a limit that only ever holds a gain
 * back, never takes a model below version 1. A solve that opens nothing keeps
 * its height.
 */
export function equalOpeningGainOf({ opening, steep }: SpreadOpening): number {
  const wanted = opening > 1e-9 ? tanDeg(FULL_OPENING_DEG) / (FULL_HEIGHT * opening) : 1;
  const steepest = steep > 0 ? Math.max(1, tanDeg(STEEPEST_AT_FULL_DEG) / (FULL_HEIGHT * steep)) : Infinity;
  return Math.min(wanted, steepest, MAX_GAIN);
}

/** {@link equalOpeningGainOf} a prepared spread's solve, measured once per solution. */
export function equalOpeningGain({ source, solution }: PreparedConnectedSpread): number {
  const known = gains.get(solution);
  if (known !== undefined) return known;
  const gain = equalOpeningGainOf(spreadOpening(source.input, solution.heights));
  gains.set(solution, gain);
  return gain;
}

/** How many times its solved heights Perspective 3D draws `spread`'s amount. */
export function perspectiveHeightScale(spread: ConnectedSpread, prepared: PreparedConnectedSpread): number {
  return spread.version === 1 ? DOUBLED : DOUBLED * equalOpeningGain(prepared);
}

/** A spread as Perspective 3D shows it from now on: a Default one by version 2. */
export function spreadInPerspective<Spread extends LayerSpreadOptions>(spread: Spread): Spread {
  return spread.kind === 'connected' && spread.version !== 2 ? { ...spread, version: 2 } : spread;
}

/**
 * A spread started fresh — Spread Layers turned on, or a kind chosen — in a
 * pose shown as `presentation`: by version 2 in Perspective 3D, as it is.
 */
export function startedSpread<Spread extends LayerSpreadOptions>(spread: Spread, presentation: SpreadPresentation | undefined): Spread {
  return presentation?.kind === 'perspective' ? spreadInPerspective(spread) : spread;
}

/** Whether a presentation change takes a pose into Perspective 3D from another. */
export function entersPerspective(from: SpreadPresentation | undefined, to: SpreadPresentation['kind']): boolean {
  return to === 'perspective' && from?.kind !== 'perspective';
}

/**
 * The amount a version 1 spread takes in version 2 to draw the picture it
 * draws now, no more than 100%: a model version 1 opened past the new 100%
 * comes down to it.
 */
export function equalOpeningAmount(spread: ConnectedSpread, prepared: PreparedConnectedSpread): number {
  const scale = perspectiveHeightScale({ ...spread, version: 2 }, prepared);
  return clampSpreadAmount('connected', (spread.amount * perspectiveHeightScale(spread, prepared)) / scale);
}
