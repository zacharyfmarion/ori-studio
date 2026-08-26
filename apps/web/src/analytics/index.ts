/** Public entry point for the analytics layer. Import from here, never from
 * `posthog-js` directly (see AGENTS.md → Common patterns → Analytics). */

export {
  ANALYTICS_EVENTS,
  bucketCount,
  COUNT_BUCKETS,
  CP_FAVORITE_COUNT_BUCKETS,
  CP_SNAP_RADIUS_BUCKETS,
  DESIGN_TAB_COUNT_BUCKETS,
  DURATION_MS_BUCKETS,
  FOLD_DURATION_MS_BUCKETS,
  PACKING_CIRCLE_COUNT_BUCKETS,
  UPDATE_PENDING_MS_BUCKETS,
} from './events';
export type {
  AnalyticsEventName,
  AnalyticsProperties,
  AnalyticsPropertyValue,
  AnalyticsErrorDomain,
  CommandGroup,
  CpFavoriteReorderMethod,
  CpFavoriteSurface,
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
  LandingCta,
  LandingFeatureId,
  LandingSectionId,
  LandingSurface,
  OptimizerKind,
  ProjectOpenSource,
  UpdateCheckResult,
  UpdateDismissScope,
  UpdateFailureReason,
  UpdateFailureStage,
  UpdateInstallKind,
  UpdateTrigger,
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
  trackCpToolFavorited,
  trackCpToolFavoritesReordered,
} from './trackCpToolFavorites';
export { trackDesignSentToEdit } from './trackSendToEdit';

export { useAppOpenedEvent } from './useAppOpenedEvent';
export { useBpPatternNotFoundEvent } from './useBpPatternNotFoundEvent';
export {
  useLandingSectionViewedEvents,
  useLandingViewedEvent,
} from './useLandingViewedEvent';
export { useWorkspaceViewedEvent } from './useWorkspaceViewedEvent';

export {
  getBootstrapSharedProperties,
  initializePostHog,
} from './bootstrap';
export type { BootstrapOptions, PostHogClientLike, PostHogEnvironment } from './bootstrap';

export { clearStableId, getOrCreateStableId, peekStableId } from './stableId';
