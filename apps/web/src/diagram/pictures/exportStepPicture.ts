import i18n from '../../i18n';
import { exportFilename } from '../../platform/exportFilename';
import { getFileService, type FileService } from '../../platform/fileService';
import type { DiagramDocument } from '../document/diagramDocument';
import { stepById, stepNumber } from '../document/diagramDocument';
import { DEFAULT_PAPER_PAGE } from '../../lib/paper/paperPage';
import { paintSource, stepPictureSource } from './paintDiagramStep';

/**
 * Export picture… (D7's round trip for hand edits): the step's picture alone,
 * with no number, instruction or annotations, in its pose.
 *
 * An SVG upload is written as SVG — as it is stored when upright — so it opens
 * in Inkscape as the user's own drawing, ready to edit and bring back with
 * Replace picture…. An upright bitmap is written as the bitmap it is stored
 * as; a posed one as an SVG that draws it posed, rather than re-encoding it.
 * A captured picture is written in the diagram's pens, with the margin a
 * picture exported from Edit gets.
 * Resolves the kind of file written, or null when nothing was.
 */
export async function exportStepPicture(
  document: DiagramDocument,
  stepId: string,
  fileService: FileService = getFileService()
): Promise<'svg' | 'png' | 'jpeg' | null> {
  const step = stepById(document, stepId);
  const source = step ? stepPictureSource(step, document.assets) : null;
  if (!source) return null;
  const t = i18n.t;
  const title = t('dialogs:diagram.exportPictureTitle', 'Export picture');
  const stem = `${document.title.trim() || 'Diagram'} step ${stepNumber(document, stepId)}`;
  if (
    source.kind === 'asset' &&
    source.asset.kind === 'raster' &&
    source.pose.rotationQuarterTurns === 0 &&
    !source.pose.mirrored
  ) {
    const { asset } = source;
    const match = /^data:(image\/(png|jpeg));base64,(.*)$/.exec(asset.src);
    if (!match) return null;
    const extension = match[2] === 'jpeg' ? 'jpg' : 'png';
    const bytes = Uint8Array.from(atob(match[3]), (char) => char.charCodeAt(0));
    const saved = await fileService.saveBinaryFile({
      title,
      bytes,
      suggestedName: exportFilename(stem, extension),
      extensions: [extension],
      mimeType: match[1],
    });
    return saved === null ? null : match[2] === 'jpeg' ? 'jpeg' : 'png';
  }
  const painted = paintSource(source, document.style, DEFAULT_PAPER_PAGE.paddingMm);
  if (!painted) return null;
  const saved = await fileService.saveTextFile({
    title,
    contents: painted.svg,
    suggestedName: exportFilename(stem, 'svg'),
    extensions: ['svg'],
  });
  return saved === null ? null : 'svg';
}
