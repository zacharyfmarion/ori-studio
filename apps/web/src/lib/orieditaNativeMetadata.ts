import type {
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureState,
  OristudioCpRgbColor,
} from '../engine/oristudioCpTypes';

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

export function foldedFigureModelFromOrieditaMetadata(
  metadata: Record<string, unknown> | null | undefined
): OristudioCpFoldedFigureModel | null {
  if (!metadata) return null;
  const oriModel = recordValue(metadata[ORI_FOLDED_MODEL_KEY]);
  const orhFront = rgbArray(metadata[ORH_FRONT_COLOR_KEY]);
  const orhBack = rgbArray(metadata[ORH_BACK_COLOR_KEY]);
  const orhLine = rgbArray(metadata[ORH_LINE_COLOR_KEY]);

  if (!oriModel && !orhFront && !orhBack && !orhLine) return null;

  return {
    front_color: argbHexColor(oriModel?.frontColor) ?? orhFront ?? DEFAULT_FOLDED_MODEL.front_color,
    back_color: argbHexColor(oriModel?.backColor) ?? orhBack ?? DEFAULT_FOLDED_MODEL.back_color,
    line_color: argbHexColor(oriModel?.lineColor) ?? orhLine ?? DEFAULT_FOLDED_MODEL.line_color,
    scale: numberValue(oriModel?.scale) ?? DEFAULT_FOLDED_MODEL.scale,
    rotation: numberValue(oriModel?.rotation) ?? DEFAULT_FOLDED_MODEL.rotation,
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
