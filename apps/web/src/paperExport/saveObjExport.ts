import type { TFunction } from 'i18next';
import type { FoldedObjUnavailableReason } from '../lib/foldedExport';
import { exportFilename } from '../platform/exportFilename';
import { getFileService } from '../platform/fileService';
import type { PaperObjExport } from './paperExportTarget';

/** Keep worker errors as enums until they reach the user's locale. */
export function objExportUnavailableMessage(reason: FoldedObjUnavailableReason, t: TFunction): string {
  switch (reason) {
    case 'invalid-sheet':
    case 'nonplanar-sheet':
      return t('dialogs:paperExport.objSheetUnavailable', 'OBJ needs an unfolded sheet in the simulator’s paper plane to create texture coordinates.');
    case 'invalid-mesh':
      return t('dialogs:paperExport.objMeshUnavailable', 'This simulation has no valid mesh to export.');
    case 'expired-snapshot':
      return t('dialogs:paperExport.objExpired', 'This captured simulation is no longer available. Close this dialog and export again.');
  }
}

export async function saveObjExport(
  obj: PaperObjExport,
  fileStem: string,
  t: TFunction,
  signal?: AbortSignal
): Promise<string | null> {
  if (obj.unavailableReason) throw new Error(objExportUnavailableMessage(obj.unavailableReason, t));
  const contents = await obj.build();
  if (signal?.aborted) return null;
  if (contents === null) throw new Error(objExportUnavailableMessage('expired-snapshot', t));
  const result = await getFileService().saveTextFile({
    title: t('dialogs:paperExport.exportObj', 'Export OBJ'),
    contents,
    suggestedName: exportFilename(fileStem, 'obj'),
    path: null,
    extensions: ['obj'],
  });
  return result?.name ?? null;
}
