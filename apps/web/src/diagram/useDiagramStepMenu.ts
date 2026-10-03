import { useCallback, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useShortcutStore } from '../store/shortcutStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import {
  contextMenuKeyboardAnchor,
  useContextMenuController,
  type ContextMenuController,
} from '../menus/context/useContextMenuController';
import { diagramStepMenuItems } from './actions/diagramContextMenu';
import { addDiagramStep, diagramStepActions } from './useDiagramActions';

/**
 * The Steps view's context menu: a card's step verbs, or Add Step on the space
 * between cards. A right-click selects the card it lands on first, so the Step
 * pane and the menu are about the same step.
 *
 * The rows are built when the menu opens, from the store as it is then.
 */
export function useDiagramStepMenu(root: RefObject<HTMLElement | null>): {
  controller: ContextMenuController;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  /** Open the menu for a step from the keyboard, at its card. Whether it opened. */
  openStepMenu: (stepId: string) => boolean;
} {
  const { t } = useTranslation();
  const controller = useContextMenuController('diagram');
  const request = controller.request;

  const requestStepMenu = useCallback(
    (stepId: string, at: { clientX: number; clientY: number }, source: 'pointer' | 'keyboard') => {
      request({
        ...at,
        source,
        targetKind: 'step',
        hasSelection: true,
        build: () =>
          diagramStepMenuItems(diagramStepActions(stepId, t), {
            overrides: useShortcutStore.getState().overrides,
            defaultsSource: useShortcutStore.getState().defaultsSource,
          }),
      });
    },
    [request, t]
  );

  const onContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      const card = (event.target as Element).closest<HTMLElement>('[data-step-id]');
      const stepId = card?.dataset.stepId;
      const at = { clientX: event.clientX, clientY: event.clientY };
      if (stepId) {
        useWorkspaceStore.getState().selectDiagramStep(stepId);
        requestStepMenu(stepId, at, 'pointer');
        return;
      }
      request({
        ...at,
        targetKind: 'empty',
        hasSelection: useWorkspaceStore.getState().diagramSelectedStepId !== null,
        build: () =>
          useWorkspaceStore.getState().diagramReadOnly
            ? []
            : [
                {
                  kind: 'action',
                  id: 'add-step',
                  label: t('panels:diagram.actions.addStep', 'Add Step'),
                  onSelect: () => {
                    addDiagramStep();
                  },
                },
              ],
      });
    },
    [request, requestStepMenu, t]
  );

  const openStepMenu = useCallback(
    (stepId: string) => {
      // Compared, not put in a selector: an id read from a file can hold any
      // character a selector would need escaped.
      const card = [...(root.current?.querySelectorAll<HTMLElement>('[data-step-id]') ?? [])].find(
        (element) => element.dataset.stepId === stepId
      );
      const anchor = contextMenuKeyboardAnchor(card ?? null);
      if (!anchor) return false;
      requestStepMenu(stepId, anchor, 'keyboard');
      return true;
    },
    [requestStepMenu, root]
  );

  return { controller, onContextMenu, openStepMenu };
}
