import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { formatUnknownError } from '../lib/toastMessages';
import { useWorkspaceStore } from '../store/workspaceStore';

function errorKey(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const envelope = error as { code: unknown; message: unknown };
    return `${String(envelope.code)}:${String(envelope.message)}`;
  }
  return formatUnknownError(error);
}

export function GlobalToasts() {
  const { t } = useTranslation();
  const error = useWorkspaceStore((state) => state.error);
  const projectMessage = useWorkspaceStore((state) => state.projectMessage);
  const clearProjectMessage = useWorkspaceStore((state) => state.clearProjectMessage);
  const lastErrorKey = useRef<string | null>(null);

  useEffect(() => {
    if (!error) {
      lastErrorKey.current = null;
      return;
    }

    const key = errorKey(error);
    if (lastErrorKey.current === key) return;
    lastErrorKey.current = key;

    toast.error(t('toasts:global.error', 'Ori Studio error'), {
      id: `treemaker-error-${key}`,
      description: formatUnknownError(error),
      duration: 8000,
    });
  }, [error, t]);

  useEffect(() => {
    if (!projectMessage) return;
    clearProjectMessage();
  }, [clearProjectMessage, projectMessage]);

  return null;
}
