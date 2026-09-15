import { degreesToRadians, formatPercent, radiansToDegrees, wrapDegrees } from '../../lib/angleUnits';
import type { PropertySheet } from '../../lib/propertyDescriptors';
import type { AnnotationPaneDeps } from '../annotations/useAnnotationPaneDeps';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';

/**
 * What a reference image's sheet needs from its host — the annotation layer's
 * shared deps. React-free and store-free, so the catalog is tested with an
 * identity `t` and `vi.fn` deps the way `folded/foldedFigureActions.ts` is.
 */
export type ImagePropertyDeps = AnnotationPaneDeps;

/**
 * The properties of a reference image: opacity and rotation. The natural size
 * is the subtitle — context, not a field. `src` is immutable, the crop is the
 * overlay's own mode, and width/height/centre numerics wait on settled units;
 * stacking and delete are verbs on the floating toolbar.
 */
export function buildImageProperties(
  target: TargetOf<'image'>,
  deps: ImagePropertyDeps
): PropertySheet {
  const { t } = deps;
  const image = target.annotation;
  const adjustOpacity = t('panels:imageInspector.adjustOpacity', 'Adjust opacity');
  const rotate = t('panels:creasePattern.rotateAnnotation', 'Rotate annotation');
  return {
    kind: 'image',
    targetId: image.id,
    title: t('panels:cpProperties.image.title', 'Image'),
    subtitle: `${image.naturalWidth} × ${image.naturalHeight}`,
    icon: 'image',
    sections: [
      {
        id: 'image',
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
            value: image.opacity,
            begin: () => deps.begin('opacity'),
            update: (opacity) => deps.update({ opacity }),
            end: () => deps.end(adjustOpacity),
            held: deps.held,
          },
          {
            id: 'rotation',
            kind: 'number',
            label: t('panels:cpProperties.image.rotation', 'Rotation'),
            support: 'supported',
            undoLabel: rotate,
            step: 1,
            suffix: '°',
            normalize: wrapDegrees,
            protocol: 'draft',
            value: radiansToDegrees(image.rotation),
            commit: (degrees) => deps.commit({ rotation: degreesToRadians(degrees) }, rotate),
          },
        ],
      },
    ],
  };
}
