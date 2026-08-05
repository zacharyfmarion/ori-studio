/** Public entry point for the analytics layer. Import from here, never from
 * `posthog-js` directly (see AGENTS.md → Common patterns → Analytics). */

export {
  ANALYTICS_EVENTS,
  bucketCount,
  COUNT_BUCKETS,
  DURATION_MS_BUCKETS,
} from './events';
export type {
  AnalyticsEventName,
  AnalyticsProperties,
  AnalyticsPropertyValue,
  AnalyticsErrorDomain,
  CommandGroup,
  DesignMethod,
  DesignVariant,
  ExportFormat,
  FoldedFormExportFormat,
  OptimizerKind,
  ProjectOpenSource,
  WorkspaceScreen,
} from './events';

export {
  AnalyticsRuntimeProvider,
  createAnalyticsApi,
  track,
  trackAnalyticsError,
  useAnalytics,
} from './runtime';
export type { AnalyticsApi, AnalyticsErrorContext } from './runtime';

export {
  getBootstrapSharedProperties,
  initializePostHog,
} from './bootstrap';
export type { BootstrapOptions, PostHogClientLike, PostHogEnvironment } from './bootstrap';

export { shouldCaptureBootstrapAnalytics } from './bootstrapPolicy';
export { clearStableId, getOrCreateStableId, peekStableId } from './stableId';
