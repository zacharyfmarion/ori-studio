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
 * Which register the `/welcome` landing page rendered in: the desktop start
 * screen, or the compact masthead a phone gets instead.
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

/** The landing page's calls to action. */
export type LandingCta = 'discord' | 'github' | 'scroll' | 'download';

/**
 * Which desktop build a download was started for.
 *
 * `releases-page` is not a build: it is the fallback every control falls back to
 * when the release could not be read (offline, rate-limited, blocked), and it is
 * in the same enum so the failure is *counted* rather than invisible. A ratio of
 * it against the real builds is the only signal that the GitHub fetch is not
 * working for a population.
 *
 * These mirror `DesktopBuildId` in `platform/desktopDownload.ts`; `trackDesktopDownload`
 * passes one straight through, so the two cannot drift without a type error.
 */
export type DesktopDownloadBuild =
  | 'macos-arm64'
  | 'macos-intel'
  | 'windows-x64'
  | 'linux-deb'
  | 'linux-appimage'
  | 'linux-deb-arm64'
  | 'linux-appimage-arm64'
  | 'releases-page';

/**
 * Where a download was started from.
 *
 * The question this exists to answer is whether the toolbar icon earns its place
 * in the workspace chrome, which no other property can express: a download from
 * `toolbar` came from somebody already using the app, and one from `landing`
 * from somebody deciding whether to.
 */
export type DesktopDownloadSurface = 'start-screen' | 'landing' | 'toolbar' | 'about';

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
 * - `located` — the user asked to be shown the vertex the refusal named.
 * - `cancelled` — the user declined that offer, or the CAMV warning.
 * - `halted` — the user stopped a fold that was already running.
 * - `error` — the kernel refused.
 *
 * `located` is its own value rather than a `cancelled`, and it is the one that
 * says whether pointing at the diagnostic entry was worth building: a user who
 * takes it did not give up, they went to fix the pattern. Folding it into
 * `cancelled` would make the feature unmeasurable by construction.
 *
 * `halted` is deliberately **not** merged into `cancelled`. Declining a dialog
 * takes a couple of hundred milliseconds and says the user changed their mind
 * before any work happened; halting says they waited — possibly for many minutes
 * — and gave up. Those are the two things this feature exists to tell apart, and
 * one value cannot.
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
  | 'located'
  | 'cancelled'
  | 'halted'
  | 'error'
  | 'local-crossing'
  | 'transversal-crossing'
  | 'no-layer-order';

/** Which way a press of the one solution verb moved. */
export type FoldCycleDirection = 'next' | 'wrap';

/** Where a foldability check was run from. */
export type FoldabilityCheckSource = 'pre-fold';

/** How a check-suppression region came to exist. */
export type CpSuppressionRegionSource = 'tool' | 'selection' | 'detect';

/**
 * Which of the exact solver's two stages a run reached.
 *
 * They behave completely differently and merging them would hide the one fact
 * that makes the wait tolerable: stage 1 fails fast (it is 4–21% of the wall)
 * and stage 2 only runs at all on a solve that would be accepted. A run that
 * ends in `geometry` is a refusal the user waited a moment for; one that ends in
 * `refinement` is a success they waited seconds to minutes for.
 */
export type CpExactSolveStage = 'geometry' | 'refinement';

/**
 * How an exact solve ended.
 *
 * `timeout` is separate from `rejected` because they mean opposite things to the
 * user: a rejection says the topology is wrong and editing is the way forward, a
 * timeout says the solve was going fine and ran out of clock, and only the
 * second one has a partial worth offering. They are told apart on
 * `movement_report.timed_out`, never by reading the reason string — that string
 * embeds a formatted number and is not a token.
 *
 * `malformed` is the shape with no `rejection_reasons` key at all: the solver
 * refused before running and reported `{status: "not_run", blockers: [...]}`, so
 * a UI reading only the reasons array would show "no reason".
 *
 * `ambiguous` is separate from `solved` because the two were the same number
 * until they weren't, and the difference is the feature's real success rate: the
 * solver accepted the answer but declined to call it exact, so the pattern still
 * fails the foldability check and the user still has repair work. Counted as
 * `solved` it made a run that cleared none of a file's seventy angle errors look
 * like a win.
 */
export type CpExactSolveVerdict =
  | 'solved'
  | 'ambiguous'
  | 'rejected'
  | 'timeout'
  | 'malformed'
  | 'error';

