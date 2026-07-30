import type { SvgRenderResult } from '@treemaker/origami-simulator';
import { svgToPng } from '../lib/creaseExport';
import { getFileService, type FileService } from '../platform/fileService';
import { exportFilename } from '../platform/exportFilename';

/**
 * Saving the simulator's current view to a file.
 *
 * The view itself is produced in the worker — see `simulatorSession.exportSvg`,
 * which is where the complete render state already lives. Nothing here knows
 * about geometry, cameras or palettes; it takes a rendered page and puts it on
 * disk, which is why it is a plain module rather than a hook and can be tested
 * without a browser.
 */

/** A view is an image, so these are the only two formats that make sense. */
export type SimulatorViewExportFormat = 'svg' | 'png';

/**
 * PNG oversampling. The SVG is measured in the viewport's device pixels, and a
 * diagram dropped into a document is usually looked at larger than the panel it
 * came from, so rasterizing at 1:1 gives a soft image at exactly the moment
 * somebody wanted the detail.
 */
const PNG_SCALE = 2;

export interface SaveSimulatorViewOptions {
  page: SvgRenderResult;
  format: SimulatorViewExportFormat;
  /** Base name, before sanitising and before the extension. */
  name: string;
  fileService?: FileService;
}

/** The saved file's name, or null when the user dismissed the save dialog. */
export async function saveSimulatorView({
  page,
  format,
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

  const bytes = await svgToPng(page.svg, page.width * PNG_SCALE, page.height * PNG_SCALE);
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
