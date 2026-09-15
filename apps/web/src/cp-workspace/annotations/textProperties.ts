import type { PropertySheet } from '../../lib/propertyDescriptors';
import { formatPercent } from '../images/imageProperties';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import type { AnnotationPaneDeps } from './useAnnotationPaneDeps';

export type TextPropertyDeps = AnnotationPaneDeps;

/**
 * The properties of a text box the pane can edit without touching the
 * editor: opacity, through the annotation layer's bracket. Alignment, block
 * style, colour and size follow with the editor registry and the document
 * transforms (Phase E of the plan); per-selection marks stay on the editing
 * toolbar, and stacking and delete in the context menu.
 */
export function buildTextProperties(
  target: TargetOf<'text'>,
  deps: TextPropertyDeps
): PropertySheet {
  const { t } = deps;
  const text = target.annotation;
  const adjustOpacity = t('panels:imageInspector.adjustOpacity', 'Adjust opacity');
  return {
    kind: 'text',
    targetId: text.id,
    title: t('panels:cpProperties.text.title', 'Text'),
    icon: 'text',
    sections: [
      {
        id: 'text',
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
            value: text.opacity,
            begin: () => deps.begin('opacity'),
            update: (opacity) => deps.update({ opacity }),
            end: () => deps.end(adjustOpacity),
            held: deps.held,
          },
        ],
      },
    ],
  };
}
