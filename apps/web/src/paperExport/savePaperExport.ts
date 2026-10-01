/**
 * Writing the page the preview showed, and what the analytics hear about it.
 *
 * One path for every surface: the SVG string the dialog painted goes out as it
 * is, and a PNG is that same string rasterised at the chosen density, so the
 * file is the preview (X2). Nothing is rebuilt here.
 */
import type { PaperExportedEvent, PaperExportScope, PaperExportSurface } from '../analytics';
import type { PaperExportMarkShown } from '../analytics/events';
import { paperSvgToPng } from '../lib/paper/paperPng';
import type { PaperSvgResult } from '../lib/paper/paperSvg';
import type {
  PaperExportFormat,
  PaperExportMark,
  PaperExportSettings,
  PaperExportStyleChoice,
} from '../lib/paperExportSettings';
import { paperStyleChoiceName, type PaperPresetRow } from '../lib/paperPresetRows';
import { exportFilename } from '../platform/exportFilename';
import { getFileService, type FileService } from '../platform/fileService';
import { zipPages, type ZipEntry } from './zipPages';

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

export interface SavePaperExportZipOptions {
  /** Every page, painted, with its file's stem inside the archive. */
  pages: readonly { page: PaperSvgResult; fileStem: string }[];
  format: PaperExportFormat;
  pngDpi: number;
  /** The archive's name, before sanitising and before the extension. */
  zipStem: string;
  fileService?: FileService;
  /** Aborted to stop: checked before each page, and before the save dialog. */
  signal?: AbortSignal;
  /** Called as each page is ready: `done` of `total`. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Every page as one ZIP: each SVG as painted, or rasterised at the density,
 * named from its stem. Nothing is saved unless every page is ready — an abort
 * between pages answers null without offering a save dialog.
 */
export async function savePaperExportZip({
  pages,
  format,
  pngDpi,
  zipStem,
  fileService = getFileService(),
  signal,
  onProgress,
}: SavePaperExportZipOptions): Promise<string | null> {
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [];
  for (const [index, { page, fileStem }] of pages.entries()) {
    if (signal?.aborted) return null;
    entries.push({
      name: exportFilename(fileStem, format),
      data: format === 'svg' ? encoder.encode(page.svg) : await paperSvgToPng(page, pngDpi),
      compress: format === 'svg',
    });
    onProgress?.(index + 1, pages.length);
  }
  const bytes = await zipPages(entries);
  if (signal?.aborted) return null;
  const result = await fileService.saveBinaryFile({
    title: 'Export ZIP',
    bytes,
    suggestedName: exportFilename(zipStem, 'zip'),
    path: null,
    extensions: ['zip'],
    mimeType: 'application/zip',
  });
  return result?.name ?? null;
}

/**
 * The `paper exported` event for a save: which style and background, as
 * enums. `changed` is whether anything was touched in the dialog before saving.
 * `marks` are the ones the target offered (`PaperExportTarget.marks`): only
 * those are reported, since a picture without letters has none to hide.
 */
export function paperExportedEvent(
  surface: PaperExportSurface,
  options: PaperExportSettings,
  details: {
    keepsHiddenFaces: boolean;
    style: PaperExportStyleChoice;
    rows: readonly PaperPresetRow[];
    changed: boolean;
    scope: PaperExportScope;
    pageCount: number;
    marks: readonly PaperExportMark[];
  }
): PaperExportedEvent {
  const shown = (mark: PaperExportMark): PaperExportMarkShown =>
    options.marks[mark] ? 'shown' : 'hidden';
  return {
    surface,
    format: options.format,
    hiddenFaces: details.keepsHiddenFaces ? 'kept' : 'dropped',
    style: paperStyleChoiceName(details.style, details.rows),
    background: options.background === null ? 'transparent' : 'colour',
    pngDpi: options.pngDpi,
    optionsChanged: details.changed,
    scope: details.scope,
    pageCount: details.pageCount,
    ...(details.marks.includes('letters') ? { letters: shown('letters') } : {}),
    ...(details.marks.includes('highlights') ? { highlights: shown('highlights') } : {}),
  };
}
