import i18n from '../i18n';
import {
  OPENABLE_FILE_EXTENSIONS,
  resolveDropDecision,
  selectDroppedFile,
  type DropRejectReason,
  type DropTargetPolicy,
  type DroppedSelection,
} from '../lib/fileDrop';
import { createDroppedFileService } from '../platform/fileService';
import { currentPath, navigateTo } from '../routing/appRouter';
import { currentWorkspacePath } from '../routing/landing';
import { EDIT_PATH } from '../routing/paths';
import { requestChoice, useCommandDialogStore } from '../store/commandDialogStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { selectWorkspaceCapabilities } from '../store/workspaceStore/capabilities';

/** Option ids of the open-or-import choice. */
const IMPORT_CHOICE = 'import';
const OPEN_CHOICE = 'open';

export interface FileDropRequest {
  files: readonly File[];
  policy: DropTargetPolicy;
}

/**
 * What a drop did, for the caller's own reporting and for tests. `null` means
 * nothing was attempted (an empty drop, or a refusal already reported).
 */
export type FileDropResult = 'opened' | 'imported' | 'cancelled' | 'refused' | null;

function refuse(message: string): void {
  useWorkspaceStore.setState({
    error: { code: 'invalid_operation', message },
    projectMessage: null,
  });
}

function refusalMessage(reason: DropRejectReason, selection: DroppedSelection): string {
  switch (reason) {
    case 'image-not-here':
      return i18n.t(
        'errors:fileDrop.imageNotHere',
        'Drop {{name}} onto the crease pattern to add it as a reference image.',
        { name: selection.file.name }
      );
    case 'unsupported-file':
      return i18n.t(
        'errors:fileDrop.unsupportedFile',
        'Ori Studio cannot open {{name}}. Supported files: {{extensions}}.',
        {
          name: selection.file.name,
          extensions: OPENABLE_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(', '),
        }
      );
  }
}

/**
 * Ask whether a dropped crease pattern should be merged into the current one or
 * replace it. Returns the picked option id, or null when dismissed.
 *
 * The discard warning lives on the Open option rather than in a second modal:
 * the user is already being asked what to do with this file, and splitting the
 * consequence into a follow-up prompt asks them the same question twice.
 */
function requestOpenOrImportChoice(
  selection: DroppedSelection,
  warnsDiscard: boolean
): Promise<string | null> {
  return requestChoice({
    title: i18n.t('dialogs:fileDrop.choiceTitle', 'Open or import {{name}}?', {
      name: selection.file.name,
    }),
    message: i18n.t(
      'dialogs:fileDrop.choiceMessage',
      '{{name}} is a crease pattern, so it can be merged into the one you are editing or opened on its own.',
      { name: selection.file.name }
    ),
    options: [
      {
        id: IMPORT_CHOICE,
        label: i18n.t('dialogs:fileDrop.importLabel', 'Import beside the current pattern'),
        description: i18n.t(
          'dialogs:fileDrop.importDescription',
          'Placed to the right of your crease pattern, as one undoable edit.'
        ),
      },
      {
        id: OPEN_CHOICE,
        label: i18n.t('dialogs:fileDrop.openLabel', 'Open as a new file'),
        description: warnsDiscard
          ? i18n.t(
              'dialogs:fileDrop.openDescriptionDirty',
              'Replaces what you are working on and discards your unsaved changes.'
            )
          : i18n.t(
              'dialogs:fileDrop.openDescription',
              'Replaces what you are working on.'
            ),
        tone: warnsDiscard ? 'danger' : 'default',
      },
    ],
  });
}

/**
 * Note any files the drop carried that this one action does not touch.
 *
 * Two keys picked by hand rather than one i18next plural. The plural form would
 * generate a `_one` variant that can never render — this branch only reaches the
 * many-key at two or more — and the interpolation is deliberately not named
 * `count`, which i18next treats as a plural trigger.
 */
function reportIgnoredFiles(selection: DroppedSelection): void {
  const others = selection.ignoredCount;
  if (others === 0) return;
  useWorkspaceStore.setState({
    projectMessage:
      others === 1
        ? i18n.t('toasts:fileDrop.ignoredFile', 'Used {{name}}; ignored 1 other dropped file.', {
            name: selection.file.name,
          })
        : i18n.t(
            'toasts:fileDrop.ignoredFiles',
            'Used {{name}}; ignored {{others}} other dropped files.',
            { name: selection.file.name, others }
          ),
  });
}

/**
 * Act on a set of dropped files: decide what the drop means, ask the user when
 * the file could go either way, then hand it to the same store actions File ▸
 * Open and File ▸ Import (Add) use.
 *
 * Capability gating is left to those actions — they already refuse with a
 * localized reason when the workspace is busy or has nothing to merge into. The
 * only capability read here is whether merging is possible at all, which decides
 * whether the choice is worth raising.
 */
export async function handleFileDrop({ files, policy }: FileDropRequest): Promise<FileDropResult> {
  const selection = selectDroppedFile(files);
  if (!selection) return null;

  // One dialog at a time: raising ours would resolve whatever is already open
  // with its fallback, silently cancelling it.
  if (useCommandDialogStore.getState().dialog !== null) {
    refuse(
      i18n.t('errors:fileDrop.dialogOpen', 'Finish the open dialog before dropping a file.')
    );
    return 'refused';
  }

  const state = useWorkspaceStore.getState();
  const decision = resolveDropDecision({
    kind: selection.kind,
    policy,
    canImportAdd: selectWorkspaceCapabilities(state)['file.importAdd'].enabled,
    dirty: state.dirty,
  });

  if (decision.outcome === 'reject') {
    refuse(refusalMessage(decision.reason, selection));
    return 'refused';
  }

  let intent: 'open' | 'import' = 'open';
  if (decision.outcome === 'choose') {
    const picked = await requestOpenOrImportChoice(selection, decision.warnsDiscard);
    if (picked !== IMPORT_CHOICE && picked !== OPEN_CHOICE) return 'cancelled';
    intent = picked === IMPORT_CHOICE ? 'import' : 'open';
  }

  const fileService = createDroppedFileService(selection.file);

  if (intent === 'import') {
    const imported = await useWorkspaceStore.getState().importAddCreasePattern(fileService);
    if (!imported) return null;
    reportIgnoredFiles(selection);
    // The merge lands on the Edit canvas wherever it was triggered from.
    if (currentPath() !== EDIT_PATH) navigateTo(EDIT_PATH);
    return 'imported';
  }

  // The choice dialog already stated the discard consequence, so opening must
  // not ask a second time. Without a choice, nobody has asked yet — leave the
  // store's own prompt in place.
  const confirmDiscard = decision.outcome !== 'choose';
  const opened = await useWorkspaceStore
    .getState()
    .openProject(fileService, { confirmDiscard });
  if (!opened) return null;
  reportIgnoredFiles(selection);
  navigateTo(currentWorkspacePath());
  return 'opened';
}
