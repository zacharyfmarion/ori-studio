import { Loader2 } from 'lucide-react';

/**
 * Full-pane loading state for a workspace surface while the worker/engine it
 * depends on is still coming up. Each surface owns when to show this (gated on
 * its own readiness signal) — there is no global app-wide loading overlay.
 */
export function SurfaceLoading({ label }: { label: string }) {
  return (
    <div className="surface-loading" role="status" aria-live="polite">
      <Loader2 size={26} className="surface-loading__spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
