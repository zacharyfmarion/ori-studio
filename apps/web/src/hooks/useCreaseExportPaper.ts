import { useMemo } from 'react';
import type { CreaseExportFoldedFigureSettings, CreaseExportPaperOptions } from '../lib/creaseExport';
import type { PaperStyle } from '../lib/paper/paperStyle';
import { PAPER_EXPORT_STYLE_SLOT, type PaperExportStyleChoice } from '../lib/paperExportSettings';
import { paperPresetRows } from '../lib/paperPresetRows';
import { exportPaperStyle, type PaperStyleSettings } from '../lib/paperStyleSettings';
import { resolvePaperExportStyleChoice } from '../paperExport/paperExportSession';
import { useSettingsStore } from '../store/settingsStore';

/**
 * The style the folded figure beside a crease pattern is drawn in: the
 * Settings export slot, or the preset picked for it (X12). A preset that is
 * gone reads as the export slot, as the export dialog's picker reads it.
 */
export function creaseExportFigureStyle(
  settings: PaperStyleSettings,
  choice: PaperExportStyleChoice
): PaperStyle {
  const rows = paperPresetRows(settings.presets);
  const resolved = resolvePaperExportStyleChoice(choice, rows);
  const row = resolved === PAPER_EXPORT_STYLE_SLOT ? null : rows.find((entry) => entry.key === resolved);
  return row ? row.preset.style : exportPaperStyle(settings);
}

/**
 * The Front and Back a pick starts the figure's fields from: its paper colours
 * (E15), which the fields then pin over, as editing them always has.
 */
export function creaseExportFigureColours(
  style: PaperStyle
): Pick<CreaseExportFoldedFigureSettings, 'frontColor' | 'backColor'> {
  return { frontColor: style.paper.front, backColor: style.paper.back };
}

/**
 * The pick a crease-pattern export or share card opens on — the one last saved
 * or published with, while a preset still honours it — with the figure's
 * colours seeded from it. Read, not subscribed: a snapshot when the dialog opens.
 */
export function openingCreaseExportFigure(): {
  style: PaperExportStyleChoice;
  colours: Pick<CreaseExportFoldedFigureSettings, 'frontColor' | 'backColor'>;
} {
  const { paperStyle, creasePatternFoldedFigureStyle } = useSettingsStore.getState();
  const style = resolvePaperExportStyleChoice(
    creasePatternFoldedFigureStyle,
    paperPresetRows(paperStyle.presets)
  );
  return { style, colours: creaseExportFigureColours(creaseExportFigureStyle(paperStyle, style)) };
}

/**
 * How a crease-pattern export paints the folded figure beside the sheet: the
 * picked style, read from the settings store. The export dialog and the share
 * card both hand this to `buildCreaseExportArtwork`, so the figure on either
 * page is drawn in the style the user picked for it.
 */
export function useCreaseExportPaper(choice: PaperExportStyleChoice): CreaseExportPaperOptions {
  const paperStyle = useSettingsStore((state) => state.paperStyle);
  return useMemo(() => ({ style: creaseExportFigureStyle(paperStyle, choice) }), [paperStyle, choice]);
}
