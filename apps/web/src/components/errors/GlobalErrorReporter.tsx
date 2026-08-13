import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { collectErrorContext } from './errorContext';
import { trackAnalyticsError } from '../../analytics';
import { copyTextToClipboard } from '../../lib/clipboardText';
import { buildErrorReport, describeError } from '../../lib/errorReport';
import { installGlobalErrorHandlers } from '../../lib/globalErrorHandlers';

/**
 * Surfaces uncaught window errors and unhandled promise rejections as toasts
 * carrying the same copyable report as an error boundary's fallback.
 *
 * Mounted once, beside `GlobalToasts` — a null-rendering effects component, in
 * keeping with the existing pattern for app-wide toast wiring.
 *
 * It also reports them, which is what makes this the app's *only* complete
 * error signal: every boundary reports through `ErrorBoundary`, but throws from
 * timers, rAF callbacks and unawaited promises reach no boundary at all, so
 * until they were reported here they were visible to the user as a toast and to
 * nobody else. They carry the same scrubbed fingerprint as a boundary catch —
 * no raw message, no stack — so this stays inside the privacy contract in
 * `docs/analytics.md`. React does not double-report: boundary-caught errors are
 * not re-raised to `window`, so they never arrive here.
 */
export function GlobalErrorReporter() {
  const { t } = useTranslation();

  useEffect(
    () =>
      installGlobalErrorHandlers({
        onError: ({ kind, error, key }) => {
          // `handled: false` is the distinction worth keeping: this escaped
          // every boundary, where a boundary catch left the app standing.
          trackAnalyticsError({ error, sourceComponent: `global:${kind}`, handled: false });

          toast.error(t('errors:global.title', 'Something went wrong in the background'), {
            id: key,
            description: describeError(error),
            duration: 10000,
            action: {
              label: t('errors:boundary.copy', 'Copy details'),
              onClick: () => {
                const report = buildErrorReport({
                  error,
                  context: collectErrorContext(`global:${kind}`),
                  timestamp: new Date().toISOString(),
                });
                void copyTextToClipboard(report).then((copied) => {
                  if (copied) toast.success(t('errors:boundary.copied', 'Copied'));
                  else toast.error(t('errors:boundary.copyFailed', "Couldn't copy"));
                });
              },
            },
          });
        },
      }),
    [t]
  );

  return null;
}
