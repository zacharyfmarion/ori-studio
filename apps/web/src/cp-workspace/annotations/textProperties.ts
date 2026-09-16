import { formatPercent } from '../../lib/angleUnits';
import { ORIEDITA_PAPER_MAX, ORIEDITA_PAPER_MIN } from '../../lib/creasePatternViewport';
import type { PropertySheet } from '../../lib/propertyDescriptors';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import type { AnnotationPaneDeps } from './useAnnotationPaneDeps';

/**
 * A box's font size is stored in model units, where the sheet is
 * `ORIEDITA_PAPER_MAX − ORIEDITA_PAPER_MIN` across. The row shows it as a
 * percentage of that edge — the one unit a size keeps meaning at every zoom
 * and on every export.
 */
const PAPER_EDGE = ORIEDITA_PAPER_MAX - ORIEDITA_PAPER_MIN;

export function fontSizeToPercent(fontSize: number): number {
  return Math.round((fontSize / PAPER_EDGE) * 100 * 100) / 100;
}

export function percentToFontSize(percent: number): number {
  return (Math.max(0.1, percent) / 100) * PAPER_EDGE;
}

export type TextPropertyDeps = AnnotationPaneDeps;

/**
 * The properties of a text box: the base font size and the opacity — what
 * belongs to the *box*. Its content's formatting (block preset, marks,
 * alignment, colour) follows the caret on the editing toolbar and is not a
 * property of the object; a whole-box change is a select-all there. See
 * Decision 12 in the plan.
 */
export function buildTextProperties(
  target: TargetOf<'text'>,
  deps: TextPropertyDeps
): PropertySheet {
  const { t } = deps;
  const text = target.annotation;
  const adjustOpacity = t('panels:imageInspector.adjustOpacity', 'Adjust opacity');
  const changeSize = t('panels:cpProperties.text.changeSize', 'Change text size');
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
            id: 'fontSize',
            kind: 'number',
            label: t('panels:cpProperties.text.size', 'Size'),
            support: 'supported',
            undoLabel: changeSize,
            min: 0.1,
            step: 0.5,
            suffix: '%',
            normalize: (percent) => Math.max(0.1, percent),
            protocol: 'draft',
            value: fontSizeToPercent(text.fontSize),
            commit: (percent) => deps.commit({ fontSize: percentToFontSize(percent) }, changeSize),
          },
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
