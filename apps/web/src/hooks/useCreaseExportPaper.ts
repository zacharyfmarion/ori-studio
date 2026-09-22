import { useMemo } from 'react';
import type { CreaseExportPaperOptions } from '../lib/creaseExport';
import { exportPaperStyle } from '../lib/paperStyleSettings';
import { useSettingsStore } from '../store/settingsStore';

/**
 * How a crease-pattern export paints the folded figure beside the sheet: the
 * app's export style and the export page's "Keep hidden faces", read from the
 * settings store as the figure's own export reads them. The export dialog and
 * the share card both hand this to `buildCreaseExportArtwork`, so the figure on
 * either page is the figure the standalone export would paint, at the pens
 * and paper the user set.
 */
export function useCreaseExportPaper(): CreaseExportPaperOptions {
  const paperStyle = useSettingsStore((state) => state.paperStyle);
  const keepHiddenFaces = useSettingsStore((state) => state.paperExport.keepHiddenFaces);
  return useMemo(
    () => ({ style: exportPaperStyle(paperStyle), keepHiddenFaces }),
    [paperStyle, keepHiddenFaces]
  );
}
