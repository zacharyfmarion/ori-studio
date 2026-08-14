/**
 * The analytics taxonomy: event names, the enum property values they carry, and
 * the bucketing helper that keeps numeric properties low-cardinality.
 *
 * Naming contract (mirrors AGENTS.md and docs/analytics.md): event names are
 * lowercase, space-separated; property keys are snake_case; property *values*
 * are only enums or bucketed strings — never raw user content (text-tool text,
 * filenames/paths, geometry/coordinates, node/edge data, image data).
 */

/** The value types a property may hold. Objects are intentionally excluded. */
export type AnalyticsPropertyValue = string | number | boolean | null | undefined | string[];
export type AnalyticsProperties = Record<string, AnalyticsPropertyValue>;

// ---------------------------------------------------------------------------
// Enum property values
// ---------------------------------------------------------------------------

/** The three top-level workspaces, plus the share screen. */
export type WorkspaceScreen = 'design' | 'edit' | 'simulate' | 'share';
/**
 * A Design workspace's method, for the events that describe *one* design.
 *
 * No longer reported on `workspace viewed`: the workspace can hold a
 * circle-packed design beside a box-pleat one, so it has no single method, and
 * claiming one would be a lie a funnel then gets built on.
 */
export type DesignVariant = 'nux' | 'treemaker' | 'box-pleat' | 'explori';
export type DesignMethod = 'treemaker' | 'box-pleat' | 'explori';

/** How a design tab came into being. */
export type DesignTabSource = 'strip' | 'duplicate' | 'file' | 'replace-last';

/** Where a project came from when it was opened. */
export type ProjectOpenSource = 'file' | 'example' | 'new' | 'drop' | 'share';

/**
 * Which register the `/welcome` landing page rendered in: the start screen, or
 * the desktop-only notice a phone gets instead.
 */
export type LandingSurface = 'desktop' | 'phone';

/** The landing sections below the fold, in page order. */
export type LandingSectionId =
  | 'what'
  | 'edit'
  | 'design'
  | 'simulate'
  | 'compatibility'
  | 'get';

/**
 * The landing page's calls to action.
 *
 * No download: the desktop build is not released, so the page does not offer one.
 */
export type LandingCta = 'discord' | 'github' | 'scroll';

/**
 * A feature slide in one of the landing carousels.
 *
 * Which of these people open is the page's most direct read on what the audience
 * actually came for, so the ids are stable and deliberately specific.
 */
export type LandingFeatureId =
  | 'edit-angles'
  | 'edit-media'
  | 'edit-foldability'
  | 'edit-share'
  | 'design-treemaker'
  | 'design-bp'
  | 'design-explori';

/** Export target formats (the file's kind only — never its name or contents). */
export type ExportFormat =
  | 'osf'
  | 'tm5'
  | 'tm4'
  | 'cp'
  | 'fold'
  | 'bps'
  | 'ori'
  | 'orh'
  | 'svg'
  | 'png';

/** Formats the folded-form (simulator) export offers. */
export type FoldedFormExportFormat = 'fold' | 'obj' | 'stl';

/** TreeMaker optimizer variants. */
export type OptimizerKind = 'scale' | 'edges' | 'strain';

/**
 * What a press of `G` was asking for, decided from the **scoped** selection
 * alone — never from the document.
 *
 * `spatial` is the selection the flat folder has no answer for: at least one
 * selected crease carries a fold angle other than a full mountain or valley, so
 * the fold goes to the computed 3D folder.
 *
 * No dashboard union is needed across the 3D change: `fold attempted` had no
 * call site before this feature — it existed only as a name in
 * {@link ANALYTICS_EVENTS} — so no build ever sent an earlier spelling of this
 * value.
 */
export type FoldMode = 'flat' | 'spatial';

/**
 * How a fold ended. Every one of these is a terminal branch of
 * `foldOristudioCpDocument`, so `fold attempted` and `fold completed` pair up
 * exactly.
 *
 * - `folded` — a figure was produced and it draws.
 * - `no-solutions` — the layer search ran and found no valid ordering.
 * - `contradiction` — two faces each have to lie above the other. Not an error:
 *   the transparent development still renders, with the pair highlighted.
 * - `not-drawable` — the fold returned, and there was nothing to draw.
 * - `simulated` — the user accepted the offer to simulate instead.
 * - `cancelled` — the user declined that offer, or the CAMV warning.
 * - `error` — the kernel refused.
 *
 * The last three are `spatial` only, and each says something a placed 3D figure
 * still is: it drew, and this is what is true about it.
 *
 * - `local-crossing` — the paper passes through itself at some vertex.
 * - `transversal-crossing` — a folded crease passes through a face.
 * - `no-layer-order` — placed, but no stacking could be computed.
 */
