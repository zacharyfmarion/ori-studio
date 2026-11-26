/**
 * An OBJ's Amount, read as the figure's own Spread section reads it: whole
 * percents, a flat figure's Default spread over its height range
 * (`spreadAmountSlider`), a 3D figure's spatial spread over its displacement
 * field (`spatialSpreadPercent`), each with the amount its reset goes back to.
 *
 * Pure: the dialog's rows lay it out (`ObjSpreadRows`).
 */
import { spreadAmountSlider } from '../cp-workspace/folded/layerSpreadControls';
import { clampSpreadAmount, DEFAULT_CONNECTED_SPREAD } from '../cp-workspace/folded/layerSpreadSettings';
import {
  clampSpatialSpreadAmount,
  DEFAULT_SPATIAL_SPREAD_AMOUNT,
  spatialSpreadFromPercent,
  spatialSpreadPercent,
} from '../cp-workspace/folded/spatialSpreadSettings';
import type { PaperObjSpreadSource } from './paperExportTarget';

export interface ObjSpreadSlider {
  min: number;
  max: number;
  step: number;
  /** The amount at the slider's grid, in percents. */
  value: number;
  /** The amount a position of the slider sets. */
  amountOf: (percent: number) => number;
  /** What Amount's reset sets: the amount Spread layers turns on at. */
  reset: number;
}

export function objSpreadSlider(kind: PaperObjSpreadSource['kind'], amount: number): ObjSpreadSlider {
  if (kind === 'spatial') {
    return {
      min: 0,
      max: 100,
      step: 1,
      value: Math.round(spatialSpreadPercent(amount)),
      amountOf: (percent) => clampSpatialSpreadAmount(spatialSpreadFromPercent(percent)),
      reset: DEFAULT_SPATIAL_SPREAD_AMOUNT,
    };
  }
  const { scale, min, max, step, value } = spreadAmountSlider('connected', amount);
  return {
    min,
    max,
    step,
    value,
    amountOf: (percent) => clampSpreadAmount('connected', percent / scale),
    reset: DEFAULT_CONNECTED_SPREAD.amount,
  };
}
