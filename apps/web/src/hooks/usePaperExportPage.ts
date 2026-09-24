import { useMemo } from 'react';
import { PAPER_SHEET_MM_RANGE, sheetMmOf } from '../lib/paper/paperPage';
import type { Hex } from '../lib/paper/paperStyle';
import type { PaperExportSettings } from '../lib/paperExportSettings';
import { useSettingsStore } from '../store/settingsStore';

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

/**
 * The app-wide export page, bound to the settings store — Settings ▸ Paper's
 * "Export page" section and the Simulate pane's Export group share it, which
 * is the point: one page, never two. The export dialog writes the same value
 * when it saves a file (`rememberPaperExportOptions`), so an export from any
 * surface changes what those two show, until Phase 10 of the paper export
 * plan remembers options per kind and retires both editors.
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
