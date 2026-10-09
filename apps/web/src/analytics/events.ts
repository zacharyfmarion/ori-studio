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

/**
 * Where a diagram step's picture came from when it was added (D18 of the
 * Diagram plan). `empty` is a step added with nothing in it yet.
 */
export type DiagramStepAddedSource =
  | 'empty'
  | 'references'
  | 'svg'
  | 'raster';

/**
 * Which control added a diagram step. `grid` is the Diagram workspace's own:
 * the header's Add step, the empty state, and Insert before / after.
 */
export type DiagramStepAddedVia =
  | 'grid'
  | 'references'
  | 'drop'
  | 'batch';

/** What a turn between steps is (D22). */
export type DiagramTurnAddedKind = 'turn_over' | 'rotate';

/**
 * Where a turn between steps was made: Add step ▾ in the header, a step's
 * menu (Insert … After), or pulled from References with its turn-over card.
 */
export type DiagramTurnAddedVia = 'add_menu' | 'card_menu' | 'references' | 'empty_step';

/** An uploaded picture's file type, by its reported type and extension: never its name. */
export type DiagramPictureFormat = 'svg' | 'png' | 'jpeg' | 'webp' | 'other';

/**
 * What became of one uploaded file. `flattened` was added, but sanitizing
 * changed its look (a mask, a filter, flowed text); the rest were not added:
 * past a size cap, an SVG the sanitizer refused, not a picture at all, or a
 * bitmap that would not decode.
 */
export type DiagramPictureUploadOutcome =
  | 'ok'
  | 'flattened'
  | 'too_large'
  | 'rejected'
  | 'unsupported'
  | 'unreadable';

/**
 * How a step was opened in detail: Enter, a double-click on its card, one of
 * the card's own buttons, a step verb (its context menu or the Step pane), or
 * a double-click on an enlarge arrow in the Pages view, which opens the step
 * its area is on (Revision 2).
 */
export type DiagramStepOpenedVia = 'keyboard' | 'double_click' | 'card' | 'command' | 'pose_again' | 'enlarge_arrow';

/** Which half of the detail a step opened in. */
export type DiagramStepOpenedMode = 'pose' | 'annotate';

/** The tool an annotation was drawn with: its kind, in the event's own spelling. */
export type DiagramAnnotationTool =
  | 'valley_arrow'
  | 'mountain_arrow'
  | 'fold_unfold_arrow'
  | 'pleat_arrow'
  | 'push_arrow'
  | 'white_arrow'
  | 'solid_arrow'
  | 'turn_over'
  | 'rotate'
  | 'valley_line'
  | 'mountain_line'
  | 'hidden_line'
  | 'solid_line'
  | 'label'
  | 'circle'
  | 'star'
  | 'eye'
  | 'oval'
  | 'rectangle'
  | 'right_angle'
  | 'callout'
  | 'angle_mark'
  | 'angle_bisector'
  | 'divisions'
  | 'close_up'
  | 'enlarge'
  | 'enlarge_frame';

/** A star's fill, by name (Revision 3): filled with ink, or an outline, white inside. */
export type DiagramStarFillName = 'filled' | 'outline';

/**
 * How a new annotation was put down (decision 9): snapped to a point of the
 * picture or another mark (either end, for a line), put down freely with ⌘
 * (Ctrl) held, with the Step pane's Snap switch off, with nothing near enough
 * — or a kind that never snaps (an arrow, a sign, a label; arrows snapped
 * until 2026-10-05).
 */
export type DiagramAnnotationSnap = 'snapped' | 'free' | 'off' | 'nothing_near' | 'none';

/**
 * How equal divisions were laid (Revision 2, ED1): dragged from one end of a
 * line to the other, or put on a line of the picture or a drawn one with a
 * click, which divides it whole.
 */
export type DiagramDivisionsPlaced = 'drag' | 'line';

/**
 * A mark's colour, by name (17a): the style's ink (none stored), References'
 * magenta, one of the five print colours, or one picked by hand. Never the
 * colour itself.
 */
export type DiagramAnnotationColor = 'ink' | 'reference' | 'red' | 'orange' | 'green' | 'blue' | 'purple' | 'custom';

/** One of a label's options on or off (17b): Bold, a halo. */
export type DiagramTextToggle = 'on' | 'off';

/**
 * A label's size, by name (17b): with the picture (none in pt), one of the
 * four Size offers, or another a file brought. Never the size itself.
 */
export type DiagramTextSize = 'picture' | '7' | '9' | '12' | '16' | 'other';

/** Which of a label's options the Layers pane changed (17b). */
export type DiagramTextStyleOption = 'bold' | 'halo' | 'size';

/**
 * Which of a mark's own options changed (Revision 3): equal divisions' Short
 * Dividers; a star's Fill; and a star's, an eye's, an oval's or a
 * rectangle's size or turn — by its transform box on the canvas, or its turn
 * typed in the Layers pane's Rotation row. The later marks' options join it.
 */
export type DiagramMarkStyleOption = 'short_dividers' | 'fill' | 'size' | 'rotation';

/**
 * What a mark's option became, or how it was changed (Revision 3): a switch
 * on or off; a star filled or an outline; a size or a turn set by the
 * transform box's handles (`handle`) or typed in its row (`field`).
 */
export type DiagramMarkStyleValue = 'on' | 'off' | DiagramStarFillName | 'handle' | 'field';

/** A fold arrow or a white arrow, which Edit Path shapes: its kind, in the event's own spelling. */
export type DiagramShapedArrowKind = 'valley_arrow' | 'mountain_arrow' | 'fold_unfold_arrow' | 'white_arrow';

/**
 * Which half of a fold-and-unfold arrow the edit that first shaped it
 * touched: its outgoing path (the tip included) or its return.
 */
export type DiagramShapedArrowHalf = 'out' | 'return';

/**
 * The Edit Path gesture that first shaped an arrow — an arc made a path, a
 * straight white arrow bent: a node dragged, a handle dragged, the curve
 * bent, a node added (a click on the curve or Add Node), a node made smooth
 * or a corner, a node taken out, or a node nudged with the arrow keys.
 */
/**
 * Which ends of a mark were first put behind a flap (15e): its tail (a line's
 * start), its tip (a line's end), both, or a circle's whole ring.
 */
export type DiagramBehindEnds = 'tail' | 'tip' | 'both' | 'whole';

/**
 * How an enlarged step got its frame (Revision 2): Pose's Enlarged turned on,
 * a new step after an enlarged one whose first picture lands the frame it
 * was seeded with, or Update Enlarged Steps on the area it came from.
 */
export type DiagramStepEnlargedVia = 'toggle' | 'seeded' | 'update';

/**
 * Where a capture put an enlarged step's frame: through an anchor face, through
 * a crease pattern's sheet, or copied in picture units (a step with no faces).
 */
