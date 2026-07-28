import type { ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * Boundary for the always-mounted overlays (dialogs, toast host). They sit
 * beside the workspace rather than inside it, so a crash in one used to take
 * the whole app — including the open document — down with it.
 *
 * The `overlay` fallback is dismissible, which is the affordance a broken
 * dialog needs most: the modal's own Escape handling died with it, so without
 * this there is no way to get back to the document.
 */
export function OverlayErrorBoundary({ id, children }: { id: string; children: ReactNode }) {
  return (
    <ErrorBoundary surface={`overlay:${id}`} variant="overlay">
      {children}
    </ErrorBoundary>
  );
}
