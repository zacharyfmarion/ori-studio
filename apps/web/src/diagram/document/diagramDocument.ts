/**
 * The Diagram workspace's document: an ordered list of steps, the page they
 * are laid out on, and the paper style they are painted in.
 *
 * A diagram is a document of the *project*, beside the crease pattern and the
 * design tabs, not a view of the crease pattern (implementation-plans/
 * diagram-workspace.md, D1). Everything here is plain data and pure edits:
 * every edit returns the same object when it changes nothing, which is how the
 * store tells a no-op from an edit worth an undo entry.
 *
 * A step's number is its position. Numbers are never stored.
 *
 * React-free, store-free and DOM-free.
 */

import type { FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import type { StepDiagramModel } from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';
import type { RegionReference } from '../../cp-workspace/regions/regionReference';
import type { SheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import type { BuiltInPaperPresetId } from '../../lib/paper/paperPresets';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { xmlText } from '../../lib/xmlEscape';
import { withCarriedAnnotations } from '../annotate/annotationCarry';
import { cleanAnnotation, MAX_STEP_ANNOTATIONS } from '../annotate/annotationModel';

/** The version of this document's own shape, inside the project file. */
export const DIAGRAM_FORMAT_VERSION = 1;

/**
 * Which regional design Han characters are drawn in. The same code point has a
 * different glyph in each, and each font lacks some of the others' characters,
 * so a diagram keeps the one its author chose rather than taking the viewer's.
 */
export type DiagramHanStyle = 'sc' | 'tc' | 'jp' | 'kr';

export type DiagramPaperSize = 'a4' | 'a5' | 'b5-jis' | 'letter';
export type DiagramPageOrientation = 'portrait' | 'landscape';
export type DiagramPageLayout = 'grid' | 'flow';
/**
 * `paper`: every picture that knows its paper's size is drawn at one shared
 * scale, so the model visibly shrinks as it is folded. `fit`: every picture is
 * fitted to its own box.
 */
export type DiagramPictureScale = 'paper' | 'fit';

export interface DiagramPageSetup {
  size: DiagramPaperSize;
  orientation: DiagramPageOrientation;
  /** 0–30 mm. */
  marginMm: number;
  layout: DiagramPageLayout;
  /** 2–5. */
  columns: number;
  /** 1–6. */
  rows: number;
  /** Flow layout only: the band that joins one step to the next. */
  showPath: boolean;
  scale: DiagramPictureScale;
  /** Draws {@link DiagramDocument.title} in a tab at the top of every page. */
  showTitle: boolean;
  pageNumbers: { enabled: boolean; first: number };
}

/**
 * The paper style every step is painted in. A built-in preset by id, or a
 * resolved style: a user preset or the export slot is resolved when it is
 * chosen, so a printed diagram never depends on the viewer's own settings.
 */
export type DiagramStyle = { preset: BuiltInPaperPresetId } | { style: PaperStyle };

/** A quarter-turn count, clockwise. */
export type QuarterTurns = 0 | 1 | 2 | 3;

/**
 * A picture the user uploaded. Its pose is the source's own: applied when the
 * step is painted, around the shared asset, which is never rewritten (D5).
 */
export interface DiagramUploadSource {
  kind: 'upload';
  assetId: string;
  /** Clockwise, applied after {@link mirrored}. */
  rotationQuarterTurns: QuarterTurns;
  /** Flipped left to right, before the rotation. */
  mirrored: boolean;
}

/**
 * How a crease-pattern step chooses its creases (D3, D21): a whole region of
 * the pattern, picked in the Diagram and found again by its rim. The `kind`
 * leaves room for another way in a later file; a scope this build does not
 * know makes the step one it carries as it came.
 */
export type DiagramCpScope = { kind: 'segment'; region: RegionReference };

/**
 * What a crease-pattern step shows of its creases (D5): the pattern itself, the
 * flat folded model, or the folded model in 3D. Each keeps its own pose.
 */
export type DiagramCpRender =
  | { mode: 'crease-pattern'; rotationDeg: number }
  | {
      mode: 'folded-flat';
      side: 'front' | 'back';
      rotationDeg: number;
      /** Which layer-ordering solution, 1-based. */
      foldCase: number;
    }
  | { mode: 'folded-3d'; camera: FoldedFigureCamera; side: 'front' | 'back' }
  | {
      /** The simulator's model at a fold %, from a camera (D19). */
      mode: 'simulated';
      /** 0 to 100: 0 is the flat sheet, captured without Pose. */
      foldPercent: number;
      view: DiagramSimulatedView;
    };

/** A simulated step's camera: the simulator viewport's orbit, without roll. */
export interface DiagramSimulatedView {
  yaw: number;
  pitch: number;
  zoom: number;
}

/** The camera a simulated step opens at: Simulate's own default view (`DEFAULT_SIMULATOR_VIEW`). */
export const DEFAULT_SIMULATED_VIEW: DiagramSimulatedView = { yaw: Math.PI / 4, pitch: -0.955, zoom: 1.4 };

/**
 * A way a linked pattern is shown (D19): its crease pattern, its folded form
 * (flat or in 3D as its creases fold), or the simulator's model of it.
 */
export type DiagramShowAs = 'crease-pattern' | 'folded' | 'simulated';

/** The ways, in the order every surface offers them. */
export const DIAGRAM_SHOW_AS: readonly DiagramShowAs[] = ['crease-pattern', 'folded', 'simulated'];

/** How a render shows its pattern. */
export function showAsOf(render: DiagramCpRender): DiagramShowAs {
  switch (render.mode) {
    case 'crease-pattern':
      return 'crease-pattern';
    case 'simulated':
      return 'simulated';
    default:
      return 'folded';
  }
}

/** A step drawn from the open crease pattern, and linked to it (D3). */
export interface DiagramCpSource {
  kind: 'cp';
  scope: DiagramCpScope;
  /**
   * `foldedSourceFingerprint` over the creases the scope chose, from the same
   * document snapshot the capture used: what link status compares against.
   */
  fingerprint: string;
  /** The pattern as it was linked, for the picker and a step whose pattern is gone. */
  thumbnail: SheetThumbnail;
  render: DiagramCpRender;
  /**
   * The pose each other way of showing the pattern last had (D19), so a look
   * at the crease pattern and back brings the folded side, turn and layer
   * order back. Never holds the way the step is shown now; absent when empty.
   */
  remembered?: Partial<Record<DiagramShowAs, DiagramCpRender>>;
}

/**
 * The pose to show a linked pattern in, as `way` (D19): the one it is shown in
 * now when that is the way, else the one that way last had, else that way's
 * start — a crease pattern or a flat fold turned as the step is turned now,
 * from the front at the first layer order. A flat fold asked of creases that
 * fold in 3D becomes the 3D one where it is captured (`renderForRoute`).
 */
export function renderToShowAs(
  source: Pick<DiagramCpSource, 'render' | 'remembered'>,
  way: DiagramShowAs
): DiagramCpRender {
  const { render } = source;
  if (showAsOf(render) === way) return render;
  const kept = source.remembered?.[way];
  if (kept && showAsOf(kept) === way && kept.mode !== 'simulated') return kept;
  // Back to Simulated from another way: its camera is kept, its picture rebuilt
  // at 0%, the one fold % a picture can be taken at without Pose.
  if (way === 'simulated') {
    return { mode: 'simulated', foldPercent: 0, view: kept?.mode === 'simulated' ? kept.view : DEFAULT_SIMULATED_VIEW };
  }
  const turn = render.mode === 'crease-pattern' || render.mode === 'folded-flat' ? render.rotationDeg : 0;
  return way === 'crease-pattern'
    ? { mode: 'crease-pattern', rotationDeg: turn }
    : { mode: 'folded-flat', side: 'front', rotationDeg: turn, foldCase: 1 };
}

/**
 * `after`, a new capture's source, keeping what the step's source before it
 * remembered and, when the way it is shown changes, the pose it had (D19).
 */
export function withRememberedPoses(before: DiagramStepSource | null, after: DiagramCpSource): DiagramCpSource {
  const { remembered: _ignored, ...rest } = after;
  const kept: Partial<Record<DiagramShowAs, DiagramCpRender>> =
    before?.kind === 'cp' ? { ...before.remembered } : {};
  if (before?.kind === 'cp' && showAsOf(before.render) !== showAsOf(after.render)) {
    kept[showAsOf(before.render)] = before.render;
  }
  delete kept[showAsOf(after.render)];
  return Object.keys(kept).length > 0 ? { ...rest, remembered: kept } : rest;
}

/** The planner settings a References plan was made with (D6): what made its steps the ones they are. */
export interface ReferencesPlanSettings {
  precreaseGrid: boolean;
  gridWhereNeeded: boolean;
  allowDanglingFolds: boolean;
  mergeSymmetricSteps: boolean;
}

/**
 * A step sent from References (D6): one card of its strip, kept as it was
 * drawn, with where it came from.
 *
 * The picture never follows the pattern. Planning a sheet again costs seconds
 * to minutes and need not give the same step, so the link only says whether
 * the sheet changed since the step was sent, and leads back to References.
 */
export interface DiagramReferencesSource {
  kind: 'references-step';
  /** The sheet, by its rim, in the segmentation every link is made in (D3). */
  region: RegionReference;
  /**
   * `foldedSourceFingerprint` over every line inside the sheet when the step
   * was sent: what link status compares. Null when the sheet was not found in
   * the segmentation to fingerprint, so its changes cannot be told.
   */
  fingerprint: string | null;
  /** The sheet as it was sent, for the card and the Step pane. */
  thumbnail: SheetThumbnail;
  /** A Find answer's step, or a card of the planner's sequence. */
  mode: 'sequence' | 'find';
  /** The planner settings a sequence card was planned under; null in Find. */
  settings: ReferencesPlanSettings | null;
  /** The number the strip printed on the card; null for a turn-over or the ending. */
  card: number | null;
  /** The plan step's line `n · p = d`, in the planner's unit frame; null for a card that folds none. */
  line: { n: [number, number]; d: number } | null;
  /** The side of the paper the card showed: what Reset Pose returns to. */
  side: 'front' | 'back';
}

/**
 * Where a step's picture comes from. The variants arrive with the phases that
 * build them, and a source this build does not know makes the step an
 * unknown, locked one (see {@link DiagramStep.unknown}).
 */
export type DiagramStepSource = DiagramUploadSource | DiagramCpSource | DiagramReferencesSource;

/**
 * A picture held in the assets table: an upload, or (from Phase 3) a capture
 * too large to keep inline. `key` names the picture, for the paint cache and
 * for telling whether annotations were drawn on it.
 */
export interface DiagramAssetPicture {
  kind: 'asset';
  assetId: string;
  /**
   * Picture px per crease-pattern unit, for a capture kept as a bitmap, for
   * one shared scale across a page (D10); null for an upload, whose paper's
   * size is unknown.
   */
  paperScale: number | null;
  /**
   * For a capture kept as a bitmap, the drawn style it was drawn in
   * (`diagramStyleKey`): a bitmap cannot be re-inked, so a change of style
   * makes it out of date. Absent for an upload.
   */
  styleKey?: string;
  key: string;
}

/**
 * A captured picture as a paper scene (D2): a crease pattern, a flat folded
 * model or a 3D one, drawn in the diagram's pens when it is painted. Stored as
 * one compact string, hidden items already dropped.
 */
export interface DiagramScenePicture {
  kind: 'scene';
  /** The `PaperScene`, as JSON: inert, validated on load (markup dropped). */
  sceneJson: string;
  /** Scene px per crease-pattern unit, for one shared scale across a page (D10); null when unknown. */
  paperScale: number | null;
  /** For a 3D capture, the style its light was baked under (`folded3dSceneStyleKey`); null otherwise. */
  styleKey: string | null;
  key: string;
}

/**
 * A fold with no layer order (D4): the kernel's transparent development, which
 * has no paper scene, as our own SVG — sanitized at capture and on load.
 */
export interface DiagramFixedPicture {
  kind: 'fixed';
  svg: string;
  widthPx: number;
  heightPx: number;
  key: string;
}

/**
 * A References card's picture (D6): its step diagram in the planner's unit
 * frame, painted afresh at every size so its marks keep their weight.
 */
export interface DiagramStepDiagramPicture {
  kind: 'step-diagram';
  model: StepDiagramModel;
  /** Seen from the paper's back: x reflected about the sheet, every fold named from that side. */
  mirrored: boolean;
  key: string;
}

/** A step's captured picture. Variants arrive with their phases, as sources do. */
export type DiagramPicture =
  | DiagramAssetPicture
  | DiagramScenePicture
  | DiagramFixedPicture
  | DiagramStepDiagramPicture;

/**
 * What an annotation draws (D8): a fold arrow — kept (valley, mountain) or
 * made and unfolded — a push, the turn-over and rotate glyphs, a crease line
 * in the diagram's pens, and a label.
 */
export type DiagramAnnotationKind =
  | 'valley-arrow'
  | 'mountain-arrow'
  | 'fold-unfold-arrow'
  | 'push-arrow'
  | 'turn-over'
  | 'rotate'
  | 'valley-line'
  | 'mountain-line'
  | 'hidden-line'
  | 'label';

/** How far, and which way, a rotate glyph turns the model. */
export interface DiagramRotation {
  amount: 'eighth' | 'quarter' | 'half';
  direction: 'cw' | 'ccw';
}

/**
 * A mark drawn on a step's picture (D8), in **picture units**: the origin at
 * the top-left of the picture's frame, y down, one unit the frame's longer
 * side. The frame is the posed picture's bounds — a References step's, its
 * sheet — so a mark stays on what it points at whatever size the picture is
 * drawn. It is compiled into the step-diagram vocabulary each time it is
 * painted (`annotate/annotationPrimitives.ts`), at the size it is painted at.
 */
export interface KnownDiagramAnnotation {
  /** `annotation-<uuid>`. */
  id: string;
  kind: DiagramAnnotationKind;
  /** Where it starts: an arrow's tail, a line's end, a glyph's or a label's centre. */
  from: [number, number];
  /** Where it ends: an arrow's tip; `from` again for a glyph or a label. */
  to: [number, number];
  /**
   * A fold arrow's arc: its sagitta as a share of its chord, positive bulging
   * to the left of its travel as the page shows it. Flip arc negates it.
   */
  bend?: number;
  /** A label's text. */
  text?: string;
  rotate?: DiagramRotation;
  /** The axis a turn-over turns the model about. */
  axis?: 'vertical' | 'horizontal';
  unknown?: undefined;
}

/**
 * An annotation this build cannot read, kept verbatim so a newer build's work
 * survives a round trip through this one: a kind, or a value of one of its
 * enums, this build does not know, or a field it has no name for.
 */
export interface UnknownDiagramAnnotation {
  id: string;
  unknown: Record<string, unknown>;
}

export type DiagramAnnotation = KnownDiagramAnnotation | UnknownDiagramAnnotation;

export function isKnownAnnotation(annotation: DiagramAnnotation): annotation is KnownDiagramAnnotation {
  return annotation.unknown === undefined;
}

/** Uploaded vector art, sanitized (D7): only ever shown as an image. */
export interface DiagramSvgAsset {
  id: string;
  kind: 'svg';
  /** Sanitized markup, its ids prefixed with the asset's id. */
  svg: string;
  widthPx: number;
  heightPx: number;
  /** What it costs in the file. */
  bytes: number;
}

/** An uploaded bitmap, re-encoded to a PNG or JPEG data URL at most 2048 px a side. */
export interface DiagramRasterAsset {
  id: string;
  kind: 'raster';
  src: string;
  widthPx: number;
  heightPx: number;
  bytes: number;
}

export type KnownDiagramAsset = DiagramSvgAsset | DiagramRasterAsset;

/** An asset this build cannot read, kept verbatim like an unknown annotation. */
export interface UnknownDiagramAsset {
  id: string;
  unknown: Record<string, unknown>;
}

export type DiagramAsset = KnownDiagramAsset | UnknownDiagramAsset;

export function isKnownAsset(asset: DiagramAsset): asset is KnownDiagramAsset {
  return !('unknown' in asset);
}

export interface DiagramStep {
  /** `step-<uuid>`. */
  id: string;
  /**
   * Bumped whenever the source changes. A capture started against one revision
   * is discarded if it lands after another (async captures, D4).
   */
  revision: number;
  /** `null` is an empty step. */
  source: DiagramStepSource | null;
  /** The captured result; `null` until captured. */
  picture: DiagramPicture | null;
  annotations: DiagramAnnotation[];
  /** The picture key the annotations were drawn on (D8). */
  annotatedPictureKey: string | null;
  /** The instruction under the picture. */
  text: string;
  /** Start a new page at this step. */
  breakBefore: boolean;
  /**
   * Set when the step was written by a newer build in a shape this one cannot
   * read: the raw step, re-emitted verbatim on save. Such a step is locked — it
   * can be moved or deleted, never edited.
   */
  unknown?: Record<string, unknown>;
}

export interface DiagramDocument {
  formatVersion: typeof DIAGRAM_FORMAT_VERSION;
  /** `diagram-<uuid>`. */
  id: string;
  /** The header, the page title tab and the export filename's stem. */
  title: string;
  hanStyle: DiagramHanStyle;
  style: DiagramStyle;
  page: DiagramPageSetup;
  /** In order: a step's number is its index plus one. */
  steps: DiagramStep[];
  /** Uploaded art, shared by id between steps, duplicates and undo snapshots. */
  assets: Record<string, DiagramAsset>;
}

export type DiagramIdFactory = (prefix: 'diagram' | 'step' | 'annotation' | 'asset') => string;

export const randomDiagramId: DiagramIdFactory = (prefix) => `${prefix}-${crypto.randomUUID()}`;

export const PAGE_MARGIN_MM_RANGE = { min: 0, max: 30 } as const;
export const PAGE_COLUMNS_RANGE = { min: 2, max: 5 } as const;
export const PAGE_ROWS_RANGE = { min: 1, max: 6 } as const;
export const FIRST_PAGE_NUMBER_RANGE = { min: 1, max: 9999 } as const;

export const DEFAULT_PAGE_SETUP: DiagramPageSetup = {
  size: 'a4',
  orientation: 'portrait',
  marginMm: 12,
  layout: 'grid',
  columns: 3,
  rows: 3,
  showPath: true,
  scale: 'paper',
  showTitle: true,
  pageNumbers: { enabled: true, first: 1 },
};

export const DEFAULT_DIAGRAM_STYLE: DiagramStyle = { preset: 'diagram' };

/**
 * The Han style a new diagram starts in, from the author's interface language:
 * Japanese and Korean authors get their own forms, everyone else Simplified
 * Chinese (the app's Chinese locale is zh-CN). Changeable per diagram.
 */
export function defaultHanStyle(locale: string | null | undefined): DiagramHanStyle {
  const language = (locale ?? '').toLowerCase();
  if (language.startsWith('ja')) return 'jp';
  if (language.startsWith('ko')) return 'kr';
  if (language === 'zh-tw' || language === 'zh-hk' || language.startsWith('zh-hant')) return 'tc';
  return 'sc';
}

export function createDiagram(options: {
  title?: string;
  hanStyle?: DiagramHanStyle;
  newId?: DiagramIdFactory;
} = {}): DiagramDocument {
  const newId = options.newId ?? randomDiagramId;
  return {
    formatVersion: DIAGRAM_FORMAT_VERSION,
    id: newId('diagram'),
    title: xmlText(options.title ?? ''),
    hanStyle: options.hanStyle ?? 'sc',
    style: DEFAULT_DIAGRAM_STYLE,
    page: DEFAULT_PAGE_SETUP,
    steps: [],
    assets: {},
  };
}

export function createStep(newId: DiagramIdFactory = randomDiagramId): DiagramStep {
  return {
    id: newId('step'),
    revision: 0,
    source: null,
    picture: null,
    annotations: [],
    annotatedPictureKey: null,
    text: '',
    breakBefore: false,
  };
}

/** A step written by a newer build: it can be moved or deleted, never edited. */
export function isLockedStep(step: DiagramStep): boolean {
  return step.unknown !== undefined;
}

/** Whether a step has a picture, or a source to capture one from. */
export function stepHasPicture(step: DiagramStep): boolean {
  return step.source !== null || step.picture !== null;
}

/**
 * Whether deleting the step would throw work away: an instruction, a picture
 * or its source, annotations, or a step made by a newer build. An empty step
 * goes without asking.
 */
export function stepHasContent(step: DiagramStep): boolean {
  return (
    isLockedStep(step) ||
    step.text.trim() !== '' ||
    step.source !== null ||
    step.picture !== null ||
    step.annotations.length > 0
  );
}

export function stepIndex(document: DiagramDocument, stepId: string): number {
  return document.steps.findIndex((step) => step.id === stepId);
}

/**
 * Where an add lands: after the selected step, or at the end when nothing is
 * selected (D2's insertion rule).
 */
export function insertionIndex(document: DiagramDocument, selectedStepId: string | null): number {
  if (selectedStepId === null) return document.steps.length;
  const index = stepIndex(document, selectedStepId);
  return index < 0 ? document.steps.length : index + 1;
}

export function insertSteps(
  document: DiagramDocument,
  steps: readonly DiagramStep[],
  index: number
): DiagramDocument {
  if (steps.length === 0) return document;
  const at = clampInteger(index, 0, document.steps.length);
  return {
    ...document,
    steps: [...document.steps.slice(0, at), ...steps, ...document.steps.slice(at)],
  };
}

export function removeSteps(document: DiagramDocument, stepIds: readonly string[]): DiagramDocument {
  const removing = new Set(stepIds);
  const steps = document.steps.filter((step) => !removing.has(step.id));
  return steps.length === document.steps.length ? document : { ...document, steps };
}

/** Move a step so it ends up at `toIndex` (clamped). */
export function moveStep(document: DiagramDocument, stepId: string, toIndex: number): DiagramDocument {
  const from = stepIndex(document, stepId);
  if (from < 0) return document;
  const to = clampInteger(toIndex, 0, document.steps.length - 1);
  if (to === from) return document;
  const steps = document.steps.slice();
  const [step] = steps.splice(from, 1);
  steps.splice(to, 0, step);
  return { ...document, steps };
}

/**
 * A copy of a step, placed right after it, with fresh ids for the step and its
 * annotations. Assets are shared by id, so a duplicate costs no bytes. A locked
 * step is not duplicated: its raw form names its own id, and a copy could only
 * be a second step with the same one.
 */
export function duplicateStep(
  document: DiagramDocument,
  stepId: string,
  newId: DiagramIdFactory = randomDiagramId
): { document: DiagramDocument; stepId: string } | null {
  const index = stepIndex(document, stepId);
  if (index < 0) return null;
  const original = document.steps[index];
  if (isLockedStep(original)) return null;
  const copy: DiagramStep = {
    ...original,
    id: newId('step'),
    revision: 0,
    // A new page belongs to where the original starts one; the copy follows it.
    breakBefore: false,
    annotations: original.annotations.map((annotation) => {
      const id = newId('annotation');
      // One carried verbatim from a newer build is written back from its raw
      // form, so the fresh id has to go there too, or the copy is written out
      // under the original's.
      return annotation.unknown
        ? { ...annotation, id, unknown: { ...annotation.unknown, id } }
        : { ...annotation, id };
    }),
  };
  return { document: insertSteps(document, [copy], index + 1), stepId: copy.id };
}

/** The key of an upload's picture: the asset's, which never changes once stored. */
export function uploadPictureKey(assetId: string): string {
  return `asset:${assetId}`;
}

function uploadStepParts(asset: KnownDiagramAsset): Pick<DiagramStep, 'source' | 'picture'> {
  return {
    source: { kind: 'upload', assetId: asset.id, rotationQuarterTurns: 0, mirrored: false },
    picture: { kind: 'asset', assetId: asset.id, paperScale: null, key: uploadPictureKey(asset.id) },
  };
}

function withAssets(document: DiagramDocument, assets: readonly KnownDiagramAsset[]): DiagramDocument {
  if (assets.length === 0) return document;
  const table = { ...document.assets };
  for (const asset of assets) table[asset.id] = asset;
  return { ...document, assets: table };
}

/**
 * One new step per picture, in the order given, inserted at `index`. The
 * assets go into the table; each step refers to its own by id.
 */
export function insertPictureSteps(
  document: DiagramDocument,
  assets: readonly KnownDiagramAsset[],
  index: number,
  newId: DiagramIdFactory = randomDiagramId
): { document: DiagramDocument; stepIds: string[] } {
  const steps = assets.map((asset) => ({ ...createStep(newId), ...uploadStepParts(asset) }));
  return {
    document: insertSteps(withAssets(document, assets), steps, index),
    stepIds: steps.map((step) => step.id),
  };
}

/**
 * Give a step a picture: it becomes an upload of `asset`, in its upright pose,
 * and keeps its instruction and annotations. Annotations drawn on another
 * picture stay where they were, and Annotate says the picture changed.
 */
export function setStepPicture(
  document: DiagramDocument,
  stepId: string,
  asset: KnownDiagramAsset
): DiagramDocument {
  const index = stepIndex(document, stepId);
  if (index < 0 || isLockedStep(document.steps[index])) return document;
  return updateStep(withAssets(document, [asset]), stepId, (step) => ({
    ...step,
    ...uploadStepParts(asset),
    revision: step.revision + 1,
  }));
}

/** A linked step's picture as a capture made it: its source, and the picture with any bitmap it is kept as. */
export interface CapturedLink {
  source: DiagramCpSource;
  picture: DiagramPicture | null;
  /** The bitmap a picture too detailed to keep as vector is kept as; `picture` names it. */
  asset?: KnownDiagramAsset;
}

/**
 * Link a step to the pattern, or give a linked step a new capture: its source
 * and picture become the capture's, and it keeps its instruction and
 * annotations. A capture that changes nothing — the same source, and a picture
 * with the same key — is no edit, so a Refresh of a current step records no
 * undo step.
 */
export function setLinkedPicture(
  document: DiagramDocument,
  stepId: string,
  link: CapturedLink
): DiagramDocument {
  const index = stepIndex(document, stepId);
  if (index < 0 || isLockedStep(document.steps[index])) return document;
  const step = document.steps[index];
  if (
    (step.picture?.key ?? null) === (link.picture?.key ?? null) &&
    JSON.stringify(step.source) === JSON.stringify(withRememberedPoses(step.source, link.source))
  ) {
    return document;
  }
  const withAsset = withAssets(document, link.asset ? [link.asset] : []);
  return updateStep(withAsset, stepId, (current) =>
    withCarriedAnnotations(
      current,
      {
        ...current,
        source: withRememberedPoses(current.source, link.source),
        picture: link.picture,
        revision: current.revision + 1,
      },
      withAsset.assets
    )
  );
}

/** One References card, as a step is made from it. */
export interface SentReferencesStep {
  source: DiagramReferencesSource;
  picture: DiagramStepDiagramPicture;
  /** The card's sentence: the step's instruction until it is edited. */
  text: string;
}

/**
 * The step From References… waits to fill, when it still can be filled: it is
 * there, made by this build, and has no picture or source yet. Null
 * otherwise — a step that got a picture some other way waits for nothing.
 * The one rule the card, the Step pane, References' label and the send share.
 */
export function awaitingReferencesStep(
  document: DiagramDocument | null,
  target: string | null
): DiagramStep | null {
  if (!document || target === null) return null;
  const step = document.steps[stepIndex(document, target)];
  return step && !isLockedStep(step) && !stepHasPicture(step) ? step : null;
}

/**
 * Cards from References as steps, at `index`, in order. With `fill`, the
 * first card goes into that step instead — the one From References… was
 * asked from — when it is still there and still empty; its words are kept if
 * it has any. The steps the cards became, in order.
 */
export function insertReferencesSteps(
  document: DiagramDocument,
  sent: readonly SentReferencesStep[],
  index: number,
  { fill = null, newId = randomDiagramId }: { fill?: string | null; newId?: DiagramIdFactory } = {}
): { document: DiagramDocument; stepIds: string[] } {
  if (sent.length === 0) return { document, stepIds: [] };
  const fillAt = fill === null ? -1 : stepIndex(document, fill);
  const target = fillAt >= 0 ? document.steps[fillAt] : undefined;
  const fills = awaitingReferencesStep(document, fill) !== null;
  const make = (card: SentReferencesStep): DiagramStep => ({
    ...createStep(newId),
    source: card.source,
    picture: card.picture,
    text: xmlText(card.text),
  });
  if (!fills || !target) {
    const steps = sent.map(make);
    return {
      document: insertSteps(document, steps, target !== undefined ? fillAt + 1 : index),
      stepIds: steps.map((step) => step.id),
    };
  }
  const [first, ...rest] = sent;
  const filled = updateStep(document, target.id, (step) => ({
    ...step,
    source: first!.source,
    picture: first!.picture,
    text: step.text.trim() === '' ? xmlText(first!.text) : step.text,
    revision: step.revision + 1,
  }));
  const steps = rest.map(make);
  return {
    document: insertSteps(filled, steps, fillAt + 1),
    stepIds: [target.id, ...steps.map((step) => step.id)],
  };
}

/** A step-diagram picture's key for a side: the model's own key, marked for the back. */
export function stepDiagramKey(modelKey: string, mirrored: boolean): string {
  const base = modelKey.endsWith(BACK_SUFFIX) ? modelKey.slice(0, -BACK_SUFFIX.length) : modelKey;
  return mirrored ? `${base}${BACK_SUFFIX}` : base;
}

const BACK_SUFFIX = '-back';

/**
 * Show a References step from one side or the other (D5: its pose is Turn
 * over). The picture is re-keyed, and its annotations are flipped with it
 * (D8); the source keeps the side the card was sent from.
 */
export function setReferencesSide(document: DiagramDocument, stepId: string, mirrored: boolean): DiagramDocument {
  return updateStep(document, stepId, (step) => {
    if (step.source?.kind !== 'references-step' || step.picture?.kind !== 'step-diagram') return step;
    if (step.picture.mirrored === mirrored) return step;
    const turned: DiagramStep = {
      ...step,
      picture: { ...step.picture, mirrored, key: stepDiagramKey(step.picture.key, mirrored) },
      revision: step.revision + 1,
    };
    return withCarriedAnnotations(step, turned, document.assets);
  });
}

/** An upload's pose: how its shared asset is turned and flipped when the step is painted. */
export interface UploadPose {
  rotationQuarterTurns: QuarterTurns;
  mirrored: boolean;
}

/** The pose turned a quarter clockwise (1) or anticlockwise (-1), as it is shown. */
export function rotatePose(pose: UploadPose, quarterTurns: 1 | -1): UploadPose {
  const turns = (((pose.rotationQuarterTurns + quarterTurns) % 4) + 4) % 4;
  return { ...pose, rotationQuarterTurns: turns as QuarterTurns };
}

/**
 * The pose flipped left to right, as it is shown. The stored pose mirrors
 * first and turns after, so a flip of a turned picture also reverses its turn.
 */
export function mirrorPose(pose: UploadPose): UploadPose {
  return {
    rotationQuarterTurns: ((4 - pose.rotationQuarterTurns) % 4) as QuarterTurns,
    mirrored: !pose.mirrored,
  };
}

/**
 * Why a step's picture cannot be posed, or `null` when it can: it must be an
 * upload, and carry no annotation this build cannot read. A pose change carries
 * annotations with the picture (D8), and one that cannot be read cannot be
 * carried — it would be left pointing at the old pose.
 */
export function poseBlocker(step: DiagramStep): 'not-upload' | 'unknown-annotations' | null {
  if (isLockedStep(step) || step.source?.kind !== 'upload') return 'not-upload';
  const carried = step.annotations.some((annotation) => annotation.unknown !== undefined);
  if (carried) return 'unknown-annotations';
  return null;
}

/** Set an upload's pose, its annotations turned with it (D8). A no-op for a step {@link poseBlocker} refuses. */
export function setUploadPose(
  document: DiagramDocument,
  stepId: string,
  pose: UploadPose
): DiagramDocument {
  return updateStep(document, stepId, (step) => {
    if (poseBlocker(step) !== null || step.source?.kind !== 'upload') return step;
    const { rotationQuarterTurns, mirrored } = step.source;
    if (rotationQuarterTurns === pose.rotationQuarterTurns && mirrored === pose.mirrored) return step;
    const posed: DiagramStep = {
      ...step,
      source: { ...step.source, rotationQuarterTurns: pose.rotationQuarterTurns, mirrored: pose.mirrored },
      revision: step.revision + 1,
    };
    return withCarriedAnnotations(step, posed, document.assets);
  });
}

/**
 * A step's annotations edited: `edit` gets the readable ones and returns them
 * as they should be; one this build cannot read keeps its place. Touching
 * them marks them drawn on the picture the step has now (D8: "until they are
 * touched"). A step with no picture takes none.
 */
export function editStepAnnotations(
  document: DiagramDocument,
  stepId: string,
  edit: (annotations: readonly KnownDiagramAnnotation[]) => readonly KnownDiagramAnnotation[]
): DiagramDocument {
  return updateStep(document, stepId, (step) => {
    if (step.picture === null) return step;
    const known = step.annotations.filter(isKnownAnnotation);
    // As this build writes them, whoever made them: within reach, a label's text clean.
    const edited = edit(known).map(cleanAnnotation);
    if (sameAnnotations(edited, known)) return step;
    // A step holds no more than a file keeps.
    if (edited.length + (step.annotations.length - known.length) > MAX_STEP_ANNOTATIONS) return step;
    return { ...step, annotations: mergeAnnotations(step.annotations, edited), annotatedPictureKey: step.picture.key };
  });
}

/**
 * A step's annotations kept where they are on the picture it has now: what
 * the "picture changed" notice offers when they are right as they stand. A
 * no-op when they are already in step with it.
 */
export function keepStepAnnotations(document: DiagramDocument, stepId: string): DiagramDocument {
  return updateStep(document, stepId, (step) =>
    step.picture === null || step.annotations.length === 0 || step.annotatedPictureKey === step.picture.key
      ? step
      : { ...step, annotatedPictureKey: step.picture.key }
  );
}

/** Whether a step's annotations were drawn on a picture other than the one it has (D8). */
export function annotationsOutOfStep(step: DiagramStep): boolean {
  return step.annotations.length > 0 && step.annotatedPictureKey !== (step.picture?.key ?? null);
}

/**
 * The step's annotations with the readable ones replaced by `edited`: each one
 * kept in its place, one taken out gone, a new one last — so one this build
 * cannot read keeps its place among them, and a newer build draws them in the
 * order it did.
 */
function mergeAnnotations(
  annotations: readonly DiagramAnnotation[],
  edited: readonly KnownDiagramAnnotation[]
): DiagramAnnotation[] {
  if (annotations.every(isKnownAnnotation)) return [...edited];
  const byId = new Map(edited.map((annotation) => [annotation.id, annotation]));
  const merged: DiagramAnnotation[] = [];
  for (const annotation of annotations) {
    if (!isKnownAnnotation(annotation)) merged.push(annotation);
    else if (byId.has(annotation.id)) {
      merged.push(byId.get(annotation.id)!);
      byId.delete(annotation.id);
    }
  }
  return [...merged, ...byId.values()];
}

/**
 * Whether two lists say the same, field for field: a control pressed on the
 * value it already shows builds a new annotation, and must not cost an undo step.
 */
function sameAnnotations(a: readonly KnownDiagramAnnotation[], b: readonly KnownDiagramAnnotation[]): boolean {
  return (
    a.length === b.length &&
    a.every((annotation, index) => annotation === b[index] || JSON.stringify(annotation) === JSON.stringify(b[index]))
  );
}

/** Take a step's picture away, and its source with it. Its words and annotations stay. */
export function removeStepPicture(document: DiagramDocument, stepId: string): DiagramDocument {
  return updateStep(document, stepId, (step) =>
    stepHasPicture(step)
      ? { ...step, source: null, picture: null, revision: step.revision + 1 }
      : step
  );
}

/** The asset a step's picture is drawn from, when it is one this build can draw. */
export function stepAsset(document: DiagramDocument, step: DiagramStep): KnownDiagramAsset | null {
  if (isLockedStep(step) || step.picture?.kind !== 'asset') return null;
  const asset = document.assets[step.picture.assetId];
  return asset && isKnownAsset(asset) ? asset : null;
}

/**
 * The document as a file holds it: only the assets something still refers to.
 *
 * The store prunes as every edit lands, since each undo snapshot keeps its own
 * table, and the writer prunes again for a document from anywhere else (one
 * read from a hand-edited file). Three things keep an asset: a step's source or picture naming it; its id anywhere in a
 * newer build's step, annotation or asset, which this build cannot read but must not break; and
 * being of a kind this build does not know, since only that newer build knows
 * what refers to it. The same document comes back when nothing is dropped.
 */
export function withReferencedAssets(document: DiagramDocument): DiagramDocument {
  const kept = new Set<string>();
  const carried: string[] = [];
  for (const step of document.steps) {
    if (step.unknown) {
      carried.push(JSON.stringify(step.unknown));
      continue;
    }
    if (step.source?.kind === 'upload') kept.add(step.source.assetId);
    if (step.picture?.kind === 'asset') kept.add(step.picture.assetId);
    // A newer build's annotation may name an asset, as its step may.
    for (const annotation of step.annotations) {
      if (!isKnownAnnotation(annotation)) carried.push(JSON.stringify(annotation.unknown));
    }
  }
  for (const asset of Object.values(document.assets)) {
    if (!isKnownAsset(asset)) carried.push(JSON.stringify(asset.unknown));
  }
  const unknownSteps = carried.join('\n');
  let dropped = false;
  const assets: Record<string, DiagramAsset> = {};
  for (const [id, asset] of Object.entries(document.assets)) {
    if (kept.has(id) || !isKnownAsset(asset) || unknownSteps.includes(id)) assets[id] = asset;
    else dropped = true;
  }
  return dropped ? { ...document, assets } : document;
}

export function setStepText(document: DiagramDocument, stepId: string, text: string): DiagramDocument {
  const clean = xmlText(text);
  return updateStep(document, stepId, (step) =>
    step.text === clean ? step : { ...step, text: clean }
  );
}

export function setStepBreakBefore(
  document: DiagramDocument,
  stepId: string,
  breakBefore: boolean
): DiagramDocument {
  return updateStep(document, stepId, (step) =>
    step.breakBefore === breakBefore ? step : { ...step, breakBefore }
  );
}

export function setDiagramTitle(document: DiagramDocument, title: string): DiagramDocument {
  const clean = xmlText(title);
  return document.title === clean ? document : { ...document, title: clean };
}

export function setHanStyle(document: DiagramDocument, hanStyle: DiagramHanStyle): DiagramDocument {
  return document.hanStyle === hanStyle ? document : { ...document, hanStyle };
}

export function setDiagramStyle(document: DiagramDocument, style: DiagramStyle): DiagramDocument {
  return diagramStyleEquals(document.style, style) ? document : { ...document, style };
}

/** Apply a partial page setup, clamped to the legal ranges. */
export function setPageSetup(
  document: DiagramDocument,
  patch: Partial<DiagramPageSetup>
): DiagramDocument {
  const next = normalizePageSetup({ ...document.page, ...patch });
  return pageSetupEquals(document.page, next) ? document : { ...document, page: next };
}

/**
 * Edit one step. A locked step is never handed to `edit`: a newer build's step
 * is only ever carried, so the raw form written back is exactly the one read.
 */
function updateStep(
  document: DiagramDocument,
  stepId: string,
  edit: (step: DiagramStep) => DiagramStep
): DiagramDocument {
  const index = stepIndex(document, stepId);
  if (index < 0) return document;
  const step = document.steps[index];
  if (isLockedStep(step)) return document;
  const next = edit(step);
  if (next === step) return document;
  const steps = document.steps.slice();
  steps[index] = next;
  return { ...document, steps };
}

export const PAPER_SIZES: readonly DiagramPaperSize[] = ['a4', 'a5', 'b5-jis', 'letter'];

/**
 * A page setup from anything, every field checked and clamped, each falling
 * back to its default on its own. Used by the edit above and by the file
 * reader, so a hand-edited file and a stepper reach the same legal values.
 */
export function normalizePageSetup(value: unknown): DiagramPageSetup {
  const source = isRecord(value) ? value : {};
  const numbers = isRecord(source.pageNumbers) ? source.pageNumbers : {};
  return {
    size: PAPER_SIZES.includes(source.size as DiagramPaperSize)
      ? (source.size as DiagramPaperSize)
      : DEFAULT_PAGE_SETUP.size,
    orientation:
      source.orientation === 'landscape' || source.orientation === 'portrait'
        ? source.orientation
        : DEFAULT_PAGE_SETUP.orientation,
    marginMm: clampNumber(source.marginMm, PAGE_MARGIN_MM_RANGE, DEFAULT_PAGE_SETUP.marginMm),
    layout:
      source.layout === 'flow' || source.layout === 'grid' ? source.layout : DEFAULT_PAGE_SETUP.layout,
    columns: clampWhole(source.columns, PAGE_COLUMNS_RANGE, DEFAULT_PAGE_SETUP.columns),
    rows: clampWhole(source.rows, PAGE_ROWS_RANGE, DEFAULT_PAGE_SETUP.rows),
    showPath: typeof source.showPath === 'boolean' ? source.showPath : DEFAULT_PAGE_SETUP.showPath,
    scale: source.scale === 'fit' || source.scale === 'paper' ? source.scale : DEFAULT_PAGE_SETUP.scale,
    showTitle:
      typeof source.showTitle === 'boolean' ? source.showTitle : DEFAULT_PAGE_SETUP.showTitle,
    pageNumbers: {
      enabled:
        typeof numbers.enabled === 'boolean'
          ? numbers.enabled
          : DEFAULT_PAGE_SETUP.pageNumbers.enabled,
      first: clampWhole(numbers.first, FIRST_PAGE_NUMBER_RANGE, DEFAULT_PAGE_SETUP.pageNumbers.first),
    },
  };
}

export function pageSetupEquals(a: DiagramPageSetup, b: DiagramPageSetup): boolean {
  return (
    a.size === b.size &&
    a.orientation === b.orientation &&
    a.marginMm === b.marginMm &&
    a.layout === b.layout &&
    a.columns === b.columns &&
    a.rows === b.rows &&
    a.showPath === b.showPath &&
    a.scale === b.scale &&
    a.showTitle === b.showTitle &&
    a.pageNumbers.enabled === b.pageNumbers.enabled &&
    a.pageNumbers.first === b.pageNumbers.first
  );
}

function diagramStyleEquals(a: DiagramStyle, b: DiagramStyle): boolean {
  if ('preset' in a || 'preset' in b) {
    return 'preset' in a && 'preset' in b && a.preset === b.preset;
  }
  return JSON.stringify(a.style) === JSON.stringify(b.style);
}

function clampNumber(
  value: unknown,
  range: { min: number; max: number },
  fallback: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, value));
}

function clampWhole(value: unknown, range: { min: number; max: number }, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return clampInteger(Math.round(value), range.min, range.max);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
