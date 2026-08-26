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

/**
 * The five that get a chip in the rail, **in the order they sit there**.
 *
 * Listed rather than filtered, because the rail order is decided here and a
 * filter would silently inherit whatever order the full palette happens to be
 * in. Unassigned is last on purpose: the first three are the crease types a
 * pattern is made of and the last two are the ones that are not creases yet, so
 * the divide reads left to right.
 */
const PRIMARY_LINE_COLOR_IDS = ['mountain', 'valley', 'edge', 'auxiliary', 'unassigned'] as const;

export const ORISTUDIO_CP_PRIMARY_LINE_COLOR_PALETTE = PRIMARY_LINE_COLOR_IDS.map((id) => {
  const entry = ORISTUDIO_CP_LINE_COLOR_PALETTE.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`unknown primary line colour: ${id}`);
  return entry;
});

export const ORISTUDIO_CP_EXTRA_LINE_COLOR_PALETTE = ORISTUDIO_CP_LINE_COLOR_PALETTE.filter(
  (entry) =>
    entry.id === 'orange' ||
    entry.id === 'magenta' ||
    entry.id === 'green' ||
    entry.id === 'yellow' ||
    entry.id === 'purple' ||
    entry.id === 'other'
);

export const ORISTUDIO_CP_LINE_COLOR_BY_COLOR = new Map(
  ORISTUDIO_CP_LINE_COLOR_PALETTE.map((entry) => [entry.lineColor, entry])
);

export function cpPaletteEntryForColor(
  lineColor: OristudioCpLineColor | string
): OristudioCpPaletteEntry | undefined {
  return ORISTUDIO_CP_LINE_COLOR_BY_COLOR.get(lineColor as OristudioCpLineColor);
}

/**
 * Swap a crease colour to its mountain/valley opposite, leaving every other
 * colour alone.
 *
 * Port of Oriedita's `LineColor.changeMV()`. Only Red (mountain) and Blue
 * (valley) move; Edge, Auxiliary, Unassigned and the extra palette colours all
 * return unchanged, which is what makes "invert while Control is held" a no-op
 * when a non-foldable line type is selected.
 *
 * Used both to restore a saved `toggleLineColor` from `.ori` metadata and to
 * derive the live inversion, so the two cannot drift.
 */
export function toggledCpLineColor(lineColor: OristudioCpLineColor): OristudioCpLineColor {
  switch (lineColor) {
    case 'Red1':
      return 'Blue2';
    case 'Blue2':
      return 'Red1';
    default:
      return lineColor;
  }
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
