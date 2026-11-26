import type { TFunction } from 'i18next';
import { spreadFailedReason } from '../cp-workspace/folded/layerSpreadControls';
import { FoldedObjUnavailableError, type FoldedObjUnavailableReason } from '../lib/foldedExport';
import { exportFilename } from '../platform/exportFilename';
import { getFileService } from '../platform/fileService';
import type { PaperObjExport, PaperObjSpread } from './paperExportTarget';

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
    case 'needs-refold':
      return t(
        'dialogs:paperExport.objNeedsRefold',
        'This model can’t be rebuilt from its file as it’s drawn, so it has no mesh to export. Fold its creases again to export one.'
      );
  }
}

/**
 * Why a mesh, or its spread, could not be made, in the reader's words: a
 * folded figure with no fold to read says which, and a spread the solver
 * could not make says what every spread surface says of one.
 */
export function objExportFailureMessage(cause: unknown, t: TFunction): string {
  return cause instanceof FoldedObjUnavailableError ? objExportUnavailableMessage(cause.reason, t) : spreadFailedReason(t);
}

/** Write the mesh, with `spread` the dialog's for a mesh that has a spread source. */
export async function saveObjExport(
  obj: PaperObjExport,
  fileStem: string,
  t: TFunction,
  signal?: AbortSignal,
  spread?: PaperObjSpread
): Promise<string | null> {
  if (obj.unavailableReason) throw new Error(objExportUnavailableMessage(obj.unavailableReason, t));
  let contents: string | null;
  try {
    contents = await obj.build(spread);
  } catch (cause) {
    if (cause instanceof FoldedObjUnavailableError) throw new Error(objExportUnavailableMessage(cause.reason, t), { cause });
    throw cause;
  }
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