export type DiagramStepEnlargedPlaced = 'face' | 'sheet' | 'picture';

/** The anchor a frame was placed by: the default rule's, a picked one, or none (copied in picture units). */
export type DiagramStepEnlargedAnchor = 'auto' | 'picked' | 'none';

/** An enlarge area's, or an enlarged step's frame's, shape. */
export type DiagramEnlargeShape = 'circle' | 'rounded';

/** What an enlargement edit was made on: an enlarge area, or an enlarged step's frame. */
export type DiagramEnlargementOn = 'area' | 'frame';

/** Which of an enlargement's settings changed: moved or resized by hand, its Shape, Size, Edge or Anchor, or the area deleted. */
export type DiagramEnlargementSetting = 'moved' | 'shape' | 'size' | 'edge' | 'anchor' | 'deleted';

/** What the setting became: the shape, Fill or a fixed Size, Cut or Whole, the anchor's rule. */
export type DiagramEnlargementValue =
  | 'circle'
  | 'rounded'
  | 'fill'
  | 'fixed'
  | 'cut'
  | 'whole'
  | 'auto'
  | 'picked';

/** A fixed Size, bucketed: never the value. */
export const DIAGRAM_ENLARGE_SIZE_BUCKETS = [1.5, 2, 3, 6] as const;

/** How many layers lie over an end put behind a flap: one, two, or three and more. */
export type DiagramBehindLayers = '1' | '2' | '3+';

/** Which way a mark was flipped in Annotate: left to right, or top to bottom. */
export type DiagramFlipAxis = 'horizontal' | 'vertical';

export type DiagramArrowShapeGesture =
  | 'drag_node'
  | 'drag_handle'
  | 'bend'
  | 'add_node'
  | 'node_type'
  | 'delete_node'
  | 'nudge';

/**
 * A pose verb: on an uploaded picture (rotate, flip, reset), or on a linked one
 * (show it as its crease pattern, folded or simulated, turn it over, step to
 * another layer order, look from a named side, orbit the 3D view, bring
 * Pose's simulator to rest at a fold % and camera, or spread a flat fold's
 * layers: on, off, the other kind, another amount or direction, or an affine
 * spread's other layer held still, skew or axis; or put a crease pattern's
 * paper on the colour of one side).
 */
export type DiagramPoseAction =
  | 'rotate_left'
  | 'rotate_right'
  | 'flip'
  | 'reset'
  // Pose's Enlarged turned off (Revision 2): turning it on is `diagram step enlarged`.
  | 'enlarge_off'
  | 'show_crease_pattern'
  | 'show_folded'
  | 'turn_over'
  | 'next_solution'
  | 'previous_solution'
  | 'choose_way'
  | 'view_top'
  | 'view_front'
  | 'view_iso'
  | 'orbit'
  | 'rotate_to'
  | 'upright'
  | 'show_simulated'
  | 'simulate'
  | 'spread_on'
  | 'spread_off'
  | 'spread_kind'
  | 'spread_amount'
  | 'spread_direction'
  | 'spread_keep'
  | 'spread_skew'
  | 'spread_axis'
  | 'paper_side';

/**
 * A side of the paper, for `diagram picture posed`: the one a picture shows
 * after `turn_over` (a flat fold, a 3D one or a References step), or the one
 * whose colour a crease pattern's paper takes after `paper_side` (the Step
 * pane's Front | Back).
 */
export type DiagramPictureSide = 'front' | 'back';

/** How a flat fold's layers are spread (13g): stepped by depth, or DEFOX's affine opening. */
export type DiagramSpreadKind = 'depth' | 'affine';

/** Which layer an affine spread holds still, as the front sees it. */
export type DiagramSpreadKeep = 'top' | 'bottom';

/**
 * How a spread verb left a fold's layers, for `diagram picture posed`: its
 * kind and amount, and a depth spread's direction or an affine one's layer
 * held still, skew and axis. The numbers are bucketed when sent.
 */
export type DiagramSpreadTracking =
  | { kind: 'depth'; direction: DiagramSpreadDirection; amount: number }
  | { kind: 'affine'; amount: number; keep: DiagramSpreadKeep; skew: number; axisDeg: number };

/** Where a flat fold's deeper layers step to, on the screen (Phase 13), in the event's own spelling. */
export type DiagramSpreadDirection =
  | 'up_left'
  | 'up'
  | 'up_right'
  | 'right'
  | 'down_right'
  | 'down'
  | 'down_left'
  | 'left';

/**
 * How far a spread goes, in percent — of the model for a depth spread, of the
 * way back to the sheet along its axis for an affine one — bucketed: `<=2.5` (the depth
 * default), `<=7.5` (the affine default, 3%), `<=12.5`, `>12.5`. Never the value.
 */
export const DIAGRAM_SPREAD_PERCENT_BUCKETS = [2.5, 7.5, 12.5] as const;

/** An affine spread's skew, in percent: none, some, most, all (the default). Never the value. */
export const DIAGRAM_SPREAD_SKEW_PERCENT_BUCKETS = [0, 50, 99] as const;

/** An affine spread's axis, in degrees, by quarter of its half turn (the default 81° is `<=90`). Never the value. */
export const DIAGRAM_SPREAD_AXIS_DEGREE_BUCKETS = [45, 90, 135] as const;

/**
 * What a step's picture is: an upload, by what it is stored as, or a capture
 * from the crease pattern, by how it shows it.
 */
export type DiagramPictureKind = 'svg' | 'raster' | 'references' | DiagramCaptureKind;

/** How a captured picture shows its pattern. */
export type DiagramCaptureKind = 'crease_pattern' | 'flat' | '3d' | 'simulated';

/**
 * What became of a capture: kept (`rasterized` when too detailed to keep as
 * vector, `no_layer_order` when the fold could not be ordered), or not: the 3D
 * folder refused the creases, the user stopped it, or it failed.
 */
export type DiagramCaptureOutcome =
  | 'ok'
  | 'no_layer_order'
  | 'rasterized'
  | 'refused'
  | 'stopped'
  | 'failed';

/**
 * Which flow captured a picture: linking a step, relinking it, Refresh on one
 * step, or Refresh all. A Pose verb is `diagram picture posed`.
 */
export type DiagramCaptureVia = 'link' | 'relink' | 'refresh' | 'refresh_all' | 'show_as' | 'duplicate_as';

/** A way a linked step shows its pattern (D19), in the event's own spelling. */
export type DiagramShowAsName = 'crease_pattern' | 'folded' | 'simulated';

/**
 * Where a linked step was shown another way: the Step pane's Show as row, the
 * pattern picker's, or the card's Show as and Duplicate as menus. Pose's own
 * switch is counted by `diagram picture posed`.
 */
export type DiagramShowAsVia = 'pane' | 'picker' | 'card' | 'duplicate';

