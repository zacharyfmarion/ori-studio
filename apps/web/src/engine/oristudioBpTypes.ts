import type { OptimizerSymmetryPayload } from '../lib/bpOptimizerSymmetry';
import type { Point } from '../lib/geometry';
import type {
  OristudioBpCapabilityId,
  OristudioBpCommandId,
} from '../lib/oristudioBpCommands';

export type OristudioBpWorkflowTarget = 'box-pleat';
export type OristudioWorkflowTarget = 'treemaker' | OristudioBpWorkflowTarget;

export type OristudioBpDocumentKind = 'box-pleat-project' | 'box-pleat-workspace';
export type OristudioBpEditingSurface = 'tree' | 'packing';

export const ORISTUDIO_BP_EDITING_SURFACES = [
  'tree',
  'packing',
] as const satisfies readonly OristudioBpEditingSurface[];

export type OristudioBpSheetKind = 'rectangular' | 'diagonal';
export type OristudioBpGridKind = 'rectangular' | 'diagonal';
export type OristudioBpPackingValidity = 'unknown' | 'valid' | 'invalid' | 'stale';
export type OristudioBpDiagnosticSeverity = 'info' | 'warning' | 'error';

export type OristudioBpLayerId =
  | 'grid'
  | 'sheet-border'
  | 'flap'
  | 'flap-clearance'
  | 'flap-dot'
  | 'flap-label'
  | 'river'
  | 'hinge'
  | 'ridge'
  | 'axis-parallel'
  | 'invalid-junction'
  | 'stretch'
  | 'device'
  | 'selection-shade';

export const DEFAULT_ORISTUDIO_BP_VIEWPORT_LAYERS = [
  'grid',
  'sheet-border',
  'flap',
  'flap-clearance',
  'flap-dot',
  'flap-label',
  'river',
  'hinge',
  'ridge',
  'axis-parallel',
  'invalid-junction',
  'stretch',
  'device',
  'selection-shade',
] as const satisfies readonly OristudioBpLayerId[];

export interface OristudioBpSourceRef {
  format: 'bps' | 'bpz' | 'treemaker-import' | 'generated';
  filename: string;
  path: string | null;
}

export interface OristudioBpProjectSummary {
  title: string;
  description: string | null;
  upstreamVersion: string | null;
  treeVertices: number;
  treeEdges: number;
  leafVertices: number;
  flaps: number;
  rivers: number;
  stretches: number;
  devices: number;
  invalidJunctions: number;
  packingValidity: OristudioBpPackingValidity;
}

export interface OristudioBpGrid {
  kind: OristudioBpGridKind;
  interval: number;
  diagonalDivisions?: number;
  snap: boolean;
}

export interface OristudioBpSheet {
  kind: OristudioBpSheetKind;
  width: number;
  height: number;
  grid: OristudioBpGrid;
}

export interface OristudioBpTreeVertex {
  id: number;
  name: string;
  loc: Point;
  isRoot: boolean;
  isLeaf: boolean;
  degree: number;
  dist: number;
  height: number;
  maxHeight: number | null;
  maxNewLeafLength: number | null;
  dualFlapId: number | null;
}

export interface OristudioBpTreeEdge {
  id: number;
  vertices: [number, number];
  length: number;
  maxLength: number | null;
  isLeafEdge: boolean;
  dualRiverId: number | null;
}

export interface OristudioBpTreeView {
  rootVertexId: number | null;
  sheet: OristudioBpSheet;
  vertices: OristudioBpTreeVertex[];
  edges: OristudioBpTreeEdge[];
  maxTreeHeight: number | null;
}

export interface OristudioBpFlap {
  id: number;
  vertexId: number;
  name: string;
  anchor: Point;
  width: number;
  height: number;
  radius: number;
  constrained: boolean;
}

/**
 * A river: the band of paper an internal tree edge takes up.
 *
 * Its `width` is the dual edge's length — one number, not two. Box Pleating
 * Studio's river panel labels it "Width" and binds it straight to
 * `Edge.length` (`src/app/vue/panel/river.vue`), so editing a river's width and
 * editing its edge's length are the same edit.
 */
