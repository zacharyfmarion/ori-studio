import i18n from '../../i18n';
import { exportFilename } from '../../platform/exportFilename';
import { getFileService, type FileService } from '../../platform/fileService';
import type { DiagramDocument } from '../document/diagramDocument';
import { stepIndex } from '../document/diagramDocument';
import { paintAsset, stepPictureSource } from './paintDiagramStep';

/**
 * Export picture… (D7's round trip for hand edits): the step's picture alone,
 * with no number, instruction or annotations, in its pose.
 *
 * An SVG upload is written as SVG — as it is stored when upright — so it opens
 * in Inkscape as the user's own drawing, ready to edit and bring back with
 * Replace picture…. An upright bitmap is written as the bitmap it is stored
 * as; a posed one as an SVG that draws it posed, rather than re-encoding it.
 * Resolves the kind of file written, or null when nothing was.
 */
export async function exportStepPicture(
  document: DiagramDocument,
  stepId: string,
  fileService: FileService = getFileService()
): Promise<'svg' | 'png' | 'jpeg' | null> {
  const index = stepIndex(document, stepId);
  const source = index >= 0 ? stepPictureSource(document.steps[index], document.assets) : null;
  if (!source) return null;
  const t = i18n.t;
  const title = t('dialogs:diagram.exportPictureTitle', 'Export picture');
  const stem = `${document.title.trim() || 'Diagram'} step ${index + 1}`;
  const { asset, pose } = source;
  const upright = pose.rotationQuarterTurns === 0 && !pose.mirrored;
  if (asset.kind === 'raster' && upright) {
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
  const saved = await fileService.saveTextFile({
    title,
    contents: paintAsset(asset, pose).svg,
    suggestedName: exportFilename(stem, 'svg'),
    extensions: ['svg'],
  });
  return saved === null ? null : 'svg';
}