/** The workspace a diagram step's Open in… went to: its pattern in Edit, or its sheet in References. */
export type DiagramSourceWorkspace = 'edit' | 'references';

/** The list the References browser pulled cards from: a planned pattern's sequence, or the Find answer. */
export type DiagramPulledMode = 'sequence' | 'find';

/**
 * Where the References browser adds cards, fixed as it opens: after a step,
 * at the end, into an empty step, or in place of a References step's card.
 */
export type DiagramPulledInto = 'after' | 'end' | 'fill' | 'replace';

/**
 * Whether a pull's marks were lifted into annotations (17d) or left in the
 * picture, as every card was before: `baked` when any card's marks were more
 * than a step holds.
 */
export type DiagramPulledMarks = 'lifted' | 'baked';

/** What an edit did to a mark a References card brought (17d): changed for the first time, or taken away. */
export type DiagramImportedMarkEdit = 'changed' | 'deleted';

/**
 * Where Make Marks Editable was pressed (17e): the notice Annotate shows on a
 * step whose card's marks are in its picture — in the Step pane, or over the
 * Layers pane's list — the Step pane's Picture section, or the step card's menu.
 */
export type DiagramMarksLiftedVia = 'annotate_notice' | 'layers_notice' | 'step_pane' | 'card_menu';

/** The file Export picture… wrote. */
export type DiagramPictureExportFormat = 'svg' | 'png' | 'jpeg';

/** What the Diagram's export wrote: one PDF of the pages, one SVG of them laid out in spreads, or a ZIP of the steps' own files. */
export type DiagramExportFormat = 'pdf' | 'svg' | 'zip';

/** Who a diagram's PDF is for: a printer at home, or a print shop (bleed, page boxes and crop marks). */
export type DiagramPdfPreset = 'home' | 'print_shop';

/** The Diagram's two views: the steps as cards, or the printed pages. */
export type DiagramView = 'steps' | 'pages';

/** Which page setting changed in the Page pane (D10). `scale` is retired: every diagram fits each since 2026-10-06. */
export type DiagramPageSetting =
  | 'size'
  | 'orientation'
  | 'margin'
  | 'layout'
  | 'columns'
  | 'rows'
  | 'path'
  | 'path_width'
  | 'path_color'
  | 'first_page_side'
  | 'title'
  | 'page_numbers'
  | 'first_page'
  | 'style'
  | 'han_style';

/** A diagram style as chosen: a built-in by id, the Settings export style, or a saved preset (`custom`). */
export type DiagramStyleChoiceName = 'default' | 'diagram' | 'export-style' | 'custom';

/** The five top-level workspaces, plus the share screen. */
export type WorkspaceScreen = 'design' | 'edit' | 'simulate' | 'references' | 'diagram' | 'share';
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
export type LandingCta = 'discord' | 'github' | 'scroll' | 'download' | 'start';

/**
 * Where a link out to the community Discord was followed from.
 *
 * One value, because the landing page's own Discord link is already counted as a
 * `landing cta clicked` with `cta: 'discord'` and must not be counted twice. This
 * event exists for the links the landing page's funnel cannot see — today the
 * workspace toolbar, which is somebody already inside the app going looking for
 * other people, a different act entirely from a visitor deciding to.
 */
export type CommunityLinkSurface = 'toolbar';

/**
 * Which desktop build a download was started for.
 *
 * `releases-page` is not a build: it is the link a control carries when it has
 * no file to hand over, and it is in the same enum so that case is *counted*
 * rather than invisible. It has two causes, which {@link DesktopDownloadFallbackReason}
 * tells apart; only one of them is the GitHub fetch failing.
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
 * Why a download went to the releases page instead of a file. Sent only with
 * `build: 'releases-page'`.
 *
 * - `no_platform`: the release was read, but there is nothing to recommend for
 *   this device — a phone, a tablet, or a host whose user agent names no desktop
 *   OS. The control is working as designed.
 * - `release_unresolved`: no builds were known yet — the GitHub lookup had not
 *   answered, or had failed (offline, rate-limited, blocked). The ratio of this
 *   one against real builds is the signal that the fetch is not working.
 *
 * Before this existed the two were one number, and the phones made it look like
 * GitHub was failing half the landing page's visitors.
 */
export type DesktopDownloadFallbackReason = 'no_platform' | 'release_unresolved';

/**
 * Where a download was started from.
 *
 * The question this exists to answer is whether the toolbar icon earns its place
 * in the workspace chrome, which no other property can express: a download from
 * `toolbar` came from somebody already using the app, and one from `landing`
 * from somebody deciding whether to.
 */
export type DesktopDownloadSurface =
  | 'start-screen'
  | 'landing'
  | 'toolbar'
  | 'about'
  | 'download-page';

/**
 * A page of the site — the landing's siblings, not the app's workspaces.
 *
 * The landing itself reports as `landing viewed`, which predates these pages and carries
 * a `surface` this one does not need; it is not folded in here so its history stays
 * comparable. Kept in step with `SitePageId` by the `viewed` hook's parameter type.
 */
export type SitePageViewedId = 'download' | 'oriedita' | 'faq';

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
  | 'png'
  | 'zip'
  | 'pdf';

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

/**
 * Which appearance setting a folded figure's Style menu changed.
 *
 * One value per adjustment: a colour drag counts once, when it starts, never
 * per pointer move — and never with the colour, which is the user's work. The
 * question is which of the six rows earn their place, not what anyone chose.
 */
export type FoldedFigureStyleOption =
  | 'display_style'
  | 'side'
  | 'front_color'
  | 'back_color'
  | 'line_color'
  | 'shadow';

/**
 * Which slot of the app-wide paper style an edit went to: what is drawn on
 * screen, or what an export draws when the user has set it apart.
 */
export type PaperStyleSlot = 'display' | 'export';

/**
 * The style field an edit touched, by its path. A fixed list — never a value:
 * a colour, a pen width or a light angle is the user's work. The question is
 * which fields anyone reaches for, and whether the export slot ever gets set
 * apart from display.
 *
 * Written out here rather than derived from the style's own field list, so the
 * taxonomy stays a leaf with no app imports; a test pins the two lists equal,
 * so a field added to the style cannot go uncounted.
 */
export const PAPER_STYLE_FIELD_NAMES = [
  'paper.front',
  'paper.back',
  'edges',
  'mountainFolds',
  'valleyFolds',
  'mountainDiagramCreases',
  'valleyDiagramCreases',
  'foldsAsEdges',
  'auxCreases.visible',
  'auxCreases.pen',
  'arrows',
  'erode',
  'light',
] as const;

export type PaperStyleFieldName = (typeof PAPER_STYLE_FIELD_NAMES)[number];

/**
 * Which preset was applied: a built-in by id, or `custom` for any preset the
 * user saved or imported — never its name, which is theirs.
 */
