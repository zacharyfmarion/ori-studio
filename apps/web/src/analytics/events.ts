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
  cpDetectStarted: 'cp detect started',
  cpDetectCompleted: 'cp detect completed',
  cpDetectImported: 'cp detect imported',
  cpDetectCancelled: 'cp detect cancelled',
  foldSimulationRun: 'fold simulation run',
  foldedFormExported: 'folded form exported',
  foldWarningShown: 'fold warning shown',
  foldWarningAccepted: 'fold warning accepted',
  creasePatternShared: 'crease pattern shared',
  shareLinkCopied: 'share link copied',
  shareLinkOpened: 'share link opened',
  exploriSearch: 'explori search',
  exploriSearchFailed: 'explori search failed',
  exploriResultOpened: 'explori result opened',
  exploriSentToEdit: 'explori sent to edit',
  themeChanged: 'theme changed',
  localeChanged: 'locale changed',
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
