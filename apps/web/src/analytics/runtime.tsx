/**
 * The analytics runtime: the one wrapper every event goes through.
 *
 * - `useAnalytics()` for components; `track` / `trackAnalyticsError` for non-React
 *   callers (menu dispatch, store slices) via a module-level singleton.
 * - Consent is enforced by PostHog's own opt-in/out state — `capture` is a no-op
 *   while opted out — plus a null client when analytics never initialized.
 * - Property hygiene is by discipline (enums + bucketed numbers), not scrubbing.
 */

import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { useLocaleStore } from '../store/localeStore';
import { useSettingsStore } from '../store/settingsStore';
import {
  fingerprintError,
  getBootstrapSharedProperties,
  getLocaleProperties,
  inferErrorDomain,
  type PostHogClientLike,
} from './bootstrap';
import type { AnalyticsErrorDomain, AnalyticsProperties } from './events';
import { clearStableId, getOrCreateStableId } from './stableId';

/** Repeated identical errors within this window collapse to a single event. */
const ERROR_DEDUPE_WINDOW_MS = 30_000;

export interface AnalyticsErrorContext {
  /** The thrown value; used to derive a fingerprint when one isn't supplied. */
  error?: unknown;
  /** What was being attempted, e.g. `'export'`, `'build cp'`. Enum-ish, no PII. */
  operation?: string;
  /** Which surface reported it, e.g. `'CreaseExportDialog'`. */
  sourceComponent?: string;
  /** Overrides the inferred domain. */
  domain?: AnalyticsErrorDomain;
  /** Whether the app recovered (true) or the error propagated (false). */
  handled?: boolean;
  /** Precomputed fingerprint; otherwise derived from `error`. */
  fingerprint?: string;
  /** Extra enum/bucketed properties. Never raw user content. */
  properties?: AnalyticsProperties;
}

export interface AnalyticsApi {
  track: (eventName: string, properties?: AnalyticsProperties) => void;
  trackError: (context: AnalyticsErrorContext) => void;
  setAnalyticsEnabled: (enabled: boolean, options?: { capturePreferenceChange?: boolean }) => void;
}

const NOOP_ANALYTICS: AnalyticsApi = {
  track: () => {},
  trackError: () => {},
  setAnalyticsEnabled: () => {},
};

/**
 * Build the API around a (possibly null) client. Stable for a given client, so
 * it can be memoized and stored once. Holds its own error-dedupe state.
 */
export function createAnalyticsApi(client: PostHogClientLike | null): AnalyticsApi {
  if (!client) return NOOP_ANALYTICS;

  const recentErrors = new Map<string, number>();

  return {
    track(eventName, properties) {
      // Opted-out capture is a no-op inside PostHog, so no consent check needed.
      client.capture(eventName, properties);
    },

    trackError(context) {
      const fingerprint = context.fingerprint ?? fingerprintError(context.error);
      const now = Date.now();

      // Dedupe per surface, not per error. One failure mode can break several
      // surfaces at once — a DOM teardown bug fingerprints identically whether
      // it hits the dock or a dialog — and keying on the fingerprint alone
      // collapsed those into a single event, hiding that it was happening in
      // more than one place. The fingerprint stays the reported property; only
      // the dedupe key is narrower.
      const dedupeKey = `${context.sourceComponent ?? ''}\u0000${fingerprint}`;

      // Drop a repeat of the same error inside the dedupe window; prune stale keys.
      const last = recentErrors.get(dedupeKey);
      if (last !== undefined && now - last < ERROR_DEDUPE_WINDOW_MS) return;
      for (const [key, ts] of recentErrors) {
        if (now - ts >= ERROR_DEDUPE_WINDOW_MS) recentErrors.delete(key);
      }
      recentErrors.set(dedupeKey, now);

      client.capture('app error', {
        error_domain: context.domain ?? inferErrorDomain(context.sourceComponent),
        operation: context.operation,
        source_component: context.sourceComponent,
        handled: context.handled ?? true,
        fingerprint,
        ...context.properties,
      });
    },

    setAnalyticsEnabled(enabled, options) {
      if (enabled) {
        client.opt_in_capturing({ captureEventName: false });
        client.identify(getOrCreateStableId());
        if (options?.capturePreferenceChange) {
          client.capture('analytics preference changed', {
            analytics_enabled: true,
            enabled: true,
          });
        }
      } else {
        // Send the opt-out event while still opted in, then forget identity.
        if (options?.capturePreferenceChange) {
          client.capture('analytics preference changed', {
            analytics_enabled: true,
            enabled: false,
          });
        }
        clearStableId();
        client.reset();
        client.opt_out_capturing();
      }
    },
  };
}

// --- Module-level singleton for non-React callers -------------------------

let runtimeAnalytics: AnalyticsApi = NOOP_ANALYTICS;

/** Emit an event from outside React (menu dispatch, store slices). */
export function track(eventName: string, properties?: AnalyticsProperties): void {
  runtimeAnalytics.track(eventName, properties);
}

/** Report an error from outside React. */
export function trackAnalyticsError(context: AnalyticsErrorContext): void {
  runtimeAnalytics.trackError(context);
}

// --- React context --------------------------------------------------------

const AnalyticsContext = createContext<AnalyticsApi>(NOOP_ANALYTICS);

/** The analytics API for components. No-ops when analytics is disabled/absent. */
export function useAnalytics(): AnalyticsApi {
  return useContext(AnalyticsContext);
}

export interface AnalyticsRuntimeProviderProps {
  /** The initialized PostHog client, or null when analytics never started. */
  client: PostHogClientLike | null;
  children: ReactNode;
}

/**
 * Wire the API into React and the module singleton, and keep PostHog's super
 * properties + consent state in sync with the settings store. The reactive sync
 * fires no preference-change event — that belongs to the settings toggle, which
 * calls `setAnalyticsEnabled(v, { capturePreferenceChange: true })` itself.
 */
export function AnalyticsRuntimeProvider({ client, children }: AnalyticsRuntimeProviderProps) {
  const analyticsEnabled = useSettingsStore((state) => state.analyticsEnabled);
  const locale = useLocaleStore((state) => state.locale);
  const localePreference = useLocaleStore((state) => state.preference);
  const api = useMemo(() => createAnalyticsApi(client), [client]);

  useLayoutEffect(() => {
    runtimeAnalytics = api;
    return () => {
      runtimeAnalytics = NOOP_ANALYTICS;
    };
  }, [api]);

  useLayoutEffect(() => {
    if (!client) return;
    client.register(getBootstrapSharedProperties({ analyticsEnabled }));
    api.setAnalyticsEnabled(analyticsEnabled);
  }, [client, api, analyticsEnabled]);

  // Bootstrap read the language from storage before React existed; from here on
  // the store is the live source, so a mid-session switch moves the person to
  // the new locale in the data instead of leaving them under the one they
  // launched in.
  useLayoutEffect(() => {
    client?.register(getLocaleProperties(locale, localePreference));
  }, [client, locale, localePreference]);

  return <AnalyticsContext.Provider value={api}>{children}</AnalyticsContext.Provider>;
}