export type PaperPresetName = 'default' | 'diagram' | 'custom';

/** What the user did with unsaved edits a preset would have replaced. */
export type PaperPresetUnsavedChoice = 'save' | 'update' | 'discard' | 'cancel';

/** Where a preset file was written from: Export… under the list, or a card's own download. */
export type PaperPresetExportSource = 'button' | 'card';

/**
 * Where an edit to the app-wide paper style was made: Settings ▸ Paper, the
 * Simulate options pane (docked, or in the touch View drawer — the name
 * `view drawer opened` gives it), or the Simulate viewport's own verbs, its
 * lighting key binding and context-menu row.
 */
export type PaperStyleEditSource = 'settings' | 'simulator-view-controls' | 'simulator';

/**
 * The style a slot runs, for the population rather than for an edit: a
 * built-in by id, `custom` for a preset the user saved or imported, unedited,
 * or `unsaved` for a style no saved preset holds — edited since its preset was
 * applied, or nobody's.
 */
export type PaperSlotStyleName = PaperPresetName | 'unsaved';

/** The export slot's style, which reads `linked` while it follows display. */
export type PaperExportSlotStyleName = PaperSlotStyleName | 'linked';

/**
 * How the last press of Export ended, for a dialog closed without a file:
 * never pressed, the save dialog dismissed, the save failed, or the dialog
 * closed while a ZIP's pages were still painting.
 */
export type PaperExportLastSave = 'none' | 'cancelled' | 'failed' | 'stopped';

/**
 * The sections of the Settings dialog, by the store's ids. Written out here
 * so the taxonomy stays a leaf with no app imports; a test pins it to
 * `SettingsTab` both ways.
 */
export type SettingsSectionName = 'general' | 'appearance' | 'paper' | 'shortcuts' | 'workspace';

/** The surfaces a document object can pin a paper-style field on. */
export type PaperOverrideSurface = 'inline-simulation' | 'folded-3d' | 'folded-flat';

/** The surfaces that export a paper picture through the shared painter. */
export type PaperExportSurface =
  | 'simulator'
  | 'inline-simulation'
  | 'folded-3d'
  | 'folded-flat'
  | 'references';

/** A paper export's image format — the file's kind only, never its name. */
export type PaperExportFormat = 'svg' | 'png';

/** Whether an export kept the faces no pixel of the page shows (D4 in the plan). */
export type PaperExportHiddenFaces = 'kept' | 'dropped';

/** Which style a paper export was painted with: the Settings export slot, or a preset by kind. */
export type PaperExportStyleName = 'export-style' | PaperPresetName;

/** A paper export's page background: none, or a colour — never which colour. */
export type PaperExportBackground = 'transparent' | 'colour';

/** A PNG's density as the export dialog's picker names it; `none` for an SVG. */
export type PaperExportResolution = '1x' | '2x' | '3x' | '4x' | '300' | '600' | 'custom' | 'none';

/** The folded figure beside a crease pattern: the style it was drawn in, or none. */
export type CreasePatternFoldedFigure = 'none' | PaperExportStyleName;

/** Which of a surface's pages an export wrote: the one on show, or every one as a ZIP. */
export type PaperExportScope = 'this' | 'all';

/** Whether a page carried one of a diagram's optional marks — a References step's letters or reference lines. */
export type PaperExportMarkShown = 'shown' | 'hidden';

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
export type CpDetectImageSource = 'picker' | 'drop' | 'canvas-suggestion';

/** The likelihood gate's verdict on an image added to the canvas. */
export type CpDetectLikelihoodVerdict = 'likely' | 'unlikely';

/**
 * The gate's probability, bucketed. The operating threshold is 0.8, so the
 * `0.8-0.9` and `0.9+` buckets are the offers and the two below are the
 * near-misses worth knowing the size of.
 */
export function cpDetectScoreBucket(score: number): string {
  if (score < 0.5) return '<0.5';
  if (score < 0.8) return '0.5-0.8';
  if (score < 0.9) return '0.8-0.9';
  return '0.9+';
}

/** Where the Detect dialog stood when it was closed without importing. */
export type CpDetectDismissStage = 'upload' | 'confirm' | 'crop' | 'detecting' | 'review';

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
  | 'simulator'
  | 'references'
  | 'diagram';

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
  | 'step'
  | 'crease'
  | 'point'
  | 'circle'
  | 'text'
  | 'image'
  | 'region'
  | 'folded-figure'
  | 'flap'
  | 'river'
  | 'sheet'
  | 'node'
  | 'edge';

/**
 * What a picked reference was, on the References workspace's events.
 * `whole_cp` is the breakdown, which is not picked but asked for.
 */
export type ReferenceTargetKind = 'vertex' | 'crease' | 'whole_cp';

/** How the exactness probe classified the pattern a breakdown was made of. */
export type ReferenceExactnessClass = 'exact' | 'snappable' | 'off_lattice';

/**
 * Why a breakdown produced no sequence. `non_rectangular` is D10's refusal,
 * `point_cap` the `|P|` ceiling, `budget` the run's own clock,
 * `too_many_approximations` a plan that stopped rather than fold more lines
 * by references than a sequence can carry.
 */
export type ReferenceRefusalReason =
  | 'non_rectangular'
  | 'point_cap'
  | 'budget'
  | 'too_many_approximations'
  | 'error';

/**
 * How a ReferenceFinder query ended. `exact` when any construction lands on
 * the target (`err <= 1e-9`), `approximate` when only near ones came back,
 * `none` for an empty answer, `error` for a worker or extractor failure.
 */
