/** Public entry point for the monitoring layer. Import from here, never from
 * `@sentry/react` directly (see AGENTS.md → Common patterns → Monitoring). */

export { initializeSentry } from './bootstrap';
export type { MonitoringBootstrapOptions } from './bootstrap';

export {
  isMonitoringConsented,
  MonitoringRuntimeProvider,
  reportError,
  setMonitoringClient,
  setMonitoringEnabled,
} from './runtime';
export type { MonitoringErrorContext } from './runtime';

export { scrubBreadcrumb, scrubEvent, scrubUrl } from './scrub';

export type { SentryClientLike, SentryEnvironment, SentryScopeLike } from './types';