export interface OristudioBpRiver {
  id: number;
  edgeId: number;
  vertices: [number, number];
  width: number;
}

/**
 * One point of an arc-aware outline, matching Box Pleating Studio's `ArcPoint`.
 * `arc` is the tangent anchor of the arc that ends at this point (the canvas
 * `arcTo` control point) and `r` its radius; a point without them is reached by
 * a straight segment.
 */
export interface OristudioBpArcPoint {
  x: number;
  y: number;
  arc?: Point | null;
  r?: number | null;
}

export type OristudioBpArcPath = OristudioBpArcPoint[];

export interface OristudioBpInvalidJunction {
  id: string;
  flapIds: number[];
  riverIds: number[];
  /** Closed arc outlines of the overlap region between the two flaps. */
  paths: OristudioBpArcPath[];
  /** How far the two flaps overlap, in grid units (negative means overlapping). */
  overlap: number;
  message: string;
}

export interface OristudioBpRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OristudioBpStretch {
  id: string;
  flapIds: number[];
  riverIds: number[];
  completed: boolean;
  configIndex: number | null;
  configCount: number | null;
  patternIndex: number | null;
  patternCount: number | null;
  patternFound: boolean | null;
  /** The gap rectangles this stretch has to cover, one per junction. */
  regions: OristudioBpRect[];
}

export interface OristudioBpDevice {
  id: string;
  stretchId: string;
  position: Point;
  /** Bounds on how far this device may slide along the stretch axis. */
  rangeScalar: [number, number] | null;
  forward: boolean | null;
}

export type OristudioBpGraphicPrimitive =
  | {
      kind: 'line';
      id: string;
      layer: OristudioBpLayerId;
      points: [Point, Point];
      stroke: string;
      width: number;
    }
  | {
      kind: 'polyline';
      id: string;
      layer: OristudioBpLayerId;
      points: Point[];
      stroke: string;
      width: number;
      closed: boolean;
    }
  | {
      kind: 'polygon';
      id: string;
      layer: OristudioBpLayerId;
      points: Point[];
      fill: string;
      stroke?: string;
    }
  | {
      kind: 'circle';
      id: string;
      layer: OristudioBpLayerId;
      center: Point;
      radius: number;
      fill?: string;
      stroke?: string;
    }
  | {
      kind: 'text';
      id: string;
      layer: OristudioBpLayerId;
      loc: Point;
      text: string;
    };

/**
 * One closed region of paper taken up by a single flap or river.
 *
 * This is a node's contour as the engine drew it (`GraphicsData.contours`): a
 * leaf's region is its flap, an internal node's is its river band, whose child
 * subtree is punched out as a hole. The same rings reach the canvas stroked as
 * the hinge layer; kept as regions here so the paper *not* covered by any of
 * them can be shaded.
 *
 * Regions belonging to different nodes overlap only where the packing is
 * invalid — that overlap is what makes it invalid — so nothing may assume they
 * are disjoint. A single node's own regions are always disjoint and properly
 * nested.
 */
export interface OristudioBpCoverageRegion {
  id: string;
  outer: Point[];
  holes: Point[][];
}

export interface OristudioBpPackingView {
  sheet: OristudioBpSheet;
  flaps: OristudioBpFlap[];
  rivers: OristudioBpRiver[];
  /** Paper claimed by the flaps and rivers. Empty when there is no layout yet. */
  coverage: OristudioBpCoverageRegion[];
  invalidJunctions: OristudioBpInvalidJunction[];
  stretches: OristudioBpStretch[];
  devices: OristudioBpDevice[];
  graphics: OristudioBpGraphicPrimitive[];
  validity: OristudioBpPackingValidity;
}

export type OristudioBpCreaseLineAssignment =
  | 'mountain'
  | 'valley'
  | 'flat'
  | 'border'
  | 'auxiliary'
  | 'unassigned';