/**
 * The solver's `rejection_reasons` vocabulary, verbatim, plus the three endings
 * that carry no token — `timeout`, whose reason is a formatted string,
 * `malformed_input`, which has no reasons key, and `above_fold_precision`, which
 * is not a rejection at all but the explanation an `ambiguous` verdict needs.
 *
 * Sent as an enum because it is one: nine fixed tokens the compiler writes. The
 * blocker *messages* accompanying a malformed input are prose containing span
 * and vertex indices, and are never sent.
 */
export type CpExactSolveRejectionReason =
  | 'preflight_degenerate_edges'
  | 'preflight_boundary_failures'
  | 'candidate_status_failed'
  | 'movement_budget_exceeded'
  | 'odd_degree_vertices_worsened'
  | 'degenerate_edges_worsened'
  | 'unmodeled_crossings_worsened'
  | 'boundary_failures_worsened'
  | 'objective_not_improved'
  | 'timeout'
  | 'malformed_input'
  | 'above_fold_precision';

/**
 * What the user did with a finished solve.
 *
 * The question this exists to answer is whether the solve is *trusted*, which
 * the completion event cannot see: a solve that lands and is then reverted is a
 * failure of the feature however clean its residuals were. `accepted-partial` is
 * its own value rather than an `accepted`, because taking a timed-out partial is
 * a materially weaker endorsement than taking a completed solve, and merging
 * them would make the timeout path look as healthy as the successful one.
 */
export type CpExactSolveResolution = 'accepted' | 'accepted-partial' | 'retried';

/** How an image reached the Detect dialog. */
export type CpDetectImageSource = 'picker' | 'drop';

/** Where the Detect dialog stood when it was closed without importing. */
export type CpDetectDismissStage = 'upload' | 'crop' | 'detecting' | 'review';

/**
 * Why a detection did not complete.
 *
 * The first four are the model store's own codes — the download half of a
 * first run, which is where a CDN or a bucket problem shows up. `worker_lost`
 * is the runtime dying under the inference (a wasm trap, an OOM), and
 * `inference` is every other failure of the model run itself.
 */
export type CpDetectFailureReason =
  | 'registry_unavailable'
  | 'registry_invalid'
  | 'download_failed'
  | 'integrity'
  | 'worker_lost'
  | 'inference';

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

/**
 * The canvas a context menu was raised on.
 *
 * The surface, not the panel component: `tree` covers both tree canvases,
 * because they are one editor mounted twice and a menu opened on either is the
 * same fact about the same code.
 */
export type ContextMenuSurface =
  | 'crease-pattern'
  | 'bp-packing'
  | 'tree'
  | 'design-tree'
  | 'simulator';

/**
 * What the menu was raised *on*, coarsely.
 *
 * A closed vocabulary shared by every surface rather than each surface's own
 * primitive names: the question these menus exist to answer is whether people
 * right-click on things or on nothing, and one enum keeps that comparable
 * across canvases. `'empty'` is the interesting one — a menu raised on empty
 * space with a live selection is the flow this feature was built for.
 */