export type FoldVerdict =
  | 'folded'
  | 'no-solutions'
  | 'contradiction'
  | 'not-drawable'
  | 'simulated'
  | 'cancelled'
  | 'error'
  | 'local-crossing'
  | 'transversal-crossing'
  | 'no-layer-order';

/** Which way a press of the one solution verb moved. */
export type FoldCycleDirection = 'next' | 'wrap';

/** Where a foldability check was run from. */
export type FoldabilityCheckSource = 'pre-fold';

/**
 * Where a simulator run was started from.
 *
 * `fold-3d-refused` is the *fold* offer — the 3D gate would not accept the
 * pattern at all. `fold-3d-no-layer-order` is the *verdict* offer — a figure
 * that placed and drew, whose layers could not be ordered — which is a
 * different thing, and the two must not be merged.
 *
 * Both are new: `fold simulation run` had no call site before this feature, so
 * nothing older is in the data to reconcile with.
 */
export type FoldSimulationSource =
  | 'fold-3d-refused'
  | 'fold-3d-no-layer-order';

/** The coarse group a command id belongs to (derived from its id prefix). */
export type CommandGroup =
  | 'file'
  | 'edit'
  | 'view'
  | 'cp'
  | 'bp'
  | 'optimize'
  | 'help'
  | 'other';

/** Where an error was surfaced, for `app error` bucketing. */
export type AnalyticsErrorDomain =
  | 'bootstrap'
  | 'runtime'
  | 'render'
  | 'file_io'
  | 'settings'
  | 'panel';

// ---------------------------------------------------------------------------
// Event names
// ---------------------------------------------------------------------------

/**
 * Hand-placed event names. The two chokepoint events (`command invoked`,
 * `cp tool used`) and `app opened` / `app error` also flow through `track`, but
 * these constants cover the Phase-4 domain events call sites reference by name.
 */