export interface OristudioBpCreaseLine {
  id: string;
  vertices: [Point, Point];
  assignment: OristudioBpCreaseLineAssignment;
  sourceLayer: OristudioBpLayerId | null;
}

/**
 * What the user currently has selected in a BP surface.
 *
 * This is **session state, not document state**: it is never serialized to
 * `.bps`, it does not survive a reload, and it lives on the store
 * (`oristudioBpSelection`) rather than on `OristudioBpDocumentState`. Undo/redo
 * restores a selection from the engine's history tags as a presentation
 * courtesy — showing you what the step touched — not because the selection was
 * stored with the step.
 *
 * `bp-none` is the empty value. Reach for `emptyOristudioBpSelection()` rather
 * than writing the literal.
 */
export type OristudioBpSelection =
  | { kind: 'bp-none' }
  | { kind: 'bp-vertex'; id: number }
  | { kind: 'bp-edge'; id: number }
  | { kind: 'bp-flap'; id: number }
  | { kind: 'bp-river'; id: number }
  | { kind: 'bp-stretch'; id: string }
  | { kind: 'bp-device'; id: string }
  | { kind: 'bp-invalid-junction'; id: string }
  | {
      kind: 'bp-multi';
      vertices: number[];
      edges: number[];
      flaps: number[];
      rivers: number[];
      stretches: string[];
      devices: string[];
      invalidJunctions: string[];
    };

/**
 * The empty selection. There is one encoding of "nothing selected" — an empty
 * `bp-multi` is normalized to this (see `normalizeBpMultiSelection`).
 */
export function emptyOristudioBpSelection(): OristudioBpSelection {
  return { kind: 'bp-none' };
}

export type OristudioBpDiagnosticKind =
  | 'invalid-tree'
  | 'invalid-sheet'
  | 'invalid-packing'
  | 'stale-packing'
  | 'stale-crease-pattern'
  | 'invalid-junction'
  | 'pattern-not-found'
  /** The kernel refused to build the layout, so the pane has nothing to draw. */
  | 'layout-graphics-error'
  | 'unsupported'
  | 'upstream-gap'
  | 'optimizer-error'
  | 'export-error';

/**
 * Structured facts behind a diagnostic, so the render site can localize the
 * sentence instead of displaying a pre-built English `message`.
 */
export type OristudioBpDiagnosticDetail = {
  kind: 'patternless-stretch';
  /** Display labels of the flaps in the overlap, e.g. `['K', 'M', 'O', 'W']`. */
  flapLabels: string[];
  /**
   * Whether a layout configuration was found at all. `false` means the search
   * failed before any pattern was attempted, which needs different advice from
   * "a configuration exists but yields no pattern".
   */
  hasConfiguration: boolean;
};

export interface OristudioBpDiagnostic {
  id: string;
  kind: OristudioBpDiagnosticKind;
  severity: OristudioBpDiagnosticSeverity;
  /** English fallback. Prefer `detail` at render sites that can localize. */
  message: string;
  detail?: OristudioBpDiagnosticDetail;
  commandId?: OristudioBpCommandId;
  capabilityId?: OristudioBpCapabilityId;
  selection?: OristudioBpSelection;
}

export interface OristudioBpStaleState {
  packing: boolean;
  /** Whether an exported crease pattern would need regenerating. */
  creasePattern: boolean;
  exports: boolean;
  reasons: string[];
}

export type OristudioBpOptimizerLayoutMode = 'view' | 'random';
export type OristudioBpOptimizerStage =
  | 'idle'
  | 'initializing'
  | 'start'
  | 'candidate-generation'
  | 'continuous-solving'
  | 'pre-solving'
  | 'packing'
  | 'integral-grid-fitting'
  | 'complete'
  | 'cancelled'
  | 'error';

