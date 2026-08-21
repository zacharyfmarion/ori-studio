import { useTranslation } from 'react-i18next';

/**
 * Why the crease-pattern viewport is not drawing.
 *
 * Two states, because they call for opposite things from the user. `unsupported`
 * is permanent — this graphics stack cannot run the surface, and nothing but a
 * different one will change that. `context-lost` is a blip on hardware that was
 * drawing a moment ago, and the only useful instruction is to wait.
 */
export type CpRendererStatus =
  /** No usable WebGL. `detail` is the probed gap, or the thrown error's message. */
  | { kind: 'unsupported'; detail: string | null }
  /** The context was taken away; a rebuild is waiting on `webglcontextrestored`. */
  | { kind: 'context-lost' };

type CpRendererUnavailableProps = {
  status: CpRendererStatus;
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
export function CpRendererUnavailable({ status }: CpRendererUnavailableProps) {
  const { t } = useTranslation();

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

  return (
    <div className="cp-panel__unopened" role="status">
      <span className="cp-panel__unopened-title">
        {t('panels:creasePattern.rendererUnavailable', 'The crease-pattern canvas could not start.')}
      </span>
      <span className="cp-panel__unopened-detail">
        {t(
          'panels:creasePattern.rendererUnavailableHint',
          'Ori Studio draws crease patterns with WebGL and instanced rendering, which this system did not provide. Updating your graphics drivers usually resolves it.'
        )}
      </span>
      {/* The underlying gap. Without it this state is a dead end: the editor is
          blank, and nothing says which part of the graphics stack refused. */}
      {status.detail && <code className="cp-panel__unopened-reason">{status.detail}</code>}
    </div>
  );
}
