import { useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { handleMenuAction } from '../../commands/menuActions';
import { runContextMenuAction } from '../../menus/context/contextMenuRun';
import { useContextMenuController, type ContextMenuController } from '../../menus/context/useContextMenuController';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { FOLD_SHEET_KEY } from '../document/foldStepTree';
import { currentFoldActions } from './foldCommands';
import { foldStepMenuItems } from './foldStepMenu';

/**
 * A step card's context menu, in the strip: the catalog's
 * verbs for the step it lands on. A right-click puts the reader on that step
 * first, so the panes, the canvas and the menu are about the same step.
 * `stepAt` says which step a press landed on — a key from the card it is in
 * ({@link FOLD_SHEET_KEY} for the sheet), or null for none.
 *
 * The rows are built when the menu opens, from the session as it is then.
 */
export function useFoldStepMenu(stepAt: (target: Element) => string | null): {
  controller: ContextMenuController;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
} {
  const { t } = useTranslation();
  const controller = useContextMenuController('fold');
  const request = controller.request;

  const onContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!(event.target instanceof Element)) return;
      const key = stepAt(event.target);
      if (key === null) return;
      event.preventDefault();
      const id = key === FOLD_SHEET_KEY ? null : key;
      useWorkspaceStore.getState().moveFoldCursor(id);
      request({
        clientX: event.clientX,
        clientY: event.clientY,
        targetKind: 'step',
        hasSelection: true,
        build: () =>
          foldStepMenuItems(currentFoldActions(t), (actionId) =>
            runContextMenuAction('fold', actionId, () => handleMenuAction(actionId))
          ),
      });
    },
    [request, stepAt, t]
  );

  return { controller, onContextMenu };
}
