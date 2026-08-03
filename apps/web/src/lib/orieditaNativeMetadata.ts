import type {
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureState,
  OristudioCpCustomLineType,
  OristudioCpLineColor,
  OristudioCpRgbColor,
} from '../engine/oristudioCpTypes';
import { cpActionByUpstreamMouseMode } from './oristudioCpActions';
import { toggledCpLineColor } from './oristudioCpPalette';

const DEFAULT_FOLDED_MODEL: OristudioCpFoldedFigureModel = {
  front_color: { red: 255, green: 255, blue: 50 },
  back_color: { red: 233, green: 233, blue: 233 },
  line_color: { red: 0, green: 0, blue: 0 },
  scale: 1,
  rotation: 0,
  anti_alias: true,
  display_shadows: false,
  state: 'Front0',
  folded_cases: 1,
  transparent_transparency: 16,
  transparency_color: false,
};

const ORI_FOLDED_MODEL_KEY = 'oriedita:ori:foldedFigureModel';
const ORI_CANVAS_MODEL_KEY = 'oriedita:ori:canvasModel';
const ORI_CAMERA_KEY = 'oriedita:ori:creasePatternCamera';
const ORH_FRONT_COLOR_KEY = 'oriedita:orh:oriagarizu_front_color';
const ORH_BACK_COLOR_KEY = 'oriedita:orh:oriagarizu_back_color';
const ORH_LINE_COLOR_KEY = 'oriedita:orh:oriagarizu_line_color';
const ORI_METADATA_PREFIX = 'oriedita:ori:';
const ORH_METADATA_PREFIX = 'oriedita:orh:';

const RESTORED_ORI_FIELDS = new Map<string, string>([['foldedFigureModel', 'Folded model']]);
const RESTORED_ORH_FIELDS = new Map<string, string>([
  ['oriagarizu_front_color', 'Folded colors'],
  ['oriagarizu_back_color', 'Folded colors'],
  ['oriagarizu_line_color', 'Folded colors'],
]);
const PRESERVED_ORI_FIELD_LABELS = new Map<string, string>([
  ['creasePatternCamera', 'Camera'],
  ['canvasModel', 'Canvas'],
  ['applicationModel', 'Application'],
]);

export interface OrieditaNativeMetadataStatus {
  restored: string[];
  preserved: string[];
}

export interface OrieditaCanvasToolOptions {
  customFromLineType?: OristudioCpCustomLineType;
  customToLineType?: OristudioCpCustomLineType;
  customLineType?: OristudioCpCustomLineType;
}

export function foldedFigureModelFromOrieditaMetadata(
  metadata: Record<string, unknown> | null | undefined
): OristudioCpFoldedFigureModel | null {
  if (!metadata) return null;
  const oriModel = recordValue(metadata[ORI_FOLDED_MODEL_KEY]);
  const orhFront = rgbArray(metadata[ORH_FRONT_COLOR_KEY]);
  const orhBack = rgbArray(metadata[ORH_BACK_COLOR_KEY]);
  const orhLine = rgbArray(metadata[ORH_LINE_COLOR_KEY]);

  if (!oriModel && !orhFront && !orhBack && !orhLine) return null;

  const view = savedCreasePatternView(metadata);

  return {
    front_color: argbHexColor(oriModel?.frontColor) ?? orhFront ?? DEFAULT_FOLDED_MODEL.front_color,
    back_color: argbHexColor(oriModel?.backColor) ?? orhBack ?? DEFAULT_FOLDED_MODEL.back_color,
    line_color: argbHexColor(oriModel?.lineColor) ?? orhLine ?? DEFAULT_FOLDED_MODEL.line_color,
    scale: (numberValue(oriModel?.scale) ?? DEFAULT_FOLDED_MODEL.scale) / view.zoom,
    rotation: (numberValue(oriModel?.rotation) ?? DEFAULT_FOLDED_MODEL.rotation) - view.angle,
    anti_alias: booleanValue(oriModel?.antiAlias) ?? DEFAULT_FOLDED_MODEL.anti_alias,
    display_shadows:
      booleanValue(oriModel?.displayShadows) ?? DEFAULT_FOLDED_MODEL.display_shadows,
    state: foldedState(oriModel?.state) ?? DEFAULT_FOLDED_MODEL.state,
    folded_cases: integerValue(oriModel?.foldedCases) ?? DEFAULT_FOLDED_MODEL.folded_cases,
    transparent_transparency:
      integerValue(oriModel?.transparentTransparency) ??
      DEFAULT_FOLDED_MODEL.transparent_transparency,
    transparency_color:
      booleanValue(oriModel?.transparencyColor) ?? DEFAULT_FOLDED_MODEL.transparency_color,
  };
}