export type ReferenceQueryOutcome = 'exact' | 'approximate' | 'none' | 'error';

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
  /**
   * A section of the Settings dialog was on show: the one it opened on, then
   * each one picked. `section` is the section's id. Fired from the dialog, so
   * every way in counts — the toolbar's gear calls the store directly and never
   * reaches the `command invoked` chokepoint. Who saw Settings ▸ Paper is the
   * denominator the paper style's events are read against.
   */
  settingsSectionViewed: 'settings section viewed',
  /**
   * References workspace (`implementation-plans/reference-finder-integration.md`).
   * `reference target picked` is the pick itself — a vertex or a crease in the
   * References view; `reference query completed` is ReferenceFinder's answer
   * to it, with the outcome and a bucketed duration; `folding steps opened` is
   * a step list actually being shown for a target. All carry `target_kind`
   * (`vertex` / `crease`; Phase 5 adds `whole_cp`). Nothing about *which*
   * vertex or crease — a coordinate is the user's geometry.
   */
  referenceTargetPicked: 'reference target picked',
  referenceQueryCompleted: 'reference query completed',
  foldingStepsOpened: 'folding steps opened',
  /**
   * A whole-pattern breakdown run, however it ended: `completed` when the
   * planner produced a sequence, `cancelled` when a Stop landed, `refused`
   * when it could not (a non-rectangular sheet, the point cap, or a run
   * ceiling — which the sequence no longer sets, so that one is a driver's).
   *
   * Carries only enums and bucketed counts: `target_kind`, `lines_bucket`,
   * `aux_bucket`, `visible_aux_bucket`, `turn_overs_bucket`,
   * `mixed_steps_bucket`, `duration_bucket`, `exactness_class`, `grid_kind`
   * (`box` / `hex` / `none` — whether the plan opened with a precrease grid),
   * `grid_lines_bucket`, `grid_steps_bucket`, `grid_unwanted_bucket` (crease
   * the grid put where the pattern has none, in tenths of a sheet-length),
   * `reach_bucket` (crease the steps made past the pattern's own to end at
   * references, likewise), `dangling_folds` (`allowed` / `disallowed` — the
   * "Allow dangling folds" setting the plan was made under),
   * `symmetric_steps` (`merged` / `separate` — the "Merge symmetric steps"
   * setting, likewise), `cards_with_ways_bucket` (how many cards offer
   * another way to fold them) and, on a refusal, `refusal_reason`.
   * Never a fold
   * count, a line, a coordinate or anything else derived from the user's
   * geometry — the shape of a design is the design.
   */
  foldingStepsCompleted: 'folding steps completed',
  foldingStepsCancelled: 'folding steps cancelled',
  foldingStepsRefused: 'folding steps refused',
  /**
   * The References workspace looked in the plan cache — the plans saved with
   * a project, and the sheets planned this session — for the sheet it is about
   * to show, and found an entry for it. `outcome` is `hit` when the entry was
   * the plan wanted and was shown without planning, or which part of its key
   * said no: `planner_changed` (a release since), `settings_changed`, or
   * `sheet_changed` (the sheet's creases, or their numbering, moved). Whether
   * the cache earns its bytes in the file, and why it misses. Nothing about the
   * plan or the sheet.
   */
  referencesPlanRestored: 'references plan restored',
  /**
   * A CP-wide analysis finished. `unreachable_bucket` is how many of the
   * pattern's distinct lines the closure could not reach and ReferenceFinder
   * was asked about — the number that says whether the closure-first ordering
   * is doing the work the plan claims it does.
   */
  referenceBatchCompleted: 'reference batch completed',
  /**
   * A pattern's detail — the steps and the canvas — was opened from the
   * References list on a phone.
   *
   * Phone-only, because that is the one layout that shows the list and the
   * detail one at a time; everywhere else the detail is always on screen and
   * there is nothing to open. So every one of these is a phone session that got
   * past the list to the folds, which is the question putting the list first
   * raises. `source` is which press did it: a pattern's card, or a finding in
   * the notes under the cards.
   */
  referencesPatternOpened: 'references pattern opened',
  /**
   * The reader switched the References workspace between its two jobs —
   * finding one reference, or reading the precreasing sequence. `mode` is the
   * one switched *to* (`find` / `sequence`) and `source` what did it: the tab,
   * or the lead's line under the tabs that names the other job. The workspace
   * lands in Find and plans only when asked, so this is how often the sequence
   * is asked for at all, and whether the tab or the line is how it is found.
   */
  referencesModeChanged: 'references mode changed',
  /**
   * A tap on the sheet in Sequence mode moved the strip to the step that
   * made what was tapped. `target_kind` is `crease` or `vertex`; nothing
   * about which one, which would be the user's geometry.
   */
  referencesStepJumped: 'references step jumped',
  /**
   * A step's fold was set moving in the References workspace. `trigger` is
   * `user` (the button, Space or the menu row) or `auto` (the setting);
   * `direction` is `fold` or `unfold`; `step_kind` is `cp`, `aux`, `press`,
   * `turn_over` or `reference` (a ReferenceFinder step in the Find tab),
   * `tab` is `find` or `sequence`, and `way` — only on a card that offers
   * other ways to fold it — is `recommended` or `alternative`, so a way the
   * reader chose and then watched is told from one only glanced at. A pause is
   * not counted. Nothing about the fold itself.
   */
  referencesFoldPlayed: 'references fold played',
  /**
   * The reader looked at the other ways to fold a card of the sequence and
   * moved on: once per visit to a card on which they changed the way, sent as
   * they leave it, and never again for the same card of the same plan unless
   * they settle on a different way. `settled` is `recommended` (they looked
   * and kept the planner's pick) or `alternative`; `from_kind` is the pick's
   * kind of fold and `to_kind` the settled way's — the planner's codes, axiom
   * and the kinds of reference it lines up (`O2:cp`, a corner onto a mark);
   * `decided_by` is the criterion of the planner's ranking the pick won on
   * against the settled way (`none` when they kept the pick); `ways` and
   * `viewed` how many were offered and looked at; `step_kind` `cp`, `aux`
   * or `press`; `twin` whether it was a card of two mirrored folds. Which
   * picks readers overrule, and on which rule, is how the ranking gets
   * adjusted. Metadata about how the app folds one step — never a line, a
   * reference, a coordinate or a step number.
   */
  referencesWaysExplored: 'references ways explored',
  /** The "Auto-play folds" preference was switched; `enabled` is `on` / `off`. */
  referencesFoldAutoplayChanged: 'references fold autoplay changed',
  /**
   * The References "Show auxiliary creases" option was set; `shown` is `on` /
   * `off`, or `style` when it was reset to follow the paper style.
   */
  referencesAuxCreasesChanged: 'references aux creases changed',
  /**
   * The modal that warns that a precreasing sequence contains approximated
   * folds was shown — once per plan whose steps are not all exact, or that
   * stopped rather than approximate more lines than a sequence can carry.
   * Carries `reason` (`inexact` / `too_many`), `inexact_steps_bucket` (how
   * many steps are approximate or sighted from an approximation) and
   * `exactness_class`, so how often readers are warned, of what, and on
   * which class of pattern, is measurable. Nothing about the folds.
   */
  referencesApproximationWarningShown: 'references approximation warning shown',
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
   * A mirror pairing was made or broken by hand.
   *
   * Hand-placed because the three verbs — Pair with mirror, Pair all mirrored,
   * Unpair from mirror — are toolbar and context-menu rows that call the store
   * directly, so the `command invoked` chokepoint never sees them. Shared by
   * the box-pleat and ExplOri trees, which have the same verbs over the same
   * pairing model; `design_kind` says which. `pair_count_bucket` is bucketed
   * and everything else is an enum: no ids, no positions.
   */
  symmetryPairChanged: 'symmetry pair changed',
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
   * opens the dialog; then an image is loaded, its rights are confirmed,
   * Detect is pressed, detection completes, and the pattern is imported. A
   * close at any point before the import is a `cp detect dismissed` with the
   * stage it happened at, so the drop-off between any two steps is a count,
   * not an inference.
   */
  cpDetectImageLoaded: 'cp detect image loaded',
  /**
   * The canvas entry to the same funnel. Every reference image added to the
   * Edit canvas is scored by the likelihood gate (`scored`, the denominator);
   * the ones that clear the threshold show the pill (`suggested`); the pill is
   * either taken (`accepted`, which then produces a `cp detect image loaded`
   * with `source: 'canvas-suggestion'`) or closed (`dismissed`). `scored`
   * carries a bucketed score and verdict only — the field false-positive rate
   * is read off the acceptance rate per bucket, never off the image.
   */
  cpDetectImageScored: 'cp detect image scored',
  cpDetectSuggested: 'cp detect suggested',
  cpDetectSuggestionAccepted: 'cp detect suggestion accepted',
  cpDetectSuggestionDismissed: 'cp detect suggestion dismissed',
  /**
   * The rights gate between an image loading and Detect was answered:
   * `accepted` is Continue, and `false` is Back. A close at the gate is a
   * `cp detect dismissed` at stage `confirm` instead, the same split the
   * dialog makes everywhere between abandoning and declining. No "shown"
   * event: every `cp detect image loaded` shows it.
   */
  cpDetectRightsAnswered: 'cp detect rights answered',
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
  foldedFigureStyled: 'folded figure styled',
  /**
   * A field of the app-wide paper style was edited. `source` is where:
   * Settings ▸ Paper, the Simulate options pane's Paper and Creases rows, or the
   * Simulate viewport's lighting verb. `slot` is `display` or `export`, `field`
   * the field's path. Once per adjustment: a colour drag counts when it starts,
   * never per pointer move, and never with the value. The question is which
   * fields earn their rows, from where, and whether the export slot is ever set
   * apart from display.
   */
  paperStyleChanged: 'paper style changed',
  /**
   * A whole preset was applied to a slot. `preset` is a built-in's id or
   * `custom` for a saved or imported one — never its name. Whether the
   * built-ins cover what people want is what a high `custom` share answers.
   */
  paperPresetApplied: 'paper preset applied',
  /**
   * A preset was picked while the slot held unsaved edits, and the user was
   * asked what to do with them. `choice` is `save` (kept as a preset of their
   * own first), `update` (written into the saved preset they were made to),
   * `discard` or `cancel`. How often edits are thrown away versus kept is what
   * says whether the prompt earns its interruption.
   */
  paperPresetUnsavedChanges: 'paper preset unsaved changes',
  /**
   * A saved preset was overwritten with the slot's edits to it — from the Update
   * beside Revert, or the unsaved-changes prompt's Update. Only ever a preset
   * the user saved or imported: a built-in cannot be. The question is whether
   * people keep a preset of their own and refine it, or save a new one each
   * time.
   */
  paperPresetUpdated: 'paper preset updated',
  /**
   * A preset was written to a `.json` file from Settings ▸ Paper. `source` is
   * `button` for Export… under the list, which writes the style the slot is
   * showing, or `card` for a card's own download. `preset` is a built-in's id
   * or `custom` — never the name — and `unsaved` marks an Export… of a style
   * no saved preset holds, named for the file there. Button against card says
   * whether the hover-only icon was ever how people found export. The file
   * service's `file exported` fires for the same save.
   */
  paperPresetExported: 'paper preset exported',
  /**
   * The slot's style was kept as a preset of the user's own, under a name they
   * gave — never the name. From Save current as…, or the save the unsaved-
   * changes prompt leads to. With `paper preset applied { preset: custom }`
   * it says whether the presets people make get used again.
   */
  paperPresetSaved: 'paper preset saved',
  /**
   * A preset file was read in Settings ▸ Paper: `succeeded`, or not, with the
   * parser's own `reason` (`invalid-json` / `not-a-preset`). A dismissed file
   * picker counts nothing. A read preset is added to the list, and applying it
   * then counts as `paper preset applied { preset: custom }`.
   */
  paperPresetImported: 'paper preset imported',
  /**
   * The export slot was detached from the display style (`linked: false`) or
   * set to follow it again (`linked: true`). Whether anyone wants exports to
   * look different from the screen at all.
   */
  paperExportLinkChanged: 'paper export link changed',
  /**
   * A document object had a paper-style field pinned, or the pin cleared
   * (`reset: true`), from its Properties sheet or the folded Style menu.
   * `surface` says which kind of object, `field` which row. Per-object pins
   * are the case D1 in the plan was designed around; this is how often it
   * happens at all.
   */
  paperStyleOverridden: 'paper style overridden',
  /**
   * A paper surface's view went out through the shared painter as an SVG or
   * PNG. `surface` says which, `format` which file, `hidden_faces` whether the
   * buried faces were kept — the default, and the setting D4 exists for;
   * `letters` and `highlights`, for References alone, whether the step's
   * letters and reference lines were on the page. The file service's
   * `file exported` fires too; this one carries what that chokepoint cannot
   * see.
   */
  paperExported: 'paper exported',
  /**
   * The export dialog opened on a paper surface's picture — the first step of
   * the funnel whose last is `paper exported`. Its triggers are toolbar and
   * context-menu verbs the menu chokepoint does not see.
   */
  paperExportOpened: 'paper export opened',
  /**
   * The reader closed the export dialog without writing a file — the funnel's
   * other ending, so every dialog the reader ends is one `paper exported` or
   * one of these. `last_save` is how the last press of Export went: `none`,
   * `cancelled` (the save dialog was dismissed), `failed`, or `stopped` (closed
   * while a ZIP's pages were still painting). Changed their mind, against
   * something in the way.
   */
  paperExportDismissed: 'paper export dismissed',
  /**
   * A save from the export dialog threw. The dialog shows the message and stays
   * open; this counts it, by `surface`, `format` and `scope`, and the error
   * itself goes to Sentry. Never the message.
   */
  paperExportFailed: 'paper export failed',
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
  /**
   * A pattern's detail — the simulator — was opened from the Simulate list on
   * a phone. {@link ANALYTICS_EVENTS.referencesPatternOpened}'s twin, and
   * phone-only for the same reason: that is the one layout that shows the list
   * and the simulator one at a time, and only a document with more than one
   * pattern has a list at all. No `source`: a card is the only press that opens
   * it.
   */
  simulatorPatternOpened: 'simulator pattern opened',
  /**
   * The Simulate canvas's tool changed. `tool` is the catalogue's id and
   * `source` where it was picked; a press on the tool already in hand changes
   * nothing and sends nothing. Escape is a source of its own, because it is how
   * people leave Pin, and how often they do says whether they want to.
   */
  simulatorToolSelected: 'simulator tool selected',
  /**
   * The phone layout's Simulate tool sheet was opened: whether people find the
   * Tools pill that stands in for the rail. Kept apart from Edit's
   * `cp tool picker opened`, which dashboards compare across releases.
   */
  simulatorToolPickerOpened: 'simulator tool picker opened',
  /**
   * A Pin gesture finished: once per box or click, never per pointer move.
   * `gesture`, `mode` and `depth` are enums; `outcome` says whether it found
   * nothing, changed the set, or found only what was pinned; the set's size
   * after travels as a bucket. `depth` is how the "through all layers" option
   * gets used. Face ids, coordinates and exact counts are never sent.
   */
  simulatorPinsEdited: 'simulator pins edited',
  /**
   * An explicit Clear emptied a non-empty pin set, with the size before as a
   * bucket. A gesture that empties the set is `simulator pins edited` instead,
   * so nothing is counted twice.
   */
  simulatorPinsCleared: 'simulator pins cleared',
  /**
   * A simulator tool's option changed. Generic over tool and option, so a later
   * tool's options need no event of their own; values are `on` and `off`.
   */
  simulatorToolOptionChanged: 'simulator tool option changed',
  /**
   * The fold target first moved after a pin edit — once per pin set. This is
   * the feature's value question: do people fold and unfold around their pins,
   * or pin and stop?
   */
  simulatorPinnedFoldMoved: 'simulator pinned fold moved',
  /**
   * The solver's blow-up guard acted: `reset` put a non-finite model back to
   * flat, `arrest` drained runaway velocity. At most once per load per action,
   * with whether anything was pinned — pins over-constrain the paper, and this
   * says whether that matters in practice. These were repaired silently before.
   */
  simulatorSolverRecovered: 'simulator solver recovered',
  /**
   * A pull ended: once per drag, never per move. `outcome` is whether the pose
   * was kept or the drag abandoned (Escape, a second finger, a tool switch);
   * `input` whether a finger made it; with the pin count and how many creases it
   * turned as buckets. This is the Pull tool's value question: do people pull
   * models open, and keep what they pull?
   */
  simulatorModelPulled: 'simulator model pulled',
  /**
   * A press with the Pull tool did not grip: off the paper, on a pinned face, or
   * with nothing pinned to pull against. `no-pins` is how often people try Pull
   * before Pin, which says whether refusing it was right.
   */
  simulatorPullRefused: 'simulator pull refused',
  /**
   * A pose ended, and what ended it: the fold control or a restart taking the
   * paper back, or Spring back asked for from the window, the menu or a key.
   * Whether people keep poses, or throw them away and how.
   */
  simulatorPoseReleased: 'simulator pose released',
  foldedFigureRehydrated: 'folded figure rehydrated',
  creasePatternShared: 'crease pattern shared',
  /**
   * A crease pattern was saved as an SVG or PNG image from its export dialog.
   * `folded_figure` is the style the folded figure beside it was drawn in —
   * the export slot or a preset by kind — or `none` without one: whether the
   * figure is used, and whether its picker earns its place. The menu
   * chokepoint sees only the command, not what the dialog made of it.
   */
  creasePatternExported: 'crease pattern exported',
  shareLinkCopied: 'share link copied',
  shareLinkOpened: 'share link opened',
  /**
   * A step was added to the diagram. `source` is what its picture came from,
   * `via` the control that added it: which ways into the Diagram are used.
   */
  diagramStepAdded: 'diagram step added',
  /**
   * A turn added between steps (D22) — a turn-over or a rotation, unnumbered —
   * `via` where: whether turns are made by hand or come from References.
   */
  diagramTurnAdded: 'diagram turn added',
  /**
   * One file of an upload into the Diagram, and what became of it: whether
   * people's own drawings survive the sanitizer, and how big they are.
   */
  diagramPictureUploaded: 'diagram picture uploaded',
  /** A step opened in detail, by Enter or a double-click: whether the detail is used. */
  diagramStepOpened: 'diagram step opened',
  /** An uploaded picture turned or flipped from the step detail or the Step pane. */
  diagramPicturePosed: 'diagram picture posed',
  /** An annotation drawn on a step's picture, by the tool that drew it. */
  diagramAnnotationAdded: 'diagram annotation added',
  /** A mark put behind a flap for the first time (15e): which ends, how deep. */
  diagramAnnotationBehind: 'diagram annotation behind',
  /** A mark flipped horizontally or vertically from the Layers pane: its kind, which way. */
  diagramAnnotationFlipped: 'diagram annotation flipped',
  /** A solid line's or a label's colour changed in the Layers pane (17a, 17b): its kind, the colour by name. Once per pick. */
  diagramAnnotationRecolored: 'diagram annotation recolored',
  /** A label's Bold, Halo or Size changed in the Layers pane (17b): which, and to what. */
  diagramTextStyled: 'diagram text styled',
  /** One of a mark's own options changed in the Layers pane (Revision 3): the mark's kind, which option, and to what. */
  diagramMarkStyled: 'diagram mark styled',
  /**
   * A mark a References card brought (17d) edited for the first time, or
   * taken away: its kind, and which. Whether people edit what they pull.
   */
  diagramImportedMarkEdited: 'diagram imported mark edited',
  /**
   * An old References step's card's marks lifted into annotations by Make
   * Marks Editable (17e): where it was pressed, and how many the step holds
   * now (bucketed). Whether steps made before marks were lifted are converted.
   */
  diagramReferencesMarksLifted: 'diagram references marks lifted',
  /** A frame placed on an enlarged step by a capture (Revision 2): how, through what, by which anchor. One per step placed. */
  diagramStepEnlarged: 'diagram step enlarged',
  /** An enlarge area or an enlarged step's frame changed: moved, its Shape, Size, Edge or Anchor, or an area deleted. */
  diagramEnlargementChanged: 'diagram enlargement changed',
  /** Annotate's Snap switch flipped in the Step pane. */
  diagramAnnotateSnapChanged: 'diagram annotate snap changed',
  /**
   * An arrow shaped by hand for the first time (Edit Path): a fold arrow's arc
   * made a path, or a white arrow bent from the straight one it was laid as —
   * not each edit after. A fold-and-unfold arrow's says which half.
   */
  diagramArrowShaped: 'diagram arrow shaped',
  /** A step's picture taken away (Remove picture). */
  diagramPictureRemoved: 'diagram picture removed',
  /**
   * A step's picture written to a file (Export picture…): the first half of the
   * export, edit and replace round trip D7 is built for.
   */
  diagramPictureExported: 'diagram picture exported',
  /**
   * A step's picture captured from the crease pattern (D18): how it shows the
   * pattern, what became of it, and which flow asked — whether linking is used,
   * and how often folds fail or are stopped.
   */
  diagramPictureCaptured: 'diagram picture captured',
  diagramStepShownAs: 'diagram step shown as',
  /** A step's Open in Edit or Open in References: whether the way back to a step's source is used. */
  diagramSourceOpened: 'diagram source opened',
  /** The Diagram switched between its steps and its pages: whether the pages are looked at. */
  diagramViewSwitched: 'diagram view switched',
  /** A page setting changed in the Page pane: which ones are used, never their values. */
  diagramPageSetupChanged: 'diagram page setup changed',
  /**
   * The diagram written out from its export dialog (D18): a PDF of its pages
   * or a ZIP of its steps, how, and how big. Whether diagrams leave the app,
   * and in which form.
   */
  diagramExported: 'diagram exported',
  /**
   * The References browser opened in the Diagram (D20), and for where: what
   * `diagram steps pulled from references` is read against.
   */
  diagramReferencesBrowserOpened: 'diagram references browser opened',
  /**
   * Cards pulled into the diagram from the References browser (D20): from a
   * planned pattern's sequence or the Find answer, how many, and where they
   * went. Whether the Diagram is where precreasing steps are chosen, and
   * whether filling and replacing are found. Never a card, a line or a sentence.
   */
  diagramStepsPulledFromReferences: 'diagram steps pulled from references',
  exploriSearch: 'explori search',
  exploriSearchFailed: 'explori search failed',
  exploriResultOpened: 'explori result opened',
  exploriSentToEdit: 'explori sent to edit',
  designSentToEdit: 'design sent to edit',
  themeChanged: 'theme changed',
  localeChanged: 'locale changed',
  landingViewed: 'landing viewed',
  /**
   * A content page of the site was opened — `/download/` and its siblings.
   *
   * The pages exist to be found from a search result, and this is the only way to tell
   * whether they are: a page nobody arrives at is a page not worth translating further.
   */
  sitePageViewed: 'site page viewed',
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
  /**
   * A link out to the community Discord was followed.
   *
   * Nothing here dispatches through `handleMenuAction`, so the `command invoked`
   * chokepoint cannot see it — and "does anyone press this" is the only question
   * that decides whether an icon keeps a slot in the workspace chrome. Same
   * argument as `desktop download started`'s `toolbar` surface.
   */
  communityLinkOpened: 'community link opened',
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
   *
   * `pane` names which side pane the sheet opened on (`cp-view-controls`,
   * `cp-properties`, `simulator-view-controls`, the Diagram's `diagram-step`,
   * `diagram-page` and `diagram-layers`) — an enum, never content.
   */
  viewDrawerOpened: 'view drawer opened',
  /**
   * A property of a selected canvas object was changed from the Properties
   * pane.
   *
   * The pane is the first surface that edits every canvas-object kind through
   * one renderer, so this is what says whether people edit there rather than on
   * the floating toolbars and menus that still exist — the question adding a
   * second surface for the same edits raises. Once per recorded change, never
   * per input event. `object_kind` is the kind table's key and `property` the
   * field's id: enums by construction, never a value.
   */
  canvasObjectPropertyChanged: 'canvas object property changed',
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

