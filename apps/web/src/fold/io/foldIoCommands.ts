/**
 * Fold's hand-offs and imports as the app runs them: the menu's verbs
 * (`commands/menuActions.ts` dispatches each `fold.*` io id here, loaded on
 * first use) and the toolbar's, bound to the app's session, stores, toasts
 * and file dialogs.
 *
 * Import CP, a sample and "Start from Edit's folded figure" open the one
 * dialog (`foldImportUiStore`), which runs the import; Send to Edit and the
 * exports run the hand-offs (`foldHandOffs.ts`).
 */

import { toast } from 'sonner';
import { trackFoldSequenceSentToEdit } from '../../analytics/trackFoldIo';
import i18n from '../../i18n';
import { exportPaperStyle } from '../../lib/paperStyleSettings';
import type { PaperExportScope } from '../../paperExport/paperExportTarget';
import { getFileService, type FileService } from '../../platform/fileService';
import { useLayoutStore } from '../../store/layoutStore';
import { focusedElement, usePaperExportUiStore } from '../../store/paperExportUiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { foldSession } from '../../store/workspaceStore/foldSession';
import { shownFoldSequence } from '../../store/workspaceStore/foldState';
import type { FoldSampleId } from '../engine/foldEngineIoSamples';
import {
  exportFoldSequence,
  openFoldStepsExport,
  sendFoldSequenceToEdit,
  type FoldHandOffBlock,
  type FoldHandOffDeps,
} from './foldHandOffs';
import { useFoldImportUiStore } from './foldImportUiStore';

/** A Fold io verb, as the menu's table names it. */
export type FoldIoCommand =
  | { readonly kind: 'import-cp' }
  | { readonly kind: 'import-sample'; readonly sample: FoldSampleId }
  | { readonly kind: 'start-from-edit-folded-figure' }
  | { readonly kind: 'send-to-edit' }
  | { readonly kind: 'export-fold' }
  | { readonly kind: 'export-steps'; readonly scope: PaperExportScope };

function blockedMessage(why: FoldHandOffBlock): string {
  const t = i18n.t.bind(i18n);
  switch (why) {
    case 'path-broken':
      return t(
        'toasts:foldIo.pathBroken',
        'A step of this sequence no longer folds, so the steps cannot be sent or exported.'
      );
    case 'unavailable':
      return t('toasts:foldIo.unavailable', 'The fold engine stopped before it finished. Try again.');
    case 'no-step':
      return t('toasts:foldIo.noStep', 'There is no step to export yet.');
    case 'sheet-on-screen':
      return t('toasts:foldIo.sheetOnScreen', 'Go to a step to export it.');
    case 'too-large':
      return t('toasts:foldIo.tooLarge', 'This sequence is too large to export as one FOLD file.');
  }
}

/** The app's bindings for the hand-offs, made as a verb runs. */
export function foldHandOffDeps(fileService: FileService = getFileService()): FoldHandOffDeps {
  // Before any await: the element the verb ran from, while it still has focus.
  const returnFocus = focusedElement();
  return {
    session: foldSession(),
    t: i18n.t.bind(i18n),
    title: () => {
      const state = useWorkspaceStore.getState();
      return shownFoldSequence(state)?.document.title || state.workspaceTitle;
    },
    blocked: (why) => toast.error(blockedMessage(why)),
    sendToEdit: async (payload) => {
      const store = useWorkspaceStore.getState();
      // The Edit pattern first, so the merge has a document to land in, as every Send to Edit does.
      await store.ensureEditCreasePattern();
      const sent = await useWorkspaceStore.getState().importAddOristudioCpText(payload);
      if (sent) useLayoutStore.getState().activatePanel('crease-pattern');
      return sent;
    },
    sentToEdit: trackFoldSequenceSentToEdit,
    fileService: () => fileService,
    exportStyle: () => exportPaperStyle(useSettingsStore.getState().paperStyle),
    openPaperExport: (target, scope) =>
      usePaperExportUiStore.getState().open({ target, format: null, scope, returnFocus }),
  };
}

/** Run a Fold io verb; whether it did what it says. */
export async function runFoldIoCommand(command: FoldIoCommand, fileService?: FileService): Promise<boolean> {
  const imports = useFoldImportUiStore.getState();
  switch (command.kind) {
    case 'import-cp':
      imports.open();
      return true;
    case 'import-sample':
      imports.open({ kind: 'sample', sample: command.sample });
      return true;
    case 'start-from-edit-folded-figure':
      imports.open({ kind: 'edit-folded-figure' });
      return true;
    case 'send-to-edit':
      return sendFoldSequenceToEdit(foldHandOffDeps(fileService));
    case 'export-fold':
      return exportFoldSequence(foldHandOffDeps(fileService));
    case 'export-steps':
      return openFoldStepsExport(foldHandOffDeps(fileService), command.scope);
  }
}
