/**
 * The monitoring runtime: who is allowed to send, and the one way to report.
 *
 * Two pieces of module state, both deliberate:
 *
 * - `consented` is read by `beforeSend` on every event, so it must be correct
 *   from the first line of `main.tsx` — before React mounts and before this
 *   provider's effects run. `initializeSentry` seeds it; the provider then
 *   keeps it in step with the settings store.
 * - `activeClient` exists so non-React callers (the error boundary is a class,
 *   store slices are not components) have a way in, mirroring the analytics
 *   layer's module-level singleton.
 *
 * Consent here is the *same* switch as analytics — one privacy toggle governs
 * both — so opting out of usage analytics also stops crash reports.
 */

import { useLayoutEffect, type ReactNode } from 'react';
import { getOrCreateStableId } from '../analytics/stableId';
import { useSettingsStore } from '../store/settingsStore';
import type { SentryClientLike } from './types';

let activeClient: SentryClientLike | null = null;
let consented = false;

/** Read by `beforeSend`. The single gate that decides if anything is sent. */
export function isMonitoringConsented(): boolean {
  return consented;
}

/**
 * Bind the client the module-level reporters use. The provider calls this; so
 * do tests, which is why it is a plain function rather than provider-internal —
 * the consent gate is the security-relevant part of this layer and testing it
 * should not require mounting React.
 */
export function setMonitoringClient(client: SentryClientLike | null): void {
  activeClient = client;
}

export interface MonitoringErrorContext {
  /** Which surface reported it — `panel:crease-pattern`. Enum-ish, no PII. */
  surface?: string;
  /** React's component stack, when the caller is an error boundary. */
  componentStack?: string | null;
  /** Whether the app recovered (true) or the error propagated (false). */
  handled?: boolean;
  /**
   * Extra facts to tag the event with, as `scrub.ts` prescribes: a message is
   * redacted on the way out, so anything that has to stay readable in Sentry
   * travels as a bounded tag instead of as interpolated text.
   *
   * **Bounded values only** — an enum member, a bucket name, a capability
   * label. Never a filename, a path, a count, or anything measured off the
   * user's document. Tag *values* are indexed and searchable in Sentry, which
   * is the point and also why an unbounded one is worse here than in a message.
   */
  tags?: Readonly<Record<string, string>>;
}

/**
 * Report a caught error.
 *
 * Unhandled errors and rejections need no call here — Sentry's global handlers
 * already see those. This is for the ones we swallow on purpose, which are
 * invisible to Sentry precisely because a boundary did its job.
 */
export function reportError(error: unknown, context: MonitoringErrorContext = {}): void {
  if (!activeClient || !consented) return;
  try {
    activeClient.captureException(error, {
      mechanism: { type: 'generic', handled: context.handled ?? true },
      captureContext: {
        // `surface` last, so a caller's `tags` can never take the name over.
        tags: { ...context.tags, surface: context.surface ?? 'unknown' },
        contexts: context.componentStack
          ? { react: { component_stack: context.componentStack } }
          : undefined,
      },
    });
  } catch {
    // Reporting must never mask the error it was reporting.
  }
}

/**
 * Apply a consent decision.
 *
 * Opting out clears the breadcrumb buffer as well as the identity: breadcrumbs
 * accumulated while consent was on would otherwise ride along on the next event
 * after the user opts back in, carrying activity from across the boundary.
 */
export function setMonitoringEnabled(enabled: boolean): void {
  consented = enabled;
  if (!activeClient) return;

  if (enabled) {
    // The same anonymous id the analytics layer identifies with, so a crash and
    // a session are correlatable without either one knowing who the user is.
    activeClient.setUser({ id: getOrCreateStableId() });
  } else {
    activeClient.setUser(null);
    activeClient.getCurrentScope().clearBreadcrumbs();
  }
}

export interface MonitoringRuntimeProviderProps {
  /** The initialized Sentry namespace, or null when monitoring never started. */
  client: SentryClientLike | null;
  children: ReactNode;
}

/**
 * Bind the client and keep consent in step with the settings store.
 *
 * Renders children untouched — there is no context to provide, because the
 * error boundary that reports is a class component and reaches the runtime
 * through the module singleton instead.
 */
export function MonitoringRuntimeProvider({ client, children }: MonitoringRuntimeProviderProps) {
  const analyticsEnabled = useSettingsStore((state) => state.analyticsEnabled);

  useLayoutEffect(() => {
    setMonitoringClient(client);
    return () => {
      setMonitoringClient(null);
    };
  }, [client]);

  useLayoutEffect(() => {
    setMonitoringEnabled(analyticsEnabled);
  }, [client, analyticsEnabled]);

  return <>{children}</>;
}