/** Threshold ladder for how many pages an export of every step wrote. */
export const PAPER_EXPORT_PAGE_COUNT_BUCKETS = [5, 10, 25] as const;

/** An uploaded picture's size, in KB: an icon, a drawing, a heavy export, a photo. */
export const DIAGRAM_UPLOAD_KB_BUCKETS = [50, 200, 1000, 5000] as const;

/** How many files one upload carried: one, a handful, a whole sequence. */
export const DIAGRAM_UPLOAD_COUNT_BUCKETS = [1, 5, 20, 50] as const;

/** A diagram's pages, or its steps' files: a leaflet, a booklet, a book. */
export const DIAGRAM_PAGE_COUNT_BUCKETS = [1, 2, 5, 10, 25] as const;

/** How many of a diagram's steps had no picture when it was exported: none, one, a few, many. */
export const DIAGRAM_EMPTY_STEP_BUCKETS = [0, 1, 5, 20] as const;

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
 * Where a simulator tool was picked: Escape is the way back to Orbit, and the
 * tool window is the Pull tool's way to Pin when nothing is pinned.
 */
export type SimulatorToolSelectSource =
  | 'rail'
  | 'picker'
  | 'shortcut'
  | 'context-menu'
  | 'escape'
  | 'tool-window';

/** What ended a pose a pull left: the fold control, a restart, or Spring back from somewhere. */
export type SimulatorPoseReleaseSource =
  | 'fold-control'
  | 'restart'
  | 'tool-window'
  | 'context-menu'
  | 'shortcut';

