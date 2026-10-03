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
import type { FoldedSourceBounds } from '../../cp-workspace/folded/foldedFigureStaleness';
import type { RegionReference } from '../../cp-workspace/regions/regionReference';
import type { SheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import type { BuiltInPaperPresetId } from '../../lib/paper/paperPresets';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { xmlText } from '../../lib/xmlEscape';

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
 * How a crease-pattern step chooses its creases (D3): a region of the pattern,
 * picked in the Diagram and found again by its rim; or the box a folded figure
 * in Edit was folded from, its creases re-chosen by overlap as Edit refolds.
 */
export type DiagramCpScope =
  | { kind: 'segment'; region: RegionReference }
  | { kind: 'figure-bounds'; bounds: FoldedSourceBounds };

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
  | { mode: 'folded-3d'; camera: FoldedFigureCamera; side: 'front' | 'back' };

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
}

/**
 * Where a step's picture comes from. The variants arrive with the phases that
 * build them, and a source this build does not know makes the step an
 * unknown, locked one (see {@link DiagramStep.unknown}).
 */
export type DiagramStepSource = DiagramUploadSource | DiagramCpSource;

/**
 * A picture held in the assets table: an upload, or (from Phase 3) a capture
 * too large to keep inline. `key` names the picture, for the paint cache and
 * for telling whether annotations were drawn on it.
 */
export interface DiagramAssetPicture {
  kind: 'asset';
  assetId: string;
  /** Millimetres per picture unit, when the picture knows its paper's size; an upload does not. */
  paperScale: number | null;
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

/** A step's captured picture. Variants arrive with their phases, as sources do. */
export type DiagramPicture = DiagramAssetPicture | DiagramScenePicture | DiagramFixedPicture;

/**
 * An annotation this build cannot read, kept verbatim so a newer build's work
 * survives a round trip through this one. Readable kinds arrive with Annotate.
 */
export interface UnknownDiagramAnnotation {
  id: string;
  unknown: Record<string, unknown>;
}

export type DiagramAnnotation = UnknownDiagramAnnotation;

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
    JSON.stringify(step.source) === JSON.stringify(link.source)
  ) {
    return document;
  }
  return updateStep(withAssets(document, link.asset ? [link.asset] : []), stepId, (current) => ({
    ...current,
    source: link.source,
    picture: link.picture,
    revision: current.revision + 1,
  }));
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

/** Set an upload's pose. A no-op for a step {@link poseBlocker} refuses. */
export function setUploadPose(
  document: DiagramDocument,
  stepId: string,
  pose: UploadPose
): DiagramDocument {
  return updateStep(document, stepId, (step) => {
    if (poseBlocker(step) !== null || step.source?.kind !== 'upload') return step;
    const { rotationQuarterTurns, mirrored } = step.source;
    if (rotationQuarterTurns === pose.rotationQuarterTurns && mirrored === pose.mirrored) return step;
    return {
      ...step,
      source: { ...step.source, rotationQuarterTurns: pose.rotationQuarterTurns, mirrored: pose.mirrored },
      revision: step.revision + 1,
    };
  });
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
 * newer build's step, which this build cannot read but must not break; and
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
