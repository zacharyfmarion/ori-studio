import { paperSvgToPng } from '../lib/paper/paperPng';
import type { PaperSvgResult } from '../lib/paper/paperSvg';
import { getFileService, type FileService } from '../platform/fileService';
import { exportFilename } from '../platform/exportFilename';

/**
 * Saving the simulator's current view to a file.
 *
 * The view itself is produced in the worker — see `simulatorSession.exportSvg`,
 * which is where the complete render state already lives — and painted onto a
 * page in points by the shared painter. Nothing here knows about geometry,
 * cameras or styles; it takes a painted page and puts it on disk, which is why
 * it is a plain module rather than a hook and can be tested without a browser.
 */

/** A view is an image, so these are the only two formats that make sense. */
export type SimulatorViewExportFormat = 'svg' | 'png';

export interface SaveSimulatorViewOptions {
  page: PaperSvgResult;
  format: SimulatorViewExportFormat;
  /** The density a PNG rasterises at; the page is in points, so this alone sets its pixel size. */
  pngDpi?: number;
  /** Base name, before sanitising and before the extension. */
  name: string;
  fileService?: FileService;
}

/** The saved file's name, or null when the user dismissed the save dialog. */
export async function saveSimulatorView({
  page,
  format,
  pngDpi,
  name,
  fileService = getFileService(),
}: SaveSimulatorViewOptions): Promise<string | null> {
  if (format === 'svg') {
    const result = await fileService.saveTextFile({
      title: 'Export View SVG',
      contents: page.svg,
      suggestedName: exportFilename(name, 'svg'),
      path: null,
      extensions: ['svg'],
    });
    return result?.name ?? null;
  }

  const bytes = await paperSvgToPng(page, pngDpi);
  const result = await fileService.saveBinaryFile({
    title: 'Export View PNG',
    bytes,
    suggestedName: exportFilename(name, 'png'),
    path: null,
    extensions: ['png'],
    mimeType: 'image/png',
  });
  return result?.name ?? null;
}
