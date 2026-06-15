import type { OristudioCpLineColor } from '../engine/oristudioCpTypes';

export interface OristudioCpPaletteEntry {
  id: string;
  label: string;
  shortLabel: string;
  lineColor: OristudioCpLineColor;
  cssClass: string;
  statusLabel: string;
  semantic: boolean;
}

export const ORISTUDIO_CP_LINE_COLOR_PALETTE = [
  paletteEntry('mountain', 'Mountain', 'M', 'Red1', 'mountain', 'Line M', true),
  paletteEntry('valley', 'Valley', 'V', 'Blue2', 'valley', 'Line V', true),
  paletteEntry('edge', 'Edge', 'E', 'Black0', 'border', 'Line E', true),
  paletteEntry('unassigned', 'Unassigned', 'U', 'None', 'unassigned', 'Line U', true),
  paletteEntry('auxiliary', 'Auxiliary', 'A', 'Cyan3', 'flat', 'Line A', false),
  paletteEntry('orange', 'Orange', 'O', 'Orange4', 'orange', 'Line orange', false),
  paletteEntry('magenta', 'Magenta', 'P', 'Magenta5', 'magenta', 'Line magenta', false),
  paletteEntry('green', 'Green', 'G', 'Green6', 'green', 'Line green', false),
  paletteEntry('yellow', 'Yellow', 'Y', 'Yellow7', 'yellow', 'Line yellow', false),
  paletteEntry('purple', 'Purple', 'R', 'Purple8', 'purple', 'Line purple', false),
  paletteEntry('other', 'Other', 'X', 'Other9', 'other', 'Line other', false),
] as const satisfies readonly OristudioCpPaletteEntry[];

export const ORISTUDIO_CP_LINE_COLOR_BY_COLOR = new Map(
  ORISTUDIO_CP_LINE_COLOR_PALETTE.map((entry) => [entry.lineColor, entry])
);

export function cpPaletteEntryForColor(
  lineColor: OristudioCpLineColor | string
): OristudioCpPaletteEntry | undefined {
  return ORISTUDIO_CP_LINE_COLOR_BY_COLOR.get(lineColor as OristudioCpLineColor);
}

function paletteEntry(
  id: string,
  label: string,
  shortLabel: string,
  lineColor: OristudioCpLineColor,
  cssClass: string,
  statusLabel: string,
  semantic: boolean
): OristudioCpPaletteEntry {
  return {
    id,
    label,
    shortLabel,
    lineColor,
    cssClass,
    statusLabel,
    semantic,
  };
}