export type ContextMenuTargetKind =
  | 'empty'
  | 'selection'
  | 'crease'
  | 'point'
  | 'circle'
  | 'text'
  | 'image'
  | 'folded-figure'
  | 'flap'
  | 'river'
  | 'sheet'
  | 'node'
  | 'edge';

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
  /**
   * A context menu was raised on a canvas.
   *
   * The *open* is the event, not the item picked: an item that is one of the
   * app's commands already lands on `command invoked` at the `handleMenuAction`
   * chokepoint, and firing a second event for the same press would double-count
   * every verb these menus share with the menu bar. What the chokepoint cannot
   * say is that the menu was opened at all — including the opens that closed
   * again with nothing chosen, which is exactly the signal for whether the
   * menus offer the right verbs.
   *
   * Carries `surface`, `target_kind`, `has_selection`, `source` (pointer /
   * keyboard / touch), and a bucketed `item_count`.
   */
  contextMenuOpened: 'context menu opened',
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
  bpFlapResized: 'bp flap resized',
  /**
   * A check-suppression region was placed.
   *
   * Hand-placed because the `cp tool used` chokepoint cannot see it: that fires
   * inside `executeOristudioCpCommand`, and this tool commits web-side and never
   * reaches the kernel. `source` is the point — a region drawn by hand and one
   * created by a detection import are the same object doing two different jobs,
   * and only the first says anyone found the tool.
   */
  cpSuppressionRegionCreated: 'cp suppression region created',
  /**
   * An exact solve finished, however it finished.
   *
   * Distinct from the `command invoked` the chokepoint already captures for
   * `cp.exactSolve`: that counts intent, this counts outcome, and the gap
   * between the two is the feature's success rate. Carries the structured
   * properties the chokepoint cannot express — verdict, stage, reason, and
   * bucketed wall time.
   */
  cpExactSolveCompleted: 'cp exact solve completed',
  /**
   * The Accept / Try again gate was answered.
   *
   * The second half of the funnel. A solve that lands and is reverted is not a
   * success, and nothing before this event can tell the two apart.
   */
  cpExactSolveResolved: 'cp exact solve resolved',
  /**
   * The Image→CP funnel, in order. `command invoked` (`file.detectCpImage`)
   * opens the dialog; then an image is loaded, Detect is pressed, detection
   * completes, and the pattern is imported. A close at any point before the
   * import is a `cp detect dismissed` with the stage it happened at, so the
   * drop-off between any two steps is a count, not an inference.
   */
  cpDetectImageLoaded: 'cp detect image loaded',
  cpDetectStarted: 'cp detect started',
  cpDetectCompleted: 'cp detect completed',
  cpDetectImported: 'cp detect imported',
  cpDetectDismissed: 'cp detect dismissed',
  /**
   * A run the user stopped, on any of the three surfaces that start one.
   *
   * Deliberately **not** a sixth `verdict` on `cp exact solve completed`: that
   * event counts the four endings the solver reaches, and a stopped run reached
   * none of them — folding it in would put "the user pressed Stop" inside the
   * feature's failure rate. Carries `kind` (which surface), `stage` (how far it
   * got) and a bucketed wall time, which together answer the question the
   * mechanism was chosen for: are people stopping the long hard-bucket solves,
   * or the short ones.
   */
  cpDetectCancelled: 'cp detect cancelled',
  /** A detector model's bytes arrived and verified — the first run's, or an offered update's. */
  cpDetectModelDownloaded: 'cp detect model downloaded',
  /**
   * A download that was asked for by hand — Settings ▸ Models, or the dialog's
   * update offer — did not verify. A first run's download failing is a
   * `cp detect completed` with `succeeded: false` and the same code as its
   * reason, since that is the funnel step it broke.
   */
  cpDetectModelDownloadFailed: 'cp detect model download failed',
  foldSimulationRun: 'fold simulation run',
  foldedFormExported: 'folded form exported',
  foldWarningShown: 'fold warning shown',
  foldWarningAccepted: 'fold warning accepted',
  foldAttempted: 'fold attempted',
  foldCompleted: 'fold completed',
  foldSolutionCycled: 'fold solution cycled',
  foldedFigureOrbited: 'folded figure orbited',
  foldedFigureZoomed: 'folded figure zoomed',
  // Whether anyone reaches for a model up at all is the question this answers —
  // the orbit was a turntable about the paper's normal for every figure before
  // it, so a low count means standing models are rarer than assumed rather than
  // that the verb is hard to find.
  modelUprightSet: 'model upright set',
  /**
   * A view cube face was pressed. `face` is one of the six names, which is a
   * fixed enum and says nothing about the design — where the camera *was* is a
   * measured value about someone's model and stays out, as it does for
   * {@link ANALYTICS_EVENTS.modelUprightSet}.
   *
   * The question is which faces anyone actually uses: if it is only Top, the
   * cube is doing the job a "view from above" button would do more cheaply.
   */
  simulatorViewCubeSnapped: 'simulator view cube snapped',
  /**
   * A quarter turn about the line of sight, from the view cube's arrows.
   * `direction` is `cw` or `ccw` and says nothing about the design.
   *
   * Only the arrows are counted, not the Shift-drag beside them — an orbit drag
   * is not counted either, and a per-frame event would be noise. The question is
   * whether anyone finds the control at all.
   */
  simulatorViewRolled: 'simulator view rolled',
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
  /**
   * A desktop installer link was followed.
   *
   * "Started", not "completed": a link hand-off is the last thing the page can
   * see. What happens after — GitHub's redirect, the transfer, the install — is
   * off this origin entirely.
   */
  desktopDownloadStarted: 'desktop download started',
  orieditaShortcutsImported: 'oriedita shortcuts imported',
  orieditaShortcutsOverrideAll: 'oriedita shortcuts override all',
  shortcutDefaultsSourceChanged: 'shortcut defaults source changed',
  cpSnapRadiusChanged: 'cp snap radius changed',
  cpWheelGestureChanged: 'cp wheel gesture changed',
  /**
   * The touch-only View drawer was opened.
   *
   * Fires nowhere else: under a fine pointer the pane is docked and there is no
   * drawer to open, so this counts *touch* sessions that went looking for the
   * view options. That is the question undocking the pane raises — whether the
   * canvas width was bought at the cost of controls nobody finds again — and it
   * cannot be answered from `command invoked`, since no menu action reaches it.
   */
  viewDrawerOpened: 'view drawer opened',
  /**
   * The phone layout's tool sheet was opened.
   *
   * Phone-only, because that layout is the only one without a tool rail — so
   * every one of these is somebody who found the Tools pill, which is the whole
   * question replacing a visible rail with a button raises. No menu action
   * reaches it, so the `command invoked` chokepoint cannot see it, and `cp tool
   * used` counts what was picked rather than whether the surface was found.
   */
  cpToolPickerOpened: 'cp tool picker opened',
  /**
   * A crease-pattern tool was starred or un-starred.
   *
   * Fires in both directions on purpose. The question this exists to answer is
   * whether the shipped defaults were the right ones, and a star-only event
   * cannot see a default being *rejected* — which is the sharper signal of the
   * two, since the defaults arrive without anyone asking for them.
   *
   * `action` is a CP action id: an enum drawn from a fixed shipped catalogue,
   * the same class of value as `cp tool used`'s `operation`, and no more user
   * content than that one is.
   */
  cpToolFavorited: 'cp tool favorited',
  /**
   * A favorite was moved to a new position in the list.
   *
   * Once per completed gesture, never from the store's move — that runs at
   * pointer-move rate and would emit dozens of events per drag.
   *
   * Carries no `method`: long press and drag is the only route, so the property
   * would be a constant. It gets one back when a second surface offers a second
   * way, and not before.
   *
   * The question it answers is discoverability. The gesture has no visible
   * affordance at all, so this count against `cp tool picker opened` is the only
   * evidence that anyone finds it.
   */
  cpToolFavoritesReordered: 'cp tool favorites reordered',
  /**
   * The phone layout moved between a design's panes.
   *
   * Phone-only, because that layout is the only one that shows a design's panes
   * one at a time — everywhere else they are side by side and there is nothing
   * to switch. `pane` is the kind's own pane id (`tree` | `packing` |
   * `results` | `inspector` | …), which is its vocabulary rather than a panel
   * component name, so it survives a component rename.
   *
   * `source` separates the pill from everything else that can move the pane —
   * the BP long-press inspector, a View menu entry — because the question the
   * pill raises is whether people find it, and a switch it did not cause would
   * flatter the number.
   */
  designPaneSwitched: 'design pane switched',
  /**
   * The start screen's 3D figure declined to start, and the static image is
   * standing in.
   *
   * Only the *failure* is instrumented. A decoration rendering is not a funnel
   * step, and firing on every cold start would bury the one thing worth
   * knowing: how many people's machines cannot run any of the simulator's GPU
   * paths, which is the same capability the Simulate workspace needs.
   */
  startFigureFallback: 'start figure fallback',
  /**
   * Every completed update check, including the ones that find nothing.
   *
   * The heartbeat. Without it, "the endpoint has been unreachable for a month"
   * and "there was no release this month" produce identical dashboards — and
   * the failure mode of a silent updater is that nobody notices for a long
   * time. Alert on the *absence* of `result: 'available'` after arming a
   * release, not on the presence of an error.
   */
  appUpdateChecked: 'app update checked',
  appUpdateAvailable: 'app update available',
  appUpdateDownloadStarted: 'app update download started',
  appUpdateDownloaded: 'app update downloaded',
  appUpdateRelaunched: 'app update relaunched',
  appUpdateFailed: 'app update failed',
  appUpdateDismissed: 'app update dismissed',
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
 * Threshold ladder for how many CP tools someone has starred.
 *
 * Straddles {@link CP_DEFAULT_FAVORITE_ACTION_IDS} — five today — so the three
 * answers worth telling apart stay apart: fewer than shipped (they pruned), the
 * set they were given, and more (they are curating). The element ladder would
 * collapse all three into `<=10`.
 *
 * Retune it if the default count moves far, and know what that costs: buckets
 * are compared across releases, so a boundary that shifts makes the two sides of
 * the change incomparable. Cheap to get right now, before any of this has
 * shipped; expensive later.
 */