export interface OristudioBpOptimizerOptions {
  openNew: boolean;
  useDimension: boolean;
  layoutMode: OristudioBpOptimizerLayoutMode;
  useBasinHopping: boolean;
  randomCandidateCount: number;
  seed: number | null;
  /**
   * Whether to constrain the layout to the tree's mirror symmetry.
   *
   * Separate from the symmetry-authoring mode being on, which is a *drawing*
   * aid and defaults on for every design — it carries no signal about what the
   * packing should be. Constraining the optimizer is a decision the user makes
   * per run.
   */
  respectSymmetry: boolean;
  /**
   * Mirror symmetry to enforce, already resolved against the tree by
   * {@link ../lib/bpOptimizerSymmetry.resolveOptimizerSymmetry}. Omitted or null
   * runs the unmodified upstream algorithm.
   */
  symmetry?: OptimizerSymmetryPayload | null;
}

/**
 * The subset of {@link OristudioBpOptimizerOptions} the dialog exposes. `openNew`
 * is always false (we have no BP project tabs, so the optimizer replaces the
 * layout in place and undo is the recovery path) and `seed` is randomized per
 * run, so neither is a user choice.
 */
/**
 * What the user chooses for a run.
 *
 * `symmetry` is deliberately excluded: it is derived from the tree and the
 * symmetry-authoring mode at the moment the run starts, not a preference the
 * dialog owns or persists. The slice action resolves it — see
 * {@link ../lib/bpOptimizerSymmetry.resolveOptimizerSymmetry}.
 */
export type OristudioBpOptimizerRunOptions = Omit<
  OristudioBpOptimizerOptions,
  'openNew' | 'seed' | 'symmetry'
>;

/**
 * How an optimizer run ended. `cancelled` is a user action rather than a
 * failure: nothing is applied, nothing is recorded, and no error is surfaced.
 */
export type OristudioBpOptimizerOutcome = 'applied' | 'cancelled' | 'failed';

export interface OristudioBpOptimizerProgress {
  stage: OristudioBpOptimizerStage;
  label: string;
  current: number | null;
  total: number | null;
  canSkip: boolean;
  canCancel: boolean;
  message: string | null;
}

export type OristudioBpOptimizerEvent =
  | { event: 'loading'; data: number }
  | { event: 'start' }
  | { event: 'pack'; data: number }
  | { event: 'candidate'; data: [number, number] }
  | { event: 'flap'; data: number }
  | { event: 'cont'; data: [number, number, number] }
  | { event: 'fit'; data: [number, number] };

export interface OristudioBpOptimizerState {
  running: boolean;
  options: OristudioBpOptimizerOptions;
  progress: OristudioBpOptimizerProgress;
  lastError: string | null;
  lastResultValid: boolean | null;
}

export type OristudioBpExportFormat = 'bps' | 'bpz' | 'cp' | 'fold' | 'svg' | 'png';

export interface OristudioBpExportOptions {
  format: OristudioBpExportFormat;
  reorient: boolean;
  includeAuxiliaryHinges: boolean;
  includeHiddenLayers: boolean;
}

export interface OristudioBpExportStatus {
  busy: boolean;
  lastFormat: OristudioBpExportFormat | null;
  lastError: string | null;
}

export interface OristudioBpProjectSnapshot {
  summary: OristudioBpProjectSummary;
  tree: OristudioBpTreeView;
  packing: OristudioBpPackingView;
  diagnostics: OristudioBpDiagnostic[];
  stale: OristudioBpStaleState;
}

export interface OristudioBpHistorySummary {
  pastCount: number;
  futureCount: number;
  activeLabel: string | null;
}

export interface OristudioBpDocumentState {
  workflowTarget: OristudioBpWorkflowTarget;
  kind: 'box-pleat-project';
  handle: number;
  source: OristudioBpSourceRef;
  activeSurface: OristudioBpEditingSurface;
  snapshot: OristudioBpProjectSnapshot;
  history: OristudioBpHistorySummary;
  optimizer: OristudioBpOptimizerState;
  exportStatus: OristudioBpExportStatus;
  dirty: boolean;
}

