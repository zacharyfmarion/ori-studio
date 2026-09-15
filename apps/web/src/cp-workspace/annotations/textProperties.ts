import { formatPercent } from '../../lib/angleUnits';
import { ORIEDITA_PAPER_MAX, ORIEDITA_PAPER_MIN } from '../../lib/creasePatternViewport';
import type { PropertySheet } from '../../lib/propertyDescriptors';
import { textAlignLabel, textBlockLabel, textColorLabel } from '../../i18n/enumLabels';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import { textDocSummary } from './textDocTransforms';
import {
  TEXT_ALIGNS,
  TEXT_BLOCK_PRESETS,
  TEXT_COLORS,
  type TextAlign,
  type TextBlockType,
  type TextColor,
} from './textFormatting';
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

export interface TextPropertyDeps extends AnnotationPaneDeps {
  /**
   * Whole-box document edits. Idle, each is a JSON transform on the stored
   * doc recorded as one entry; while the box is being edited, each drives the
   * live editor inside the session's own entry. The catalog does not know
   * which — see `useTextProperties`.
   */
  setAlign(align: TextAlign): void;
  setBlock(type: TextBlockType): void;
  setColor(color: TextColor): void;
}

/**
 * The properties of a text box: alignment, block preset and colour (whole-box
 * — the editing toolbar keeps the per-selection marks), the base font size
 * and the opacity. Alignment, block and colour read the stored document,
 * which the editor keeps current while it is open, and show the mixed state
 * (nothing chosen) where the blocks disagree.
 */
export function buildTextProperties(
  target: TargetOf<'text'>,
  deps: TextPropertyDeps
): PropertySheet {
  const { t } = deps;
  const text = target.annotation;
  const summary = textDocSummary(text.doc);
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
            id: 'align',
            kind: 'segmented',
            label: t('panels:textAnnotation.alignment', 'Alignment'),
            support: 'supported',
            undoLabel: t('panels:cpProperties.text.changeAlignment', 'Change text alignment'),
            options: TEXT_ALIGNS.map((align) => ({
              id: align,
              label: textAlignLabel(t, align),
              icon: `align-${align}`,
            })),
            protocol: 'discrete',
            value: summary.align,
            commit: (next) => {
              if (next !== null) deps.setAlign(next as TextAlign);
            },
          },
          {
            id: 'block',
            kind: 'select',
            label: t('panels:textAnnotation.textStyle', 'Text style'),
            support: 'supported',
            undoLabel: t('panels:cpProperties.text.changeStyle', 'Change text style'),
            options: TEXT_BLOCK_PRESETS.map((preset) => ({
              id: preset.value,
              label: textBlockLabel(t, preset.value),
            })),
            placeholder: t('panels:cpProperties.text.mixed', 'Mixed'),
            protocol: 'discrete',
            value: summary.block,
            commit: (next) => {
              if (next !== null) deps.setBlock(next as TextBlockType);
            },
          },
          {
            id: 'color',
            kind: 'select',
            label: t('panels:textAnnotation.color', 'Text color'),
            support: 'supported',
            undoLabel: t('panels:cpProperties.text.changeColor', 'Change text color'),
            // Radix cannot carry an empty-string value, and `null` is the
            // renderer's mixed state, so the default is named.
            options: TEXT_COLORS.map((color) => ({
              id: color || 'default',
              label: textColorLabel(t, color),
              ...(color ? { swatch: color } : {}),
            })),
            placeholder: t('panels:cpProperties.text.mixed', 'Mixed'),
            protocol: 'discrete',
            value: summary.color === null ? null : summary.color || 'default',
            commit: (next) => {
              if (next === null) return;
              const color = (next === 'default' ? '' : next) as TextColor;
              if ((TEXT_COLORS as readonly string[]).includes(color)) deps.setColor(color);
            },
          },
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