export const CP_FAVORITE_COUNT_BUCKETS = [0, 2, 5, 10, 20] as const;

/** Which surface a favorite was starred or moved from. */
export type CpFavoriteSurface = 'picker-sheet';

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

/**
 * Which bundle format an install can update itself from. Mirrors `InstallKind`
 * in `apps/tauri/src-tauri/src/updater.rs`.
 *
 * The point of carrying it is `other` — a Linux package install, which is
 * offered a download link rather than an in-place update. This is the only way
 * to measure what that restriction costs.
 */
export type UpdateInstallKind = 'app' | 'nsis' | 'appimage' | 'other';

/** What a completed update check found. */
export type UpdateCheckResult = 'none' | 'available' | 'error';

/** Whether the check ran on the app's schedule or because someone asked. */
export type UpdateTrigger = 'automatic' | 'manual';

/** The stage an update failed at. */
export type UpdateFailureStage = 'check' | 'download' | 'install';

/**
 * Why an update step failed.
 *
 * `signature` is the one worth alerting on: it means the payload did not verify
 * against the public key compiled into the app, which is either a corrupted
 * object or an attack, and — if it is a key mismatch — it is fleet-wide.
 * `stale_manifest` means the endpoint offered a version below one already seen.
 */
export type UpdateFailureReason =
  | 'network'
  | 'signature'
  | 'stale_manifest'
  | 'unsupported'
  | 'unknown';

