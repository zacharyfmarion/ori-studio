/**
 * An OBJ's spread as the shared spread rows lay it out (`LayerSpreadRows`):
 * Spread layers, and while on, Default's Amount. Default is the one spread a
 * mesh can carry, so Spread by and the reveal pad are not offered: the 3D
 * preview turns the paper instead of shearing it.
 *
 * Plain descriptors over the dialog's draft (`usePaperObjSpread`): a drag of
 * Amount moves the draft, and the preview follows it as it moves.
 */
import type { TFunction } from 'i18next';
import type { ConnectedSpread } from '@oristudio/layer-spread';
import {
  layerSpreadControls,
  type LayerSpreadDrag,
  type LayerSpreadToggle,
} from '../cp-workspace/folded/layerSpreadControls';
import { clampSpreadAmount, DEFAULT_CONNECTED_SPREAD } from '../cp-workspace/folded/layerSpreadSettings';
import type { PaperObjSpreadBinding } from './usePaperObjSpread';

const nothing = () => {};

export function objSpreadRows(
  { value, set, preparation }: Pick<PaperObjSpreadBinding, 'value' | 'set' | 'preparation'>,
  t: TFunction
): { toggle: LayerSpreadToggle; spread: LayerSpreadDrag | null } {
  // A spread that cannot be made says why under the switch, which turns it off but not on.
  const failed = preparation.status === 'failed' ? preparation.message : undefined;
  const toggle: LayerSpreadToggle = {
    pressed: value.on,
    disabled: failed !== undefined && !value.on,
    ...(failed !== undefined ? { note: failed, hint: failed } : {}),
    run: () => {
      if (value.on || failed === undefined) set({ ...value, on: !value.on });
    },
  };
  if (!value.on) return { toggle, spread: null };
  const shown: ConnectedSpread = { ...DEFAULT_CONNECTED_SPREAD, amount: value.amount, reveal: [0, 0] };
  return {
    toggle,
    spread: {
      ...layerSpreadControls(shown, { hint: undefined, busy: false, t, kind: nothing, direction: nothing, keep: nothing }),
      preview: (slider, amount) => {
        if (slider === 'amount') set({ on: true, amount: clampSpreadAmount('connected', amount) });
      },
      previewReveal: nothing,
      commit: nothing,
      start: () => true,
    },
  };
}
