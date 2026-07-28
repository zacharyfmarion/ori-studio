import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';
import { clearAllPersistedLayouts } from '../../store/layoutStore';
import { Button } from '../ui/Button';

/**
 * The outermost boundary, and the app-level route `errorElement`'s shared
 * recovery affordances.
 *
 * "Reset layout" exists here and nowhere else: a corrupt persisted Dockview
 * layout is one of the few failures that survives a reload, and once the shell
 * will not render there is no other way for a user to reach it. It clears every
 * scope rather than the active one, because a shell that never mounted cannot
 * tell us which workspace was at fault.
 */
export function ResetLayoutAction() {
  const { t } = useTranslation();

  return (
    <Button
      size="sm"
      onClick={() => {
        try {
          clearAllPersistedLayouts();
        } catch {
          // Storage can be unavailable (private mode, disabled cookies). Reload
          // anyway — it is still the user's best next move.
        }
        window.location.reload();
      }}
    >
      <LayoutDashboard size={13} />
      {t('errors:boundary.resetLayout', 'Reset layout and reload')}
    </Button>
  );
}

export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary surface="app" variant="app" extraActions={<ResetLayoutAction />}>
      {children}
    </ErrorBoundary>
  );
}
