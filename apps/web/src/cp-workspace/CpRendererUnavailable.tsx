import { useTranslation } from 'react-i18next';

type CpRendererUnavailableProps = {
  /** The thrown error's message, or `null` if it carried none. */
  reason: string | null;
};

/**
 * Shown over the crease-pattern viewport when a WebGL2 context could not be
 * created.
 *
 * This state used to be a `console.error` and nothing else, which in a packaged
 * desktop build means an empty editor and no explanation. It is not a
 * theoretical failure: the CP canvas is WebGL2/regl with no software path, and
 * WebKitGTK under software rendering or some proprietary drivers routinely has
 * no usable WebGL2 — so Linux is where this will be met first, on a build that
 * has only ever run on WKWebView.
 *
 * Reuses the read-only `.cp-panel__unopened` styles: both are "the viewport is
 * here but you cannot edit in it" messages, and they should not look different.
 */
export function CpRendererUnavailable({ reason }: CpRendererUnavailableProps) {
  const { t } = useTranslation();

  return (
    <div className="cp-panel__unopened" role="status">
      <span className="cp-panel__unopened-title">
        {t(
          'panels:creasePattern.rendererUnavailable',
          'The crease-pattern canvas could not start.',
        )}
      </span>
      <span className="cp-panel__unopened-detail">
        {t(
          'panels:creasePattern.rendererUnavailableHint',
          'Ori Studio draws crease patterns with WebGL2, which this system did not provide. Updating your graphics drivers usually resolves it.',
        )}
      </span>
      {/* The underlying error. Without it this state is a dead end: the editor is
          blank, and nothing says which part of the graphics stack refused. */}
      {reason && <code className="cp-panel__unopened-reason">{reason}</code>}
    </div>
  );
}
