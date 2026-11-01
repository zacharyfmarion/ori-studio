/**
 * Fold's io verbs for the surfaces that place them beside the menu: the
 * action catalog's bindings (`fold/foldActions.ts`) and the Send to Edit
 * button. Each dispatches its menu id through the shared chokepoint, so a
 * press is gated by the same capability as the menu row and counted once as
 * `command invoked`; nothing here runs a verb itself.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { handleMenuAction, type MenuActionId } from '../../commands/menuActions';
import { sendToEditButtonModel, type SendToEditButtonModel } from '../../designKinds/sendToEditActions';
import { useWorkspaceCapabilities } from '../../store/workspaceStore/useWorkspaceCapabilities';
import { foldSendToEditSource, type FoldActionDeps, type FoldCommand } from '../foldActions';

/** The action catalog's io commands, by the menu id each dispatches. */
export const FOLD_IO_COMMAND_MENU_IDS = {
  'import-cp': 'fold.import-cp',
  'send-to-edit': 'fold.send-to-edit',
  'send-to-diagram': 'fold.send-to-diagram',
  'send-path-to-diagram': 'fold.send-path-to-diagram',
  'export-fold': 'fold.export-fold',
  'export-steps': 'fold.export-steps',
} as const satisfies Record<string, MenuActionId>;

const dispatch = (id: MenuActionId) => () => {
  void handleMenuAction(id);
};

/** `buildFoldActions`' io bindings: Import CP, Send to Edit, Send to Diagram and the two exports. */
export const FOLD_IO_ACTION_DEPS: Pick<
  FoldActionDeps,
  'importCp' | 'sendToEdit' | 'sendToDiagram' | 'exportFold' | 'exportSteps'
> = {
  importCp: dispatch(FOLD_IO_COMMAND_MENU_IDS['import-cp']),
  sendToEdit: dispatch(FOLD_IO_COMMAND_MENU_IDS['send-to-edit']),
  sendToDiagram: (scope) =>
    dispatch(FOLD_IO_COMMAND_MENU_IDS[scope === 'step' ? 'send-to-diagram' : 'send-path-to-diagram'])(),
  exportFold: dispatch(FOLD_IO_COMMAND_MENU_IDS['export-fold']),
  exportSteps: dispatch(FOLD_IO_COMMAND_MENU_IDS['export-steps']),
};

/**
 * The Send to Edit button for a Fold sequence (plan D10, D14): the shared
 * model every design kind's button is (`sendToEditButtonModel`) over Fold's
 * source — its tooltip, and no caret: precreases always go as auxiliary
 * lines — gated by the menu row's capability and by the action catalog's
 * command (`command`, the catalog's Send to Edit for the step on screen),
 * which knows what the store does not: a selected step still folding, or one
 * that no longer folds. Disabled, its tooltip says why, in the words of
 * whichever turned it down.
 */
export function useFoldSendToEditButton(
  command?: Pick<FoldCommand, 'disabled' | 'hint'>
): SendToEditButtonModel {
  const { t } = useTranslation();
  const capability = useWorkspaceCapabilities()['fold.send-to-edit'];
  const blocked = command?.disabled === true;
  const hint = command?.hint;
  return useMemo(
    () =>
      sendToEditButtonModel(foldSendToEditSource(t), t, {
        send: () => void handleMenuAction(FOLD_IO_COMMAND_MENU_IDS['send-to-edit']),
        disabled: !capability.enabled || blocked,
        reason: capability.enabled ? hint : capability.reason,
      }),
    [t, capability.enabled, capability.reason, blocked, hint]
  );
}