export const ANALYTICS_EVENTS = {
  appOpened: 'app opened',
  appError: 'app error',
  analyticsPreferenceChanged: 'analytics preference changed',
  commandInvoked: 'command invoked',
  cpToolUsed: 'cp tool used',
  workspaceViewed: 'workspace viewed',
  creasePatternBuilt: 'crease pattern built',
  optimizerRun: 'optimizer run',
  projectOpened: 'project opened',
  projectSaved: 'project saved',
  fileExported: 'file exported',
  foldabilityChecked: 'foldability checked',
  foldabilityFixApplied: 'foldability fix applied',
  foldAnglesSolved: 'fold angles solved',
  designMethodChosen: 'design method chosen',
  designTabOpened: 'design tab opened',
  designTabClosed: 'design tab closed',
  designTabRenamed: 'design tab renamed',
  designTabReordered: 'design tab reordered',
  designTabActivated: 'design tab activated',
  bpDesignAction: 'bp design action',
  bpOptimizerRun: 'bp optimizer run',
  bpPatternNotFound: 'bp pattern not found',
  cpDetectStarted: 'cp detect started',
  cpDetectCompleted: 'cp detect completed',
  cpDetectImported: 'cp detect imported',
  cpDetectCancelled: 'cp detect cancelled',
  foldSimulationRun: 'fold simulation run',
  foldedFormExported: 'folded form exported',
  foldWarningShown: 'fold warning shown',
  foldWarningAccepted: 'fold warning accepted',
  foldAttempted: 'fold attempted',
  foldCompleted: 'fold completed',
  foldSolutionCycled: 'fold solution cycled',
  foldedFigureOrbited: 'folded figure orbited',
  foldedFigureZoomed: 'folded figure zoomed',
  foldedFigureRehydrated: 'folded figure rehydrated',
  creasePatternShared: 'crease pattern shared',
  shareLinkCopied: 'share link copied',
  shareLinkOpened: 'share link opened',
  exploriSearch: 'explori search',
  exploriSearchFailed: 'explori search failed',
  exploriResultOpened: 'explori result opened',
  exploriSentToEdit: 'explori sent to edit',
  designSentToEdit: 'design sent to edit',
  themeChanged: 'theme changed',
  localeChanged: 'locale changed',
  landingViewed: 'landing viewed',
  landingSectionViewed: 'landing section viewed',
  landingFeatureOpened: 'landing feature opened',
  landingCtaClicked: 'landing cta clicked',
  mobileBlockShown: 'mobile block shown',
  mobileBlockBypassed: 'mobile block bypassed',
  orieditaShortcutsImported: 'oriedita shortcuts imported',
  orieditaShortcutsOverrideAll: 'oriedita shortcuts override all',
  shortcutDefaultsSourceChanged: 'shortcut defaults source changed',
  cpSnapRadiusChanged: 'cp snap radius changed',
  cpWheelGestureChanged: 'cp wheel gesture changed',
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

/**
 * Map a raw number to a bounded bucket label so we never ship a high-cardinality
 * (and potentially identifying) exact count. `thresholds` must be ascending;
 * returns `"<=t"` for the first threshold `t` the value fits under, else `">last"`.
 *
 * `bucketCount(37, [20, 80, 200]) === "<=80"`; `bucketCount(500, [20, 80, 200]) === ">200"`.
 */
export function bucketCount(value: number, thresholds: readonly number[]): string {
  for (const threshold of thresholds) {
    if (value <= threshold) return `<=${threshold}`;
  }
  const last = thresholds[thresholds.length - 1];
  return `>${last}`;
}

/** Default threshold ladder for element counts (nodes, lines, etc.). */
export const COUNT_BUCKETS = [1, 5, 10, 20, 50, 100, 200, 500] as const;

/**
 * Threshold ladder for how many designs are open at once.
 *
 * Much tighter than {@link COUNT_BUCKETS}: the question is "does anyone use more
 * than one, and how many", and a ladder that starts at 1 and 5 answers it. The
 * element ladder would put every realistic workspace in the same bucket.
 */
export const DESIGN_TAB_COUNT_BUCKETS = [1, 2, 3, 5, 10] as const;

/**
 * Threshold ladder for how many stretches in one packing found no pattern.
 *
 * Tighter than {@link COUNT_BUCKETS} for the same reason as the design-tab
 * ladder: the interesting question is "one isolated overlap, or a design that is
 * broadly unsupported", and the element ladder puts both in `<=5`.
 */
export const BP_PATTERNLESS_STRETCH_BUCKETS = [1, 2, 4, 8] as const;

/**
 * Threshold ladder for how many packing circles a Send to Edit carried.
 *
 * Tighter than {@link COUNT_BUCKETS} because the question is about flap counts,
 * not element counts: a design with more than ~20 flaps is already unusual, and
 * the element ladder would put nearly every real design in `<=20`.
 *
 * Zero is its own bucket and is the one worth watching — a box-pleat design
 * whose flaps all have width or height sends no circles at all, and if that is
 * common the action needs to say so rather than appearing to do nothing.
 */
export const PACKING_CIRCLE_COUNT_BUCKETS = [0, 2, 4, 8, 16, 32] as const;

/**
 * Threshold ladder for the crease-pattern snap radius, in Oriedita model units.
 *
 * Spans the slider (2-100) rather than any element count, and the interesting
 * reading is *direction*: `<=2` / `<=5` is someone asking for a tighter radius
 * than the default 10, `<=20` and above someone asking for a more forgiving one
 * — the touch case the setting was requested for. The default sits at the top of
 * `<=10`, which costs nothing, because the event fires only when the value
 * actually changes: it existing at all already means the default was left.
 */
export const CP_SNAP_RADIUS_BUCKETS = [2, 5, 10, 20, 50] as const;

/** Default threshold ladder for durations, in milliseconds. */
/**
 * Where a Send to Edit came from.
 *
 * The whole reason the quick action exists is the belief that the detail view is
 * a detour most of the time; this is the property that says whether that is true.
 */
export type ExploriSendSource = 'card' | 'detail';

/** Why a search did not produce results. An enum — never the server's prose. */
export type ExploriFailureReason =
  | 'network'
  | 'timeout'
  | 'upstream_error'
  | 'invalid_tree'
  | 'rate_limited'
  | 'unknown';

export const DURATION_MS_BUCKETS = [50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;