/** Why a Pull press did not grip. */
export type SimulatorPullRefusal = 'missed' | 'pinned-face' | 'no-pins';

/**
 * Threshold ladder for how many creases a pull turned. Starts at 0: a pull that
 * moved nothing (a press let go where it was, a taut drag) is an answer too.
 */
export const SIMULATOR_MOVED_CREASE_BUCKETS = [0, 1, 5, 20, 100, 500] as const;

/** Where the simulator's pins were cleared from. */
export type SimulatorPinsClearSource = 'tool-window' | 'context-menu' | 'shortcut';

/** Where a simulator tool option was changed. */
export type SimulatorToolOptionSource = 'tool-window' | 'context-menu' | 'shortcut';

/**
 * Threshold ladder for how many faces are pinned.
 *
 * Starts at 0, unlike {@link COUNT_BUCKETS}: a gesture that empties the set is
 * the answer to a question here (did a plain click on nothing clear it), and a
 * ladder that starts at 1 files an empty set with a single face.
 */
export const SIMULATOR_PIN_COUNT_BUCKETS = [0, 1, 5, 20, 100, 500] as const;

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
 * How many mirror pairs one Pair verb made or broke.
 *
 * Pair and Unpair always report 1; the buckets exist for Pair all mirrored,
 * where the question is whether people reach for it on a handful of hand-drawn
 * flaps or to pair a whole imported design at once.
 */
export const SYMMETRY_PAIR_COUNT_BUCKETS = [1, 2, 5, 10, 20] as const;

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
 *
 * The transport reasons are named by the shell, which is the only place the
 * cause of a failed request can be read: the updater plugin reports every one
 * of them as the same "error sending request" string, which is how half the
 * Windows fleet spent a month filed under `unknown`. `dns`, `connect`, `tls`,
 * `proxy` and `timeout` are the causes it could name; `network` is a transport
 * failure it could not. `http_status`, `parse` and `no_platform_entry` are the
 * manifest's fault, and therefore fleet-wide; `unsupported` is this build's.
 * Mirrors `UpdateCheckErrorKind` in `platform/updateService.ts` plus the two
 * reasons only the frontend can raise.
 */
export type UpdateFailureReason =
  | 'network'
  | 'dns'
  | 'connect'
  | 'tls'
  | 'proxy'
  | 'timeout'
  | 'http_status'
  | 'parse'
  | 'no_platform_entry'
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