export interface OristudioBpWorkspaceProject {
  handle: number;
  title: string;
  source: OristudioBpSourceRef;
  dirty: boolean;
}

export interface OristudioBpWorkspaceState {
  workflowTarget: OristudioBpWorkflowTarget;
  kind: 'box-pleat-workspace';
  source: OristudioBpSourceRef;
  activeProjectHandle: number | null;
  projects: OristudioBpDocumentState[];
  dirty: boolean;
}

export interface OristudioBpWorkspaceSummaryProject {
  handle: number;
  title: string;
  source: OristudioBpSourceRef;
  dirty: boolean;
}

export interface OristudioBpRawProject {
  version: string;
  design: OristudioBpRawDesign;
  error?: OristudioBpRawCoreError | null;
  history?: OristudioBpRawHistory | null;
  state?: OristudioBpRawState | null;
}

export interface OristudioBpRawDesign {
  title: string;
  description?: string | null;
  mode: 'layout' | 'tree';
  layout: OristudioBpRawLayout;
  tree: OristudioBpRawTree;
}

export interface OristudioBpRawLayout {
  sheet: OristudioBpRawSheet;
  flaps: OristudioBpRawFlap[];
  stretches: OristudioBpRawStretch[];
}

export interface OristudioBpRawTree {
  sheet: OristudioBpRawSheet;
  nodes: OristudioBpRawVertex[];
  edges: OristudioBpRawEdge[];
}

export interface OristudioBpRawSheet {
  type?: 'rect' | 'diag';
  width: number;
  height: number;
}

