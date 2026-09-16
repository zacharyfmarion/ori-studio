import { formatPercent } from '../../lib/angleUnits';
import type { PropertySection, PropertySheet, ToggleField } from '../../lib/propertyDescriptors';
import {
  CP_CHECK_CLASSES,
  toggledCheckClasses,
  type CpCheckClass,
} from '../annotations/suppressionRegion';
import type { AnnotationPaneDeps } from '../annotations/useAnnotationPaneDeps';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import { cpCheckClassLabel } from '../diagnostics/checkSuppression';
import type { CpImage } from '../images/cpImage';

export interface RegionPropertyDeps extends AnnotationPaneDeps {
  /**
   * The reference image the region owns, resolved by the host from
   * `region.imageId` — a direct lookup, never a findings pass — or null for
   * a region that has none, in which case the sheet has no image section.
   */
  image: CpImage | null;
}

/**
 * The properties of a check-suppression region: how strongly it is drawn,
 * which checks it silences (one toggle per class, **tick = suppressed** — the
 * same reading the chip's checks menu gives), and its owned reference image's
 * visibility and opacity, when it has one. `hidden` is not-applicable: a
 * region cannot be hidden (`annotationCanHide`), it is deleted.
 *
 * Solve, Stop, Accept, Try again and the hidden-findings count stay on the
 * chip: the solve is a verb with a state machine behind it, and the count is
 * the chip's safety affordance. Remove image is a verb too; the chip's image
 * menu keeps it.
 */
export function buildRegionProperties(
  target: TargetOf<'suppressionRegion'>,
  deps: RegionPropertyDeps
): PropertySheet {
  const { t, image } = deps;
  const region = target.annotation;
  const changeChecks = t('panels:cpRegion.changeChecks', 'Change suppressed checks');
  const adjustOpacity = t('panels:imageInspector.adjustOpacity', 'Adjust opacity');
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

  const sections: PropertySection[] = [
    {
      id: 'region',
      title: t('panels:cpProperties.region.section', 'Region'),
      fields: [
        {
          id: 'opacity',
          kind: 'slider',
          label: t('panels:imageInspector.opacity', 'Opacity'),
          support: 'supported',
          undoLabel: adjustOpacity,
          min: 0,
          max: 1,
          step: 0.01,
          format: formatPercent,
          protocol: 'continuous',
          value: region.opacity,
          begin: () => deps.begin('opacity'),
          update: (opacity) => deps.update({ opacity }),
          end: () => deps.end(adjustOpacity),
          held: deps.held,
        },
        {
          id: 'hidden',
          kind: 'toggle',
          label: t('panels:cpProperties.region.hidden', 'Hidden'),
          // A region is never hidden, only deleted — see `annotationCanHide`.
          support: 'not-applicable',
          protocol: 'discrete',
          value: false,
          commit: () => {},
        },
      ],
    },
    {
      id: 'checks',
      title: t('panels:cpRegion.checksMenu', 'Suppressed checks'),
      fields: CP_CHECK_CLASSES.map(check),
    },
  ];

  if (image) {
    const imageVisibility = t('panels:cpRegion.imageVisibility', 'Show or hide reference image');
    const adjustImage = t('panels:cpRegion.imageAdjustOpacity', 'Adjust reference image');
    sections.push({
      id: 'image',
      title: t('panels:cpRegion.imageMenu', 'Reference image'),
      fields: [
        {
          id: 'imageShown',
          kind: 'toggle',
          label: t('panels:cpProperties.region.imageShown', 'Shown'),
          support: 'supported',
          undoLabel: imageVisibility,
          protocol: 'discrete',
          value: !image.hidden,
          commit: (shown) => deps.commitById(image.id, { hidden: !shown }, imageVisibility),
        },
        {
          id: 'imageOpacity',
          kind: 'slider',
          label: t('panels:imageInspector.opacity', 'Opacity'),
          support: 'supported',
          undoLabel: adjustImage,
          min: 0,
          max: 1,
          step: 0.01,
          format: formatPercent,
          protocol: 'continuous',
          value: image.opacity,
          begin: () => deps.begin('imageOpacity'),
          update: (opacity) => deps.updateById(image.id, { opacity }),
          end: () => deps.end(adjustImage),
          held: deps.held,
        },
      ],
    });
  }

  return {
    kind: 'suppressionRegion',
    targetId: region.id,
    title: region.label ?? t('panels:cpProperties.region.title', 'Suppression region'),
    icon: 'region',
    sections,
  };
}
