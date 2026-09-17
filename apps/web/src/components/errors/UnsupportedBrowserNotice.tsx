import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';

/**
 * What the app renders in place of itself on a browser that cannot run it.
 *
 * Shown when the module-worker probe in `main.tsx` comes back negative: every engine is a
 * module worker, so there is no degraded mode to fall into, and the honest thing is to say
 * what is missing rather than let the first engine fail with "the worker stopped" and a
 * `SyntaxError` nobody can act on (ORI-STUDIO-B, Firefox 96).
 *
 * Borrows the app-level error fallback's chrome, and like that component stays dumb: no
 * stores, no engine, nothing that could itself throw on the browser being described.
 */
export function UnsupportedBrowserNotice() {
  const { t } = useTranslation();

  return (
    <div className="error-fallback error-fallback--app" role="alert">
      <div className="error-fallback__body">
        <AlertTriangle size={24} className="error-fallback__icon" aria-hidden="true" />
        <div className="error-fallback__text">
          <p className="error-fallback__title">
            {t('errors:unsupportedBrowser.title', 'Ori Studio can’t run in this browser')}
          </p>
          <p className="error-fallback__description">
            {t(
              'errors:unsupportedBrowser.description',
              'Its engines run in module Web Workers, which this browser does not support. Update to a current version of Firefox, Chrome, Edge or Safari and open this page again.'
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
