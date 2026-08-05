import { useTranslation } from 'react-i18next';
import { humanizeError } from '../lib/toastMessages';
import { useWorkspaceStore } from '../store/workspaceStore';

/**
 * The current workspace error as text for a person to read, or null.
 *
 * The store holds `{ code, message }` where the message is written for
 * diagnostics ("Ori Studio project field workspace.documents must be an
 * array"). Every surface that shows the error to a user wants the same
 * derivation — translate the code, fall back to the raw message — so it lives
 * here rather than being re-derived per surface, which is how the toast came to
 * be the only place that ever translated it.
 */
export function useWorkspaceErrorText(): string | null {
  const { t } = useTranslation();
  const error = useWorkspaceStore((state) => state.error);
  return error ? humanizeError(error, t) : null;
}
