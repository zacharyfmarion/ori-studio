import { useMemo } from 'react';
import { PAPER_SHEET_MM_RANGE, type PaperSheetSize } from '../lib/paper/paperPage';
import type { Hex } from '../lib/paper/paperStyle';
import type { PaperExportSettings } from '../lib/paperExportSettings';
import { useSettingsStore } from '../store/settingsStore';

/**
 * The sheet size a user picks when they leave "as shown": a round number that
 * is the kind of sheet a diagram is drawn at, well inside the range.
 */
export const DEFAULT_PAPER_SHEET_MM = 150;

/** The page colour a transparent page turns into when the user asks for one. */
export const DEFAULT_PAPER_BACKGROUND: Hex = '#ffffff';

export interface PaperExportPageBinding {
  page: PaperExportSettings;
  /** `null` is a transparent page. */
  setBackground: (background: Hex | null) => void;
  setKeepHiddenFaces: (keep: boolean) => void;
  /** Switch between the sheet's on-screen size and a size in mm. */
  setSheetAsShown: (asShown: boolean) => void;
  setSheetMm: (mm: number) => void;
  setPaddingMm: (mm: number) => void;
  setPngDpi: (dpi: number) => void;
}

/** The sheet size in mm the size field shows: the chosen one, or the default while "as shown". */
export function sheetMmOf(sheet: PaperSheetSize): number {
  return sheet === 'as-shown' ? DEFAULT_PAPER_SHEET_MM : sheet.mm;
}

/**
 * The app-wide export page, bound to the settings store — Settings ▸ Paper's
 * "Export page" section and the Simulate pane's Export group share it, which
 * is the point: one page, two places to reach it, never two pages.
 * Preferences, not document edits: nothing here records undo.
 */
export function usePaperExportPage(): PaperExportPageBinding {
  const page = useSettingsStore((state) => state.paperExport);
  const setField = useSettingsStore((state) => state.setPaperExportField);
  return useMemo(
    () => ({
      page,
      setBackground: (background) => setField('background', background),
      setKeepHiddenFaces: (keep) => setField('keepHiddenFaces', keep),
      setSheetAsShown: (asShown) =>
        setField('sheet', asShown ? 'as-shown' : { mm: sheetMmOf(page.sheet) }),
      setSheetMm: (mm) =>
        setField('sheet', {
          mm: Math.min(PAPER_SHEET_MM_RANGE.max, Math.max(PAPER_SHEET_MM_RANGE.min, mm)),
        }),
      setPaddingMm: (mm) => setField('paddingMm', mm),
      setPngDpi: (dpi) => setField('pngDpi', dpi),
    }),
    [page, setField]
  );
}