/** How an offered update stopped being shown. */
export type UpdateDismissScope = 'skipped' | 'session' | 'revoked';

export const DURATION_MS_BUCKETS = [50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;

/**
 * Threshold ladder for how long an exact solve ran, in milliseconds.
 *
 * Shaped around the measured native population rather than around round numbers:
 * easy solves sit at a p50 of 0.36 s, medium at 3.5 s with a p90 of 12.5 s, and
 * the hard bucket essentially always hits the 25 s cap. {@link DURATION_MS_BUCKETS}
 * tops out at ten seconds, which puts a healthy medium solve and a run that gave
 * up in the same bucket — the one distinction this ladder exists to keep.
 *
 * The top threshold is the default timeout, so `>25000` should be empty. If it
 * fills, the browser is slower than the native measurements by enough that the
 * cap itself is the thing to revisit.
 */
export const CP_EXACT_SOLVE_MS_BUCKETS = [250, 1000, 2500, 5000, 10000, 15000, 25000] as const;

/**
 * One detector inference, from tensor to outputs. Spans a GPU's quarter second
 * to a single wasm thread's minute, which is the spread `cp detect completed`
 * exists to measure across devices.
 */
export const CP_DETECT_INFERENCE_MS_BUCKETS = [250, 500, 1000, 2500, 5000, 10000, 30000, 60000] as const;

/**
 * Threshold ladder for how long a fold ran, in milliseconds.
 *
 * {@link DURATION_MS_BUCKETS} tops out at ten seconds, which is where a fold
 * starts being interesting rather than where it stops: the runs worth knowing
 * about are the ones people sit through for minutes and then give up on. This
 * ladder is the only way to answer "how long do people tolerate", and it is put
 * on **every** verdict rather than only on `halted`, because that question is
 * meaningless without "how long do folds take when they finish".
 */
export const FOLD_DURATION_MS_BUCKETS = [
  1000, 5000, 15000, 60000, 300000, 900000, 3600000,
] as const;

/**
 * Threshold ladder for how long a downloaded update sat before the user
 * relaunched into it, in milliseconds.
 *
 * Hours to days, not seconds: the other ladders measure how long someone waits
 * for the app, and this measures how long the app waits for someone. It is the
 * metric that says whether the affordance works — an update that is staged for
 * a week is one the chip failed to communicate, and that is indistinguishable
 * from a healthy install unless it is measured.
 */
export const UPDATE_PENDING_MS_BUCKETS = [
  60000, 900000, 3600000, 14400000, 86400000, 259200000, 604800000,
] as const;
