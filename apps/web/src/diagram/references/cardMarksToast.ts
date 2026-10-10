/**
 * What a toast says when an edit to a References step's card took marks the
 * author had worked on (17d, RM6; 17e): Replace from References, another
 * way, and Make Marks Editable on a step an edited mark of its card was
 * pasted onto all swap every mark the card brought, edited ones too, and say
 * so with Undo.
 */
import i18n from '../../i18n';
import { useWorkspaceStore } from '../../store/workspaceStore';

/** That an edit took `count` marks the author had edited (17d, RM6). */
export function replacedEdited(count: number): string {
  return i18n.t('toasts:diagram.references.replacedEdited', {
    count,
    defaultValue_one: 'Replaced a mark you had edited',
    defaultValue_other: 'Replaced {{count}} marks you had edited',
  });
}

/**
 * Undo for a toast that says the edit just made took the author's work:
 * while that edit is still the newest, Undo takes it back, and nothing else.
 */
export function undoNewest(): { label: string; onClick: () => void } {
  const entry = useWorkspaceStore.getState().diagramHistory.past.at(-1);
  return {
    label: i18n.t('toasts:diagram.references.undoReplaced', 'Undo'),
    onClick: () => {
      const now = useWorkspaceStore.getState();
      if (entry !== undefined && now.diagramHistory.past.at(-1) === entry) now.undoDiagram();
    },
  };
}
