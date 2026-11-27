import { useTranslation } from 'react-i18next';
import { useCpCanvasUnavailableEvent } from '../analytics/useCpCanvasUnavailableEvent';
import { Button } from '../components/ui/Button';
import { isDesktopRuntime } from '../platform/runtime';
import type { CpRendererStatus } from './renderer/webglSupport';

export type { CpRendererStatus } from './renderer/webglSupport';

type CpRendererUnavailableProps = {
  status: CpRendererStatus;
  /**
   * Build the renderer again on the same canvas. Offered only where it can
   * help: a graphics stack that refused once can grant a context the next
   * time — a GPU process that has recovered, a document no longer out of
   * contexts — whereas a lost context comes back on the browser's schedule, and
   * the host already rebuilds the moment it does.
   */
  onRetry?: () => void;
};

/**
 * Shown over the crease-pattern viewport when it cannot draw.
 *
 * This state used to be a `console.error` and nothing else, which in a packaged
 * desktop build means an empty editor and no explanation. Neither branch is
 * theoretical: the CP canvas is WebGL with no software path, and WebKitGTK under
 * software rendering or some proprietary drivers routinely has no usable WebGL
 * at all, while iPadOS reclaims live contexts from a working app under memory
 * pressure. A design tool that silently blanks has lost the user's confidence
 * even when the document behind it is intact.
 *
 * Reuses the read-only `.cp-panel__unopened` styles: both are "the viewport is
 * here but you cannot edit in it" messages, and they should not look different.
 */
export function CpRendererUnavailable({ status, onRetry }: CpRendererUnavailableProps) {
  const { t } = useTranslation();
  useCpCanvasUnavailableEvent(status);

  if (status.kind === 'context-lost') {
    return (
      <div className="cp-panel__unopened" role="status">
        <span className="cp-panel__unopened-title">
          {t('panels:creasePattern.rendererContextLost', 'Restoring the crease-pattern canvas…')}
        </span>
        <span className="cp-panel__unopened-detail">
          {t(
            'panels:creasePattern.rendererContextLostHint',
            'The system took this canvas’s graphics memory back, which can happen when the device runs low on it. Your crease pattern is safe — the view returns as soon as the graphics context does. If it does not come back, reload Ori Studio.'
          )}
        </span>
      </div>
    );
  }

  // The remedy is the one thing that differs: a browser has a setting that
  // turns WebGL off, and the desktop app has no such switch — there the
  // graphics driver is what decides.
  return (
    <div className="cp-panel__unopened" role="status">
      <span className="cp-panel__unopened-title">
        {t('panels:creasePattern.rendererUnavailable', 'The crease-pattern canvas could not start.')}
      </span>
      <span className="cp-panel__unopened-detail">
        {isDesktopRuntime()
          ? t(
              'panels:creasePattern.rendererUnavailableHintDesktop',
              'Drawing crease patterns needs WebGL, which this computer’s graphics driver did not provide. Updating the graphics driver usually fixes it. Your crease pattern is safe.'
            )
          : t(
              'panels:creasePattern.rendererUnavailableHint',
              'Drawing crease patterns needs WebGL, which this browser did not provide. Turning on hardware acceleration in the browser’s settings usually fixes it. Your crease pattern is safe.'
            )}
      </span>
      {/* The underlying gap. Without it this state is a dead end: the editor is
          blank, and nothing says which part of the graphics stack refused. */}
      {status.detail && <code className="cp-panel__unopened-reason">{status.detail}</code>}
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {t('panels:creasePattern.rendererRetry', 'Try again')}
        </Button>
      )}
    </div>
  );
}
