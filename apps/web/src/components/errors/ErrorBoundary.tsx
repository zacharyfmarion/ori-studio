import { Component, type ErrorInfo, type ReactNode } from 'react';
import { trackAnalyticsError } from '../../analytics';
import { reportError } from '../../monitoring';
import { collectErrorContext } from './errorContext';
import { ErrorFallback, type ErrorFallbackVariant } from './ErrorFallback';
import type { ErrorReportContext } from '../../lib/errorReport';

/**
 * The app's only error boundary implementation. Everything that needs one — the
 * root, the router, the shell chrome, every dock panel, every modal — mounts
 * this with a different `surface` and `variant`.
 *
 * Two things worth knowing:
 *
 * - **It still logs.** Containment must not mean silence: `componentDidCatch`
 *   keeps a `console.error` so a crash is as visible in devtools as it was
 *   before boundaries existed.
 * - **Reset gives children a fresh mount for free.** React unmounts the failed
 *   subtree when the fallback renders, so clearing `error` mounts the children
 *   anew — with new state, refs, and effects — rather than re-rendering them
 *   into whatever broke them. No key juggling needed.
 *
 * The report context is captured at catch time and frozen into state, so the
 * fallback renders from a snapshot of the moment things broke rather than from
 * stores that may have moved on (or may be the thing that is broken).
 */

export interface ErrorBoundaryProps {
  /** Stable id naming what was lost — `panel:crease-pattern`, `overlay:settings`. */
  surface: string;
  variant: ErrorFallbackVariant;
  children: ReactNode;
  /**
   * Clear the error when any of these change identity. Point this at the open
   * document so a panel that died on bad input recovers when good input
   * arrives, instead of making the user find the Try again button.
   */
  resetKeys?: readonly unknown[];
  onError?: (error: unknown, componentStack: string | null) => void;
  /** Extra actions for the fallback (e.g. "Reset layout" at the app level). */
  extraActions?: ReactNode;
}

interface ErrorBoundaryState {
  error: unknown | null;
  componentStack: string | null;
  context: ErrorReportContext | null;
}

function keysChanged(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  if (a === b) return false;
  if (!a || !b || a.length !== b.length) return true;
  return a.some((value, index) => !Object.is(value, b[index]));
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null, context: null };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    const componentStack = errorInfo.componentStack ?? null;
    this.setState({ componentStack, context: collectErrorContext(this.props.surface) });

    console.error(`[ori-studio] error boundary "${this.props.surface}" caught`, error);

    // Report to analytics from the single boundary implementation, so every
    // surface (app, router, panels, overlays) is covered. `surface` is a stable
    // enum-ish id — safe to send; the domain is inferred from it. No-op when
    // analytics is disabled or absent.
    try {
      trackAnalyticsError({ error, sourceComponent: this.props.surface, handled: true });
    } catch {
      // Reporting must never mask the error it was reporting.
    }

    // And to Sentry, with the stack and the component stack that the analytics
    // event deliberately does not carry. The two are not redundant: PostHog
    // answers "how often, and does it correlate with anything", Sentry answers
    // "where". Unhandled errors need no call like this — Sentry's global
    // handlers already see those — but a boundary catch is invisible to them by
    // construction, which is exactly why it is reported here.
    try {
      reportError(error, { surface: this.props.surface, componentStack, handled: true });
    } catch {
      // Reporting must never mask the error it was reporting.
    }

    try {
      this.props.onError?.(error, componentStack);
    } catch {
      // A failing reporter must not mask the error it was reporting.
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.error === null) return;
    if (keysChanged(prevProps.resetKeys, this.props.resetKeys)) this.reset();
  }

  reset = (): void => {
    this.setState({ error: null, componentStack: null, context: null });
  };

  render(): ReactNode {
    const { error, componentStack, context } = this.state;

    if (error !== null) {
      return (
        <ErrorFallback
          variant={this.props.variant}
          surface={this.props.surface}
          error={error}
          componentStack={componentStack}
          context={context}
          onRetry={this.reset}
          extraActions={this.props.extraActions}
        />
      );
    }

    return this.props.children;
  }
}
