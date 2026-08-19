import { requestConfirmation } from '../store/commandDialogStore';
import { useWorkspaceStore } from '../store/workspaceStore';

/**
 * Whether the active project has changes that would be lost.
 *
 * One predicate for one question. Three places need to know this — the window
 * close guard, the browser `beforeunload`, and the update chip — and if they
 * disagree, exactly one of them silently discards someone's work.
 */
export function hasUnsavedWork(): boolean {
  return useWorkspaceStore.getState().dirty;
}

export type DiscardConfirmationCopy = {
  title: string;
  message: string;
  confirmLabel: string;
};

/**
 * Ask before throwing away unsaved changes. Resolves true when it is safe to
 * proceed — including when there was nothing to lose, so callers need no
 * separate dirtiness branch.
 *
 * The copy is passed in rather than owned here because the two callers are
 * asking different questions ("close the app?" vs "restart into the update?"),
 * and translation happens at the call site where `t` is in scope.
 */
export async function confirmDiscardUnsavedWork(copy: DiscardConfirmationCopy): Promise<boolean> {
  if (!hasUnsavedWork()) return true;
  return requestConfirmation({
    title: copy.title,
    message: copy.message,
    confirmLabel: copy.confirmLabel,
    tone: 'danger',
  });
}
