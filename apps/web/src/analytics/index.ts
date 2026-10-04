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
  CommunityLinkSurface,
  ContextMenuSurface,
  ContextMenuTargetKind,
  CpFavoriteSurface,
  CreasePatternFoldedFigure,
  DesignMethod,
  DesignTabSource,
  DesignVariant,
  DesktopDownloadBuild,
  DesktopDownloadSurface,
  DiagramPictureExportFormat,
  DiagramPictureFormat,
  DiagramCaptureKind,
  DiagramCaptureOutcome,
  DiagramCaptureVia,
  DiagramPictureKind,
  DiagramPictureUploadOutcome,
  DiagramPoseAction,
  DiagramPageSetting,
  DiagramSourceWorkspace,
  DiagramStepOpenedVia,
  DiagramStyleChoiceName,
  DiagramView,
  DiagramPulledInto,
  DiagramPulledMode,
  DiagramStepAddedSource,
  DiagramStepAddedVia,
  DiagramTurnAddedVia,
  DiagramStepOpenedMode,
  DiagramShowAsName,
  DiagramShowAsVia,
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
  SitePageViewedId,
  LandingSurface,
  OptimizerKind,
  PaperExportBackground,
  PaperExportFormat,
  PaperExportHiddenFaces,
  PaperExportLastSave,
  PaperExportResolution,
  PaperExportScope,
  PaperExportSlotStyleName,
  PaperExportStyleName,
  PaperExportSurface,
  PaperOverrideSurface,
  PaperPresetExportSource,
  PaperPresetName,
  PaperPresetUnsavedChoice,
  PaperSlotStyleName,
  PaperStyleEditSource,
  PaperStyleFieldName,
  ProjectOpenSource,
  ReferenceExactnessClass,
  ReferenceQueryOutcome,
  ReferenceRefusalReason,
  ReferenceTargetKind,
  SettingsSectionName,
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
export { trackCommunityLink } from './trackCommunityLink';
export { trackDesignSentToEdit } from './trackSendToEdit';
export {
  trackDiagramPictureCaptured,
  trackDiagramStepShownAs,
  trackDiagramExported,
  trackDiagramPictureExported,
  trackDiagramAnnotationAdded,
  trackDiagramArrowShaped,
  trackDiagramPicturePosed,
  trackDiagramPictureRemoved,
  trackDiagramSourceOpened,
  trackDiagramReferencesBrowserOpened,
  trackDiagramStepsPulledFromReferences,
  trackDiagramPictureUploaded,
  trackDiagramStepAdded,
  trackDiagramTurnAdded,
  trackDiagramStepOpened,
  trackDiagramPageSetupChanged,
  trackDiagramViewSwitched,
} from './trackDiagram';
export { trackDesktopDownload } from './trackDesktopDownload';
export { trackCreasePatternExported } from './trackCreasePatternExport';
export {
  trackPaperExportDismissed,
  trackPaperExported,
  trackPaperExportFailed,
  trackPaperExportOpened,
  type PaperExportedEvent,
} from './trackPaperExport';
export { trackSymmetryPairChanged, type SymmetryPairAction } from './trackSymmetryPairChanged';

export { useAppOpenedEvent } from './useAppOpenedEvent';
export { useBpPatternNotFoundEvent } from './useBpPatternNotFoundEvent';
export {
  useLandingSectionViewedEvents,
  useLandingViewedEvent,
} from './useLandingViewedEvent';
export { useWorkspaceViewedEvent } from './useWorkspaceViewedEvent';
export { useSettingsSectionViewedEvent } from './useSettingsSectionViewedEvent';
export {
  useReferencesWaysExploredEvent,
  type ReferencesWaysVisitCard,
} from './useReferencesWaysExploredEvent';
export { useSitePageViewedEvent } from './useSitePageViewedEvent';

export {
  getBootstrapSharedProperties,
  initializePostHog,
} from './bootstrap';
export type { BootstrapOptions, PostHogClientLike, PostHogEnvironment } from './bootstrap';

export { clearStableId, getOrCreateStableId, peekStableId } from './stableId';
export { consumeInternalUserFlag, isInternalUser } from './internalUser';
