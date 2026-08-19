import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertTriangle, Check, ClipboardCopy, ExternalLink, RotateCcw, X } from 'lucide-react';
import { ISSUES_URL } from '../../constants/release';
import { copyTextToClipboard } from '../../lib/clipboardText';
import {
  buildErrorReport,
  describeError,
  unavailableContext,
  type ErrorReportContext,
} from '../../lib/errorReport';
import { Button } from '../ui/Button';
import { CONTROL_RADIUS_CLASS, ICON_CONTROL_SIZE_CLASSES } from '../ui/controlStyles';

/**
 * What an error boundary renders in place of the subtree it lost.
 *
 * One component, five sizes, because the affordances are identical and only the
 * chrome differs — the app-level fallback is the pane fallback with a reload
 * button and more padding.
 *
 * `mini` exists because `strip` is a *horizontal* row, and the workspace rail is
 * a ~48px vertical column: rendering the strip there wrapped the message to one
 * character per line. Anything mounted in a narrow column wants `mini`.
 *
 * This component must stay *dumb*. It reads no stores, calls no engine, and
 * takes everything it renders as a plain prop. A throw inside a fallback
 * escalates to the parent boundary, so a fallback that touched the same broken
 * state would cascade a contained panel crash all the way up — which is exactly
 * the failure the boundary existed to prevent.
 */

export type ErrorFallbackVariant = 'app' | 'pane' | 'strip' | 'mini' | 'overlay';

export interface ErrorFallbackProps {
  variant: ErrorFallbackVariant;
  surface: string;
  error: unknown;
  componentStack: string | null;
  /** Null when context collection itself failed; the report still renders. */
  context: ErrorReportContext | null;
  onRetry: () => void;
  extraActions?: ReactNode;
}

/** How long "Copied" / "Couldn't copy" stays on the button. */
const COPY_FEEDBACK_MS = 2000;

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * The `mini` buttons borrow `IconButton`'s style classes but not the component:
 * `IconButton` renders a Radix tooltip, which needs a `TooltipProvider` in
 * context. A fallback that throws for want of a provider would escalate to the
 * parent boundary — the exact cascade this component exists to avoid — so it
 * stays on a plain button with a native `title`, which works anywhere.
 */
const MINI_BUTTON_CLASS = [
  'ui-button',
  'ui-button--icon',
  'ui-button--ghost',
  CONTROL_RADIUS_CLASS,
  ICON_CONTROL_SIZE_CLASSES.sm,
].join(' ');

/**
 * Names what was lost, per variant. Exhaustive over the union rather than a
 * chain with a default, so adding a variant is a type error here instead of a
 * fallback silently claiming the wrong thing broke.
 */
function fallbackTitle(variant: ErrorFallbackVariant, t: TFunction): string {
  switch (variant) {
    case 'app':
      return t('errors:boundary.appTitle', 'Ori Studio ran into a problem');
    case 'overlay':
      return t('errors:boundary.overlayTitle', 'This dialog stopped working');
    case 'strip':
      return t('errors:boundary.stripTitle', 'This toolbar stopped working');
    case 'mini':
      return t('errors:boundary.miniTitle', 'This sidebar stopped working');
    case 'pane':
      return t('errors:boundary.paneTitle', 'This panel stopped working');
  }
}

export function ErrorFallback({
  variant,
  surface,
  error,
  componentStack,
  context,
  onRetry,
  extraActions,
}: ErrorFallbackProps) {
  const { t } = useTranslation();
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [dismissed, setDismissed] = useState(false);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    },
    [],
  );

  // What the disclosure shows is exactly what the button copies — no second
  // formatting path that could drift from the one developers actually receive.
  const report = useMemo(
    () =>
      buildErrorReport({
        error,
        componentStack,
        context: context ?? unavailableContext(surface),
        timestamp: new Date().toISOString(),
      }),
    [componentStack, context, error, surface],
  );

  const handleCopy = useCallback(async () => {
    const copied = await copyTextToClipboard(report);
    setCopyState(copied ? 'copied' : 'failed');
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setCopyState('idle'), COPY_FEEDBACK_MS);
  }, [report]);

  if (dismissed) return null;

  const title = fallbackTitle(variant, t);

  const description =
    variant === 'app'
      ? t(
          'errors:boundary.appDescription',
          'Your work is still in memory but the interface could not recover on its own. Copy the details below before reloading — they tell a developer exactly what went wrong.',
        )
      : t(
          'errors:boundary.description',
          'The rest of Ori Studio is still running. Try again, or copy the details and report it.',
        );

  const copyLabel =
    copyState === 'copied'
      ? t('errors:boundary.copied', 'Copied')
      : copyState === 'failed'
        ? t('errors:boundary.copyFailed', "Couldn't copy")
        : t('errors:boundary.copy', 'Copy details');

  const CopyIcon = copyState === 'copied' ? Check : ClipboardCopy;

  // Icon-only, stacked vertically: the only shape that fits a narrow rail. The
  // message moves into tooltips rather than being dropped — it is still the
  // first thing someone needs.
  if (variant === 'mini') {
    return (
      <div className="error-fallback error-fallback--mini" role="alert">
        <AlertTriangle size={16} className="error-fallback__icon" aria-label={title} role="img" />
        <button
          type="button"
          className={MINI_BUTTON_CLASS}
          title={`${t('errors:boundary.retry', 'Try again')} — ${describeError(error)}`}
          onClick={onRetry}
        >
          <RotateCcw size={13} />
        </button>
        <button
          type="button"
          className={MINI_BUTTON_CLASS}
          title={copyLabel}
          onClick={() => void handleCopy()}
        >
          <CopyIcon size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className={`error-fallback error-fallback--${variant}`} role="alert">
      <div className="error-fallback__body">
        <AlertTriangle
          size={variant === 'strip' ? 15 : 22}
          className="error-fallback__icon"
          aria-hidden="true"
        />
        <div className="error-fallback__text">
          <p className="error-fallback__title">{title}</p>
          {variant !== 'strip' && <p className="error-fallback__description">{description}</p>}
          <p className="error-fallback__message">{describeError(error)}</p>
        </div>
      </div>

      <div className="error-fallback__actions">
        <Button size="sm" variant="primary" onClick={onRetry}>
          <RotateCcw size={13} />
          {t('errors:boundary.retry', 'Try again')}
        </Button>
        <Button size="sm" onClick={() => void handleCopy()} data-copy-state={copyState}>
          <CopyIcon size={13} />
          {copyLabel}
        </Button>
        {variant === 'app' && (
          <Button size="sm" onClick={() => window.location.reload()}>
            {t('errors:boundary.reload', 'Reload')}
          </Button>
        )}
        {variant === 'overlay' && (
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            <X size={13} />
            {t('errors:boundary.dismiss', 'Dismiss')}
          </Button>
        )}
        {extraActions}
        {variant !== 'strip' && (
          <a
            className="error-fallback__report"
            href={ISSUES_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('errors:boundary.report', 'Report an issue')}
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        )}
      </div>

      {variant !== 'strip' && (
        <details className="error-fallback__details">
          <summary>{t('errors:boundary.detailsSummary', 'Technical details')}</summary>
          <pre className="error-fallback__report-text">{report}</pre>
        </details>
      )}
    </div>
  );
}
