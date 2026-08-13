/** Public entry point for the analytics layer. Import from here, never from
 * `posthog-js` directly (see AGENTS.md → Common patterns → Analytics). */

export {
  ANALYTICS_EVENTS,
  bucketCount,
  COUNT_BUCKETS,
  CP_SNAP_RADIUS_BUCKETS,
  DESIGN_TAB_COUNT_BUCKETS,
  DURATION_MS_BUCKETS,
  PACKING_CIRCLE_COUNT_BUCKETS,
} from './events';
export type {
  AnalyticsEventName,
  AnalyticsProperties,
  AnalyticsPropertyValue,
  AnalyticsErrorDomain,
  CommandGroup,
  DesignMethod,
  DesignTabSource,
  DesignVariant,
  ExportFormat,
  FoldabilityCheckSource,
  FoldCycleDirection,
  FoldedFormExportFormat,
  FoldMode,
  FoldSimulationSource,
  FoldVerdict,
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

export { trackDesignSentToEdit } from './trackSendToEdit';

export { useAppOpenedEvent } from './useAppOpenedEvent';
export { useBpPatternNotFoundEvent } from './useBpPatternNotFoundEvent';
export { useWorkspaceViewedEvent } from './useWorkspaceViewedEvent';

export {
  getBootstrapSharedProperties,
  initializePostHog,
} from './bootstrap';
export type { BootstrapOptions, PostHogClientLike, PostHogEnvironment } from './bootstrap';

export { clearStableId, getOrCreateStableId, peekStableId } from './stableId';
