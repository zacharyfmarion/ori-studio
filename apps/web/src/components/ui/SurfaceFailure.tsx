import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

/**
 * Full-pane failure state for a workspace surface whose engine did not come up.
 *
 * The counterpart to {@link SurfaceLoading}, and it exists because the two were
 * not distinguished: a surface that failed kept rendering the spinner, so
 * "still loading" and "will never load" looked identical and the second one
 * looked like a hang. Same shape, same gating — each surface decides when to
 * show it, from its own readiness signal.
 *
 * `onRetry` is optional but should almost always be supplied: a pane that can
 * only say what went wrong leaves the workspace as stuck as the spinner did.
 */
export function SurfaceFailure({
  label,
  detail,
  retryLabel,
  onRetry,
}: {
  label: string;
  detail?: string | null;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="surface-failure" role="alert">
      <AlertTriangle size={26} className="surface-failure__icon" aria-hidden="true" />
      <span className="surface-failure__label">{label}</span>
      {detail && <span className="surface-failure__detail">{detail}</span>}
      {onRetry && retryLabel && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