export interface OristudioBpRawFlap {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OristudioBpRawVertex {
  id: number;
  x: number;
  y: number;
  name: string;
  isNew?: boolean | null;
}

export interface OristudioBpRawEdge {
  n1: number;
  n2: number;
  length: number;
}

export interface OristudioBpRawStretch {
  id: string;
  configuration?: OristudioBpRawConfiguration | null;
  pattern?: OristudioBpRawPattern | null;
  repo?: OristudioBpRawRepository | null;
}

export interface OristudioBpRawRepository {
  configurations: OristudioBpRawConfiguration[];
  index: number;
}

export interface OristudioBpRawConfiguration {
  partitions: unknown[];
  raw?: boolean | null;
  patterns?: OristudioBpRawPattern[] | null;
  index?: number | null;
}

export interface OristudioBpRawPattern {
  devices: OristudioBpRawDevice[];
}

export interface OristudioBpRawDevice {
  gadgets: unknown[];
  offset?: number | null;
  addOns?: unknown[] | null;
}

export interface OristudioBpRawHistory {
  index: number;
  savedIndex: number;
  steps: unknown[];
}

export interface OristudioBpRawState {
  layout?: unknown;
  tree?: unknown;
}

export interface OristudioBpRawCoreError {
  message: string;
  coreTrace: string;
  clientTrace: string;
  request: unknown;
  build: string;
  userAgent: string;
}

export interface OristudioBpWasmProjectSummary {
  version: string;
  title: string;
  mode: 'layout' | 'tree';
  layout_flaps: number;
  layout_stretches: number;
  tree_nodes: number;
  tree_edges: number;
}

export interface OristudioBpWasmTreeData {
  edges: OristudioBpRawEdge[];
  nodes: OristudioBpWasmTreeNode[];
}

/**
 * A flap's whole footprint, for the kernel's `reshape_flap`.
 *
 * A flap draws as its box grown by its radius on every side, so a gesture that
 * resizes what is on screen generally moves the anchor *and* the box *and* the
 * leaf-edge length. They travel together because the kernel applies them as one
 * solve and one history step — and because no intermediate state (a grown box
 * still at the old anchor, say) has to pass the sheet's at-most-one-tip rule.
 */
export interface OristudioBpFlapReshape {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The flap's leaf-edge length. Omitted leaves the radius alone. */
  radius?: number;
  /**
   * Where the flap's own tree vertex should sit, keeping the tree drawing
   * length-faithful. Omitted leaves the drawing alone, which is what a mid-drag
   * step wants — the correction is a drawing concern and can wait for the
   * release.
   */
  vertex?: Point;
}

export interface OristudioBpWasmTreeNode {
  id: number;
  dist: number;
  height: number;
}

export interface OristudioBpWasmLayoutSnapshot {
  nodeGraphics: OristudioBpWasmGraphicsEntry[];
  deviceGraphics: OristudioBpWasmGraphicsEntry[];
  invalidJunctions: OristudioBpWasmInvalidJunction[];
  /**
   * Every stretch the layout has, derived from the tree by the engine. This is
   * the authoritative set: `design.layout.stretches` only persists the stretches
   * whose config/pattern selection deviates from the default, and a stretch with
   * no pattern is never persisted at all (upstream `patternTask` removes it).
   */
  stretches: OristudioBpWasmLayoutStretch[];
  patternNotFound: boolean;
}

export interface OristudioBpWasmLayoutStretch {
  id: string;
  flapIds: number[];
  configurationIndex: number;
  configurationCount: number;
  patternIndex: number;
  patternCount: number;
  patternFound: boolean;
  regions: OristudioBpRect[];
}

export interface OristudioBpWasmCreasePatternSnapshot {
  sheet: {
    width: number;
    height: number;
  };
  lines: OristudioBpWasmCreasePatternLine[];
}

export interface OristudioBpWasmCreasePatternLine {
  id: string;
  assignment: OristudioBpCreaseLineAssignment;
  p1: Point;
  p2: Point;
}

export interface OristudioBpWasmPackingValidation {
  valid: boolean;
  errors: OristudioBpWasmPackingValidationError[];
}

export interface OristudioBpWasmPackingValidationError {
  message: string;
}

export interface OristudioBpWasmGraphicsEntry {
  id: string;
  data: OristudioBpWasmGraphicsData;
}

export interface OristudioBpWasmGraphicsData {
  contours: OristudioBpWasmContourData[];
  ridges: [Point, Point][];
  axisParallel?: [Point, Point][] | null;
  range?: [number, number] | null;
  location?: Point | null;
  forward?: boolean | null;
}

export interface OristudioBpWasmContourData {
  outer: Point[];
  inner?: Point[][];
}

export interface OristudioBpWasmInvalidJunction {
  id: string;
  flapIds: [number, number];
  /**
   * Wire name kept as-is: the engine sends `InvalidJunction::distance_after_flap_radii`,
   * which is the overlap distance, not Box Pleating Studio's per-path narrowness ratio.
   */
  narrowness: number;
  polygon: OristudioBpWasmArcPoint[][];
}

export type OristudioBpWasmArcPoint = OristudioBpArcPoint;

export interface OristudioBpWasmWorkspaceProject {
  filename: string;
  handle: number;
  project: OristudioBpRawProject;
  summary: OristudioBpWasmProjectSummary;
}

export interface OristudioBpWasmOpenedProject {
  handle: number;
  project: OristudioBpRawProject;
  summary: OristudioBpWasmProjectSummary;
}

export interface OristudioBpWasmHistoryNavigationProject {
  project: OristudioBpRawProject;
  selection: string[];
}

export interface OristudioBpWasmWorkspaceExportProject {
  filename: string;
  handle: number;
}

export type OristudioBpPortStatus =
  | 'unsupported'
  | 'porting'
  | 'unit-tested'
  | 'oracle-tested'
  | 'documented-difference'
  | 'upstream-gap'
  | 'out-of-scope-ui';

export type OristudioBpPortArea =
  | 'model'
  | 'io'
  | 'engine'
  | 'data'
  | 'math'
  | 'sweep'
  | 'tree'
  | 'layout'
  | 'optimizer'
  | 'wasm'
  | 'oracle';

export interface OristudioBpPortDescriptor {
  upstream: string;
  target: string;
  area: OristudioBpPortArea;
  status: OristudioBpPortStatus;
}
