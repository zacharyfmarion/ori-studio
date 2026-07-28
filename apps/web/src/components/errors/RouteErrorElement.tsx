import { useRouteError } from 'react-router-dom';
import { ResetLayoutAction } from './AppErrorBoundary';
import { ErrorFallback } from './ErrorFallback';
import { collectErrorContext } from './errorContext';

/**
 * The router's `errorElement`. React Router catches route render and loader
 * errors itself and never lets them reach a React error boundary, so this is a
 * second, parallel entry point to the same fallback.
 *
 * There is no "reset children" here the way there is in `ErrorBoundary` — the
 * router owns the subtree, and the honest recovery for a failed route is to
 * reload the app. So retry reloads.
 */
export function RouteErrorElement() {
  const error = useRouteError();

  return (
    <ErrorFallback
      variant="app"
      surface="route"
      error={error}
      componentStack={null}
      context={collectErrorContext('route')}
      onRetry={() => window.location.reload()}
      extraActions={<ResetLayoutAction />}
    />
  );
}
