import type { TFunction } from 'i18next';
import type { FoldedObjUnavailableReason } from '../lib/foldedExport';
import { exportFilename } from '../platform/exportFilename';
import { getFileService } from '../platform/fileService';
import type { PaperExportTarget, PaperObjExport } from './paperExportTarget';
import { saveZipEntries } from './savePaperExport';
import type { ZipEntry } from './zipPages';

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
    case 'picture-only-spread':
      return t(
        'dialogs:paperExport.objSpreadUnavailable',
        'An Affine or Depth spread only moves the picture, so a 3D mesh can’t carry it. Set Spread by to Default to lift the layers apart.'
      );
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

/** One page's mesh in an export of every page: its file's stem in the ZIP, and its name in the pager. */
export interface PaperObjExportPage {
  obj: PaperObjExport;
  fileStem: string;
  label: string;
}

/** What an OBJ export writes: one mesh — the page on show's, or the target's — or every page's, as one ZIP. */
export type PaperObjExportPlan =
  | { kind: 'one'; obj: PaperObjExport; fileStem: string }
  | { kind: 'all'; pages: readonly PaperObjExportPage[]; zipStem: string };

/**
 * The OBJ an export of every page (`all`) or of the page on show writes; null
 * for a target that offers none. Every page of a target that offers OBJ has a
 * mesh (`PaperExportPage.obj`), so one without leaves the set with none.
 */
export function paperObjExportPlan(
  target: Pick<PaperExportTarget, 'obj' | 'fileStem' | 'pages'>,
  all: boolean
): PaperObjExportPlan | null {
  if (!target.obj) return null;
  if (!all || !target.pages) return { kind: 'one', obj: target.obj, fileStem: target.fileStem };
  const pages: PaperObjExportPage[] = [];
  for (const { obj, fileStem, label } of target.pages.list) {
    if (!obj) return null;
    pages.push({ obj, fileStem, label });
  }
  return { kind: 'all', pages, zipStem: target.pages.zipStem };
}

/**
 * Why the plan cannot be written, in the reader's words, or null when it can.
 * For every page, the first page that cannot, named as the pager names it: a
 * Fold step's spread is its own, so one step can stand in the way of the set.
 */
export function paperObjExportUnavailable(plan: PaperObjExportPlan, t: TFunction): string | null {
  if (plan.kind === 'one') {
    return plan.obj.unavailableReason && objExportUnavailableMessage(plan.obj.unavailableReason, t);
  }
  const blocked = plan.pages.find((page) => page.obj.unavailableReason !== null);
  if (!blocked?.obj.unavailableReason) return null;
  return t('dialogs:paperExport.objPageUnavailable', '{{page}}: {{reason}}', {
    page: blocked.label,
    reason: objExportUnavailableMessage(blocked.obj.unavailableReason, t),
  });
}

/**
 * Write the plan: one OBJ, or every page's in one ZIP, each built in turn —
 * and `onProgress` told as each is — with nothing saved unless all of them
 * were. The saved name, or null when the save dialog was dismissed or
 * `signal` aborted first.
 */
export async function savePaperObjExport(
  plan: PaperObjExportPlan,
  t: TFunction,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void
): Promise<string | null> {
  if (plan.kind === 'one') return saveObjExport(plan.obj, plan.fileStem, t, signal);
  const unavailable = paperObjExportUnavailable(plan, t);
  if (unavailable) throw new Error(unavailable);
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [];
  for (const [index, { obj, fileStem }] of plan.pages.entries()) {
    if (signal?.aborted) return null;
    const contents = await obj.build();
    if (signal?.aborted) return null;
    if (contents === null) throw new Error(objExportUnavailableMessage('expired-snapshot', t));
    entries.push({ name: exportFilename(fileStem, 'obj'), data: encoder.encode(contents), compress: true });
    onProgress?.(index + 1, plan.pages.length);
  }
  return saveZipEntries(entries, plan.zipStem, getFileService(), signal);
}
