/**
 * Writing the page the preview showed, and what the analytics hear about it.
 *
 * One path for every surface: the SVG string the dialog painted goes out as it
 * is, and a PNG is that same string rasterised at the chosen density, so the
 * file is the preview (X2). Nothing is rebuilt here.
 */
import type { PaperExportedEvent, PaperExportSurface } from '../analytics';
import { paperSvgToPng } from '../lib/paper/paperPng';
import type { PaperSvgResult } from '../lib/paper/paperSvg';
import {
  PAPER_EXPORT_STYLE_SLOT,
  type PaperExportFormat,
  type PaperExportSettings,
  type PaperExportStyleChoice,
} from '../lib/paperExportSettings';
import type { PaperPresetRow } from '../lib/paperPresetRows';
import { exportFilename } from '../platform/exportFilename';
import { getFileService, type FileService } from '../platform/fileService';

export interface SavePaperExportOptions {
  page: PaperSvgResult;
  format: PaperExportFormat;
  /** The density a PNG rasterises at; the page is in points, so this alone sets its pixel size. */
  pngDpi: number;
  /** Base name, before sanitising and before the extension. */
  fileStem: string;
  fileService?: FileService;
  /**
   * Aborted when the dialog is gone: a PNG still encoding is then not offered
   * to the save dialog at all.
   */
  signal?: AbortSignal;
}

/** The saved file's name, or null when the save dialog was dismissed or the save aborted. */
export async function savePaperExport({
  page,
  format,
  pngDpi,
  fileStem,
  fileService = getFileService(),
  signal,
}: SavePaperExportOptions): Promise<string | null> {
  if (format === 'svg') {
    const result = await fileService.saveTextFile({
      title: 'Export SVG',
      contents: page.svg,
      suggestedName: exportFilename(fileStem, 'svg'),
      path: null,
      extensions: ['svg'],
    });
    return result?.name ?? null;
  }
  const bytes = await paperSvgToPng(page, pngDpi);
  if (signal?.aborted) return null;
  const result = await fileService.saveBinaryFile({
    title: 'Export PNG',
    bytes,
    suggestedName: exportFilename(fileStem, 'png'),
    path: null,
    extensions: ['png'],
    mimeType: 'image/png',
  });
  return result?.name ?? null;
}

/**
 * The `paper exported` event for a save: which style, sheet and background, as
 * enums. `changed` is whether anything was touched in the dialog before saving.
 */
export function paperExportedEvent(
  surface: PaperExportSurface,
  options: PaperExportSettings,
  details: {
    keepsHiddenFaces: boolean;
    style: PaperExportStyleChoice;
    rows: readonly PaperPresetRow[];
    changed: boolean;
  }
): PaperExportedEvent {
  const row =
    details.style === PAPER_EXPORT_STYLE_SLOT
      ? null
      : (details.rows.find((entry) => entry.key === details.style) ?? null);
  return {
    surface,
    format: options.format,
    hiddenFaces: details.keepsHiddenFaces ? 'kept' : 'dropped',
    style: row === null ? 'export-style' : (row.builtIn ?? 'custom'),
    sheet: options.sheet === 'as-shown' ? 'as-shown' : 'custom',
    background: options.background === null ? 'transparent' : 'colour',
    pngDpi: options.pngDpi,
    optionsChanged: details.changed,
  };
}
