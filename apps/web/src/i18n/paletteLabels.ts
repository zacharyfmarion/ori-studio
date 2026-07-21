import type { TFunction } from 'i18next';
import type { OristudioCpPaletteEntry } from '../lib/oristudioCpPalette';

/** Localized name for a crease-pattern line color, keyed by its stable palette id. */
export function cpPaletteLabel(t: TFunction, entry: OristudioCpPaletteEntry): string {
  switch (entry.id) {
    case 'mountain':
      return t('tools:paletteColor.mountain', 'Mountain');
    case 'valley':
      return t('tools:paletteColor.valley', 'Valley');
    case 'edge':
      return t('tools:paletteColor.edge', 'Edge');
    case 'unassigned':
      return t('tools:paletteColor.unassigned', 'Unassigned');
    case 'auxiliary':
      return t('tools:paletteColor.auxiliary', 'Auxiliary');
    case 'orange':
      return t('tools:paletteColor.orange', 'Orange');
    case 'magenta':
      return t('tools:paletteColor.magenta', 'Magenta');
    case 'green':
      return t('tools:paletteColor.green', 'Green');
    case 'yellow':
      return t('tools:paletteColor.yellow', 'Yellow');
    case 'purple':
      return t('tools:paletteColor.purple', 'Purple');
    case 'other':
      return t('tools:paletteColor.other', 'Other');
    default:
      return entry.label;
  }
}

/** Localized status-bar label for a line color (e.g. "Line M"), keyed by palette id. */
export function cpPaletteStatusLabel(t: TFunction, entry: OristudioCpPaletteEntry): string {
  switch (entry.id) {
    case 'mountain':
      return t('tools:paletteStatus.mountain', 'Line M');
    case 'valley':
      return t('tools:paletteStatus.valley', 'Line V');
    case 'edge':
      return t('tools:paletteStatus.edge', 'Line E');
    case 'unassigned':
      return t('tools:paletteStatus.unassigned', 'Line U');
    case 'auxiliary':
      return t('tools:paletteStatus.auxiliary', 'Line A');
    case 'orange':
      return t('tools:paletteStatus.orange', 'Line orange');
    case 'magenta':
      return t('tools:paletteStatus.magenta', 'Line magenta');
    case 'green':
      return t('tools:paletteStatus.green', 'Line green');
    case 'yellow':
      return t('tools:paletteStatus.yellow', 'Line yellow');
    case 'purple':
      return t('tools:paletteStatus.purple', 'Line purple');
    case 'other':
      return t('tools:paletteStatus.other', 'Line other');
    default:
      return entry.statusLabel;
  }
}
