import type { TFunction } from 'i18next';
import type { ContextMenuItem } from '../../components/ui/contextMenuTypes';
import {
  CP_CHECK_CLASSES,
  type CpCheckClass,
  type CpSuppressionRegion,
} from '../annotations/suppressionRegion';
import { cpCheckClassLabel } from '../diagnostics/checkSuppression';

export interface RegionMenuDeps {
  t: TFunction;
  toggleCheckClass(cpCheckClass: CpCheckClass): void;
  remove(): void;
}

/**
 * A suppression region's context menu: the chip bar's verbs, minus the solve.
 * The body is inert to the overlay — what is under a region is the crease
 * pattern — so the chip is where a right-click reaches it. Solve, Stop and
 * Accept stay on the chip alone: a state machine behind a verb is not a row.
 * React-free and store-free, like the other row catalogs.
 */
export function cpRegionMenuItems(region: CpSuppressionRegion, deps: RegionMenuDeps): ContextMenuItem[] {
  const { t } = deps;
  return [
    {
      kind: 'submenu',
      id: 'region-checks',
      label: t('panels:cpRegion.checksMenu', 'Suppressed checks'),
      items: CP_CHECK_CLASSES.map((cpCheckClass) => ({
        kind: 'radio',
        id: `region-check-${cpCheckClass}`,
        label: cpCheckClassLabel(t, cpCheckClass),
        checked: region.suppress.includes(cpCheckClass),
        onSelect: () => deps.toggleCheckClass(cpCheckClass),
      })),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      id: 'region-delete',
      label: t('panels:cpRegion.delete', 'Delete region'),
      danger: true,
      onSelect: deps.remove,
    },
  ];
}
