import { DEFAULT_CONNECTED_SPREAD, DEFAULT_SPREAD_STARTS } from '../../cp-workspace/folded/layerSpreadSettings';

/** When enabled, Fold starts more compactly than Diagram: 7% on the shared 0–100% control. */
export const DEFAULT_FOLD_CONNECTED_SPREAD = { ...DEFAULT_CONNECTED_SPREAD, amount: 0.14 };
export const DEFAULT_FOLD_SPREAD_STARTS = {
  ...DEFAULT_SPREAD_STARTS,
  any: DEFAULT_FOLD_CONNECTED_SPREAD,
  connected: DEFAULT_FOLD_CONNECTED_SPREAD,
};
