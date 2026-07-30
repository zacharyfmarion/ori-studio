import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { collectErrorContext } from './errorContext';
import { copyTextToClipboard } from '../../lib/clipboardText';
import { buildErrorReport, describeError } from '../../lib/errorReport';
import { installGlobalErrorHandlers } from '../../lib/globalErrorHandlers';

/**
 * Surfaces uncaught window errors and unhandled promise rejections as toasts
 * carrying the same copyable report as an error boundary's fallback.
 *
 * Mounted once, beside `GlobalToasts` — a null-rendering effects component, in
 * keeping with the existing pattern for app-wide toast wiring.
 */
export function GlobalErrorReporter() {
  const { t } = useTranslation();

  useEffect(
    () =>
      installGlobalErrorHandlers({
        onError: ({ kind, error, key }) => {
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
