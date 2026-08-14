/**
 * The slice of the Sentry SDK this layer uses.
 *
 * Declared structurally, and passed in rather than imported, for the same
 * reason the analytics layer injects its PostHog client: tests drive
 * `initializeSentry` with a fake and assert the exact config, with no network
 * and no global SDK state. `main.tsx` supplies the real namespace.
 */

export interface SentryScopeLike {
  clearBreadcrumbs(): unknown;
}

export interface SentryClientLike {
  init(options: Record<string, unknown>): unknown;
  captureException(exception: unknown, hint?: Record<string, unknown>): string;
  setUser(user: { id: string } | null): unknown;
  getCurrentScope(): SentryScopeLike;
}

/** The build-time env values init reads. Injectable for tests. */
export interface SentryEnvironment {
  VITE_PUBLIC_SENTRY_DSN?: string;
  VITE_PUBLIC_SENTRY_ENVIRONMENT?: string;
  DEV?: boolean;
}
