import type { TFunction } from 'i18next';
import type {
  OristudioCpFoldAngleDisplay,
  OristudioCpLineStyle,
} from '../lib/creasePatternViewport';
import type {
  OristudioCpDivideMode,
  OristudioCpLengthenColorMode,
} from '../lib/oristudioCpToolSettings';
import type { SimulatorColorMode, SimulatorCreaseStyle } from '../lib/simulatorSettings';
import type { TextAlign, TextBlockType, TextColor } from '../cp-workspace/annotations/textFormatting';

/**
 * Render-time translations for small fixed enums whose English labels live in data modules.
 * Each helper uses literal `t()` keys (so they extract) with the data English as the
 * fallback, keyed by the stable enum value.
 */

export function cpLineStyleLabel(t: TFunction, style: OristudioCpLineStyle): string {
  switch (style) {
    case 'color':
      return t('tools:lineStyle.color', 'Color');
    case 'black-white':
      return t('tools:lineStyle.blackWhite', 'Black & white');
    case 'color-and-shape':
      return t('tools:lineStyle.colorAndShape', 'Color + shape');
    case 'black-one-dot':
      return t('tools:lineStyle.blackOneDot', 'Black one-dot');
    case 'black-two-dot':
      return t('tools:lineStyle.blackTwoDot', 'Black two-dot');
    default:
      return style;
  }
}

export function cpLengthenColorModeLabel(
  t: TFunction,
  mode: OristudioCpLengthenColorMode
): string {
  return mode === 'same'
    ? t('tools:lengthenColorMode.same', 'Same')
    : t('tools:lengthenColorMode.active', 'Active');
}

export function cpLengthenColorModeTitle(
  t: TFunction,
  mode: OristudioCpLengthenColorMode
): string {
  return mode === 'same'
    ? t('tools:lengthenColorMode.sameTitle', 'Extend each crease in its own line type')
    : t('tools:lengthenColorMode.activeTitle', 'Extend in the active line type');
}

export function cpDivideModeLabel(t: TFunction, mode: OristudioCpDivideMode): string {
  return mode === 'ratio'
    ? t('tools:divideMode.ratio', 'Ratio')
    : t('tools:divideMode.count', 'Count');
}

export function cpDivideModeTitle(t: TFunction, mode: OristudioCpDivideMode): string {
  return mode === 'ratio'
    ? t('tools:divideMode.ratioTitle', 'Divide the line at a ratio')
    : t('tools:divideMode.countTitle', 'Divide the line into equal parts');
}

export function cpFoldAngleDisplayLabel(
  t: TFunction,
  display: OristudioCpFoldAngleDisplay
): string {
  switch (display) {
    case 'color':
      return t('tools:foldAngleDisplay.color', 'Color');
    case 'opacity':
      return t('tools:foldAngleDisplay.opacity', 'Opacity');
    default:
      return display;
  }
}


/** How the simulator colours the paper — the Simulate pane and the inline window's sheet share it. */
export function simulatorColorModeLabel(t: TFunction, mode: SimulatorColorMode): string {
  return mode === 'strain'
    ? t('panels:simulatorViewControls.colorStrain', 'Strain')
    : t('panels:simulatorViewControls.colorPaper', 'Paper');
}

export function simulatorCreaseStyleLabel(t: TFunction, style: SimulatorCreaseStyle): string {
  switch (style) {
    case 'color':
      return t('panels:simulatorViewControls.creaseStyleColor', 'Mountain / valley');
    case 'mono':
      return t('panels:simulatorViewControls.creaseStyleMono', 'One ink');
    case 'mono-dashed':
      return t('panels:simulatorViewControls.creaseStyleMonoDashed', 'One ink, dashed');
  }
}

/** A text box's block preset — the editing toolbar's select and the Properties pane share it. */
export function textBlockLabel(t: TFunction, type: TextBlockType): string {
  switch (type) {
    case 'paragraph':
      return t('panels:textAnnotation.blockBody', 'Body');
    case 'h1':
      return t('panels:textAnnotation.blockHeading', 'Heading');
    case 'h2':
      return t('panels:textAnnotation.blockSubheading', 'Subheading');
  }
}

export function textAlignLabel(t: TFunction, align: TextAlign): string {
  switch (align) {
    case 'left':
      return t('panels:textAnnotation.alignLeft', 'Align left');
    case 'center':
      return t('panels:textAnnotation.alignCenter', 'Align center');
    case 'right':
      return t('panels:textAnnotation.alignRight', 'Align right');
  }
}

/** One of the six text colours by name — `''` is the default. */
export function textColorLabel(t: TFunction, color: TextColor): string {
  switch (color) {
    case '':
      return t('panels:textAnnotation.colorDefault', 'Default');
    case '#e5484d':
      return t('panels:textAnnotation.colorRed', 'Red');
    case '#f5a623':
      return t('panels:textAnnotation.colorOrange', 'Orange');
    case '#30a46c':
      return t('panels:textAnnotation.colorGreen', 'Green');
    case '#4c9aff':
      return t('panels:textAnnotation.colorBlue', 'Blue');
    case '#8e4ec6':
      return t('panels:textAnnotation.colorPurple', 'Purple');
  }
}
