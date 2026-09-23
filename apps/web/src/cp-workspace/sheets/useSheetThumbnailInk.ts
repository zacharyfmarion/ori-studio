import { useMemo } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { sheetThumbnailInk, type SheetThumbnailInk } from './sheetThumbnailInk';

/**
 * {@link sheetThumbnailInk} for the display style, live: a rail reads it
 * itself, as a step card reads its pens, so a change in Settings ▸ Paper
 * redraws every card. `showAux` as there: null follows the style.
 */
export function useSheetThumbnailInk(showAux: boolean | null = null): SheetThumbnailInk {
  const display = useSettingsStore((state) => state.paperStyle.display);
  return useMemo(() => sheetThumbnailInk(display, showAux), [display, showAux]);
}
