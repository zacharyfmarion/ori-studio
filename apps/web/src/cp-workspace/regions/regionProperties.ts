import type { PropertySheet, ToggleField } from '../../lib/propertyDescriptors';
import {
  CP_CHECK_CLASSES,
  toggledCheckClasses,
  type CpCheckClass,
} from '../annotations/suppressionRegion';
import type { AnnotationPaneDeps } from '../annotations/useAnnotationPaneDeps';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import { cpCheckClassLabel } from '../diagnostics/checkSuppression';

export type RegionPropertyDeps = AnnotationPaneDeps;

/**
 * The properties of a check-suppression region: which checks it silences,
 * one toggle per class, **tick = suppressed** — the same reading the chip's
 * checks menu gives. Opacity and the owned reference image follow in Phase F.
 * Solve, Stop, Accept and the hidden-findings count stay on the chip: the
 * solve is a verb with a state machine behind it, and the count is the chip's
 * safety affordance.
 */
export function buildRegionProperties(
  target: TargetOf<'suppressionRegion'>,
  deps: RegionPropertyDeps
): PropertySheet {
  const { t } = deps;
  const region = target.annotation;
  const changeChecks = t('panels:cpRegion.changeChecks', 'Change suppressed checks');
  const check = (cpCheckClass: CpCheckClass): ToggleField => ({
    id: `check:${cpCheckClass}`,
    kind: 'toggle',
    label: cpCheckClassLabel(t, cpCheckClass),
    support: 'supported',
    undoLabel: changeChecks,
    protocol: 'discrete',
    value: region.suppress.includes(cpCheckClass),
    commit: (next) => {
      if (next === region.suppress.includes(cpCheckClass)) return;
      deps.commit({ suppress: toggledCheckClasses(region.suppress, cpCheckClass) }, changeChecks);
    },
  });
  return {
    kind: 'suppressionRegion',
    targetId: region.id,
    title: region.label ?? t('panels:cpProperties.region.title', 'Suppression region'),
    icon: 'region',
    sections: [
      {
        id: 'checks',
        title: t('panels:cpRegion.checksMenu', 'Suppressed checks'),
        fields: CP_CHECK_CLASSES.map(check),
      },
    ],
  };
}