export function activeLineColorFromOrieditaMetadata(
  metadata: Record<string, unknown> | null | undefined
): OristudioCpLineColor | null {
  const canvasModel = recordValue(metadata?.[ORI_CANVAS_MODEL_KEY]);
  const lineColor = lineColorValue(canvasModel?.lineColor);
  if (!lineColor) return null;
  return booleanValue(canvasModel?.toggleLineColor) ? toggledCpLineColor(lineColor) : lineColor;
}

export function activeMouseModeFromOrieditaMetadata(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const canvasModel = recordValue(metadata?.[ORI_CANVAS_MODEL_KEY]);
  const mouseMode = canvasModel?.mouseMode;
  if (typeof mouseMode !== 'string') return null;
  const trimmed = mouseMode.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function canvasToolOptionsFromOrieditaMetadata(
  metadata: Record<string, unknown> | null | undefined
): OrieditaCanvasToolOptions | null {
  const canvasModel = recordValue(metadata?.[ORI_CANVAS_MODEL_KEY]);
  if (!canvasModel) return null;
  const customFromLineType = customLineTypeValue(canvasModel.customFromLineType);
  const customToLineType = customLineTypeValue(canvasModel.customToLineType);
  const customLineType = customLineTypeValue(canvasModel.delLineType);
  if (!customFromLineType && !customToLineType && !customLineType) return null;
  return {
    ...(customFromLineType ? { customFromLineType } : {}),
    ...(customToLineType ? { customToLineType } : {}),
    ...(customLineType ? { customLineType } : {}),
  };
}

export function orieditaNativeMetadataStatus(
  metadata: Record<string, unknown> | null | undefined
): OrieditaNativeMetadataStatus | null {
  if (!metadata) return null;
  const restored = new Set<string>();
  const preserved = new Set<string>();

  for (const key of Object.keys(metadata)) {
    if (key.startsWith(ORI_METADATA_PREFIX)) {
      const field = key.slice(ORI_METADATA_PREFIX.length);
      const restoredLabel = RESTORED_ORI_FIELDS.get(field);
      if (restoredLabel) {
        restored.add(restoredLabel);
      } else if (field === 'canvasModel') {
        if (activeLineColorFromOrieditaMetadata(metadata)) restored.add('Canvas line color');
        const mouseMode = activeMouseModeFromOrieditaMetadata(metadata);
        if (mouseMode && cpActionByUpstreamMouseMode(mouseMode)) restored.add('Canvas tool');
        if (canvasToolOptionsFromOrieditaMetadata(metadata)) restored.add('Canvas line filters');
        preserved.add(PRESERVED_ORI_FIELD_LABELS.get(field) ?? field);
      } else {
        preserved.add(PRESERVED_ORI_FIELD_LABELS.get(field) ?? field);
      }
      continue;
    }

    if (key.startsWith(ORH_METADATA_PREFIX)) {
      const field = key.slice(ORH_METADATA_PREFIX.length);
      const restoredLabel = RESTORED_ORH_FIELDS.get(field);
      if (restoredLabel) {
        restored.add(restoredLabel);
      } else {
        preserved.add(field);
      }
    }
  }

  if (restored.size === 0 && preserved.size === 0) return null;
  return {
    restored: [...restored].sort(),
    preserved: [...preserved].sort(),
  };
}

/**
 * The zoom and angle a saved folded-figure `scale` / `rotation` are expressed
 * relative to.
 *
 * Oriedita seeds both from the *crease-pattern camera* every time you fold
 * (`FoldedFigure_Drawer.createTwoColorCreasePattern`:
 * `d_foldedFigure_scale_factor = camera_of_foldLine_diagram.getCameraZoomX()`),
 * and later zoom/rotate steps multiply that seed. So they are screen-space
 * quantities in the CP camera's units, not multiples of the paper: a saved
 * `scale` of 3.29 against a camera zoom of 1.64 means "twice the size of the
 * crease pattern", which is what its author saw.
 *
 * Ori Studio draws the crease pattern at 1x model scale — a saved camera is a
 * view, not geometry (see `cpModelToSvg`) — so the camera has to be divided back
 * out here or the figure lands 1.64x too big beside a pattern that did not grow
 * with it. Reading two scalars is not the same as restoring the camera as a
 * transform; do not grow this into one.
 *
 * A default or absent camera (zoom 1, angle 0) leaves both values untouched.
 */
function savedCreasePatternView(metadata: Record<string, unknown>): {
  zoom: number;
  angle: number;
} {
  const camera = recordValue(metadata[ORI_CAMERA_KEY]);
  const zoom = numberValue(camera?.cameraZoomX);
  const angle = numberValue(camera?.cameraAngle);
  return {
    // A zero or missing zoom would scale the figure to nothing or NaN it.
    zoom: zoom !== null && Math.abs(zoom) > 1e-12 ? Math.abs(zoom) : 1,
    angle: angle ?? 0,
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function argbHexColor(value: unknown): OristudioCpRgbColor | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/u, '');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/iu.test(hex)) return null;
  const rgb = hex.length === 8 ? hex.slice(2) : hex;
  return {
    red: Number.parseInt(rgb.slice(0, 2), 16),
    green: Number.parseInt(rgb.slice(2, 4), 16),
    blue: Number.parseInt(rgb.slice(4, 6), 16),
  };
}

