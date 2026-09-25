import type { TFunction } from 'i18next';
import type {
  OristudioCpFoldAngleDisplay,
  OristudioCpLineStyle,
} from '../lib/creasePatternViewport';
import type {
  OristudioCpDivideMode,
  OristudioCpLengthenColorMode,
} from '../lib/oristudioCpToolSettings';
import type { DashPresetId } from '../lib/paper/paperDashPresets';
import type { BuiltInPaperPresetId } from '../lib/paper/paperPresets';
import type { PaperStyleField, PenCap } from '../lib/paper/paperStyle';
import type { SimulatorColorMode } from '../lib/simulatorSettings';
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


/** A built-in paper preset by its id; a user's preset shows its own name instead. */
export function paperPresetLabel(t: TFunction, id: BuiltInPaperPresetId): string {
  switch (id) {
    case 'default':
      return t('dialogs:settings.paper.preset.default', 'Default');
    case 'diagram':
      return t('dialogs:settings.paper.preset.diagram', 'Diagram');
  }
}

/** The pen a paper-style field holds, as Settings ▸ Paper names its row. */
export function paperPenLabel(
  t: TFunction,
  field: Extract<PaperStyleField, 'edges' | 'mountainFolds' | 'valleyFolds' | 'auxCreases.pen' | 'arrows'>
): string {
  switch (field) {
    case 'edges':
      return t('dialogs:settings.paper.pen.edges', 'Edges');
    case 'mountainFolds':
      return t('dialogs:settings.paper.pen.mountainFolds', 'Mountain folds');
    case 'valleyFolds':
      return t('dialogs:settings.paper.pen.valleyFolds', 'Valley folds');
    case 'auxCreases.pen':
      return t('dialogs:settings.paper.pen.auxCreases', 'Auxiliary creases');
    case 'arrows':
      return t('dialogs:settings.paper.pen.arrows', 'Arrows');
  }
}

/**
 * A paper-style field as a list of an object's own pins names it — "Keeps its
 * own front colour and light" — so each is a fragment, not a heading.
 */
export function paperStyleFieldLabel(t: TFunction, field: PaperStyleField): string {
  switch (field) {
    case 'paper.front':
      return t('dialogs:paperExport.pin.paperFront', 'front colour');
    case 'paper.back':
      return t('dialogs:paperExport.pin.paperBack', 'back colour');
    case 'edges':
      return t('dialogs:paperExport.pin.edges', 'edge pen');
    case 'mountainFolds':
      return t('dialogs:paperExport.pin.mountainFolds', 'mountain fold pen');
    case 'valleyFolds':
      return t('dialogs:paperExport.pin.valleyFolds', 'valley fold pen');
    case 'foldsAsEdges':
      return t('dialogs:paperExport.pin.foldsAsEdges', 'creases drawn as edges');
    case 'auxCreases.visible':
      return t('dialogs:paperExport.pin.auxVisible', 'auxiliary creases shown or hidden');
    case 'auxCreases.pen':
      return t('dialogs:paperExport.pin.auxPen', 'auxiliary crease pen');
    case 'arrows':
      return t('dialogs:paperExport.pin.arrows', 'arrow pen');
    case 'erode':
      return t('dialogs:paperExport.pin.erode', 'erode');
    case 'light':
      return t('dialogs:paperExport.pin.light', 'light');
  }
}

/** A named dash, as the pen card's dash menu lists it. */
export function dashPresetLabel(t: TFunction, id: DashPresetId): string {
  switch (id) {
    case 'solid':
      return t('dialogs:settings.paper.dash.solid', 'Solid');
    case 'dashed':
      return t('dialogs:settings.paper.dash.dashed', 'Dashed');
    case 'dashDot':
      return t('dialogs:settings.paper.dash.dashDot', 'Dash-dot');
    case 'dotted':
      return t('dialogs:settings.paper.dash.dotted', 'Dotted');
    case 'longDash':
      return t('dialogs:settings.paper.dash.longDash', 'Long dash');
    case 'fineDash':
      return t('dialogs:settings.paper.dash.fineDash', 'Fine dash');
  }
}

/** A pen's line cap, in the words a drawing program uses. */
export function penCapLabel(t: TFunction, cap: PenCap): string {
  return cap === 'round'
    ? t('dialogs:settings.paper.cap.round', 'Round')
    : t('dialogs:settings.paper.cap.butt', 'Flat');
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