function rgbArray(value: unknown): OristudioCpRgbColor | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [red, green, blue] = value.map((channel) =>
    typeof channel === 'number' && Number.isInteger(channel) && channel >= 0 && channel <= 255
      ? channel
      : null
  );
  if (red === null || green === null || blue === null) return null;
  return { red, green, blue };
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function integerValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function lineColorValue(value: unknown): OristudioCpLineColor | null {
  switch (value) {
    case 'ANGLE':
    case 'Angle':
      return 'Angle';
    case 'NONE':
    case 'None':
      return 'None';
    case 'BLACK_0':
    case 'Black0':
      return 'Black0';
    case 'RED_1':
    case 'Red1':
      return 'Red1';
    case 'BLUE_2':
    case 'Blue2':
      return 'Blue2';
    case 'CYAN_3':
    case 'Cyan3':
      return 'Cyan3';
    case 'ORANGE_4':
    case 'Orange4':
      return 'Orange4';
    case 'MAGENTA_5':
    case 'Magenta5':
      return 'Magenta5';
    case 'GREEN_6':
    case 'Green6':
      return 'Green6';
    case 'YELLOW_7':
    case 'Yellow7':
      return 'Yellow7';
    case 'PURPLE_8':
    case 'Purple8':
      return 'Purple8';
    case 'OTHER_9':
    case 'Other9':
      return 'Other9';
    case 'GREY_10':
    case 'Grey10':
      return 'Grey10';
    default:
      return null;
  }
}

function customLineTypeValue(value: unknown): OristudioCpCustomLineType | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    switch (value) {
      case -1:
        return 'Any';
      case 0:
        return 'Edge';
      case 1:
        return 'MountainAndValley';
      case 2:
        return 'Mountain';
      case 3:
        return 'Valley';
      case 4:
        return 'Aux';
      default:
        return null;
    }
  }

  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[-_\s]/gu, '').toUpperCase();
  switch (normalized) {
    case 'ANY':
      return 'Any';
    case 'EDGE':
      return 'Edge';
    case 'MANDV':
    case 'MOUNTAINANDVALLEY':
      return 'MountainAndValley';
    case 'MOUNTAIN':
      return 'Mountain';
    case 'VALLEY':
      return 'Valley';
    case 'AUX':
    case 'AUXILIARY':
      return 'Aux';
    default:
      return null;
  }
}

function foldedState(value: unknown): OristudioCpFoldedFigureState | null {
  switch (value) {
    case 'FRONT_0':
    case 'Front0':
      return 'Front0';
    case 'BACK_1':
    case 'Back1':
      return 'Back1';
    case 'BOTH_2':
    case 'Both2':
      return 'Both2';
    case 'TRANSPARENT_3':
    case 'Transparent3':
      return 'Transparent3';
    default:
      return null;
  }
}
