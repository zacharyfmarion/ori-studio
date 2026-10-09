/**
 * A diagram as it is stored in the project file (each of `workspace.diagrams`),
 * read leniently and written back exactly.
 *
 * Three rules, from implementation-plans/diagram-workspace.md (Contracts):
 *
 * - **Malformed is dropped.** A step, annotation or asset that does not read is
 *   left out; the rest of the diagram opens. A diagram that is not an object at
 *   all reads as no diagram.
 * - **Unknown is kept.** An unrecognised kind, field or enumerated value at
 *   any depth — a step's source or picture, a render or its camera, a
 *   thumbnail's line, a scene's item, an annotation, an asset — is not
 *   malformed: it is a newer build's work. So is content past what this build
 *   keeps: an SVG, a scene or a References card longer than its cap, a bitmap
 *   larger than it reads or in another format, a number past the range it
 *   reads. The enclosing step, annotation or asset is carried verbatim in its
 *   `unknown` field and written back unchanged, so a desktop build that lags
 *   the web build never deletes what it cannot show (decision 1 of the launch
 *   review, 2026-10-09).
 * - **A newer document opens read-only.** When `formatVersion` is above this
 *   build's, the whole raw value is kept and written back unchanged; what is
 *   shown is a best-effort reading of it. Nothing else does: a document-level
 *   field or value a newer build wrote falls back alone, and is written back
 *   as it came (`DiagramNewerFields`, decision 2 of the launch review).
 *
 * Every string a user typed passes through `xmlText` on the way in, so what is
 * stored can always be written into an SVG page. Every uploaded SVG is
 * sanitized again on the way in, and every uploaded bitmap's header checked
 * against its stored size (D7): a file edited by hand is held to the rules an
 * upload was.
 *
 * React-free and store-free. The DOM is reached only through the injected
 * `SanitizeEnv`, and only when the diagram holds an SVG.
 */

import { FOLDED_FIGURE_CAMERA_KEYS, readFoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import {
  SPREAD_DIRECTIONS,
  SPREAD_KEEPS,
  SPREAD_KINDS,
  type SpreadDirection,
  type SpreadKeep,
  type SpreadKind,
} from '../../cp-workspace/folded/foldedLayerSpread';
import type { DiagramWhiteArrowWidth } from '../../cp-workspace/references/diagram/diagramInk';
import type { WhiteArrowTail } from '../../cp-workspace/references/stepDiagramGeometry';
import { readRegionReference } from '../../cp-workspace/regions/regionReference';
import { isNewerSheetThumbnail, readSheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import { isBuiltInPaperPresetId } from '../../lib/paper/paperPresets';
import { isNewerPaperScene, readPaperScene } from '../../lib/paper/paperSceneValidate';
import { normalizePaperStyle } from '../../lib/paper/paperStyle';
import { xmlText } from '../../lib/xmlEscape';
import {
  PICTURE_REACH,
  angleMarkArms,
  arrowShape,
  behindEnds,
  CLOSE_UP_SCALE,
  DEFAULT_ROTATION,
  DEFAULT_WHITE_ARROW,
  DIVISIONS_OFFSET_MM,
  DIVISIONS_PARTS,
  GLYPH_SCALE,
  LABEL_MAX_LENGTH,
  MAX_BEHIND_LAYERS,
  MAX_BEND,
  MAX_CLOSE_UP_RADIUS,
  MAX_PATH_NODES,
  MAX_STEP_ANNOTATIONS,
  MIN_CLOSE_UP_RADIUS,
  ZOOM_SIDE,
  isAreaKind,
  isPointKind,
  isWithinReach,
  rectangleAngle,
  type AnnotationReach,
} from '../annotate/annotationModel';
import { isAnnotationColor } from '../annotate/annotationColors';
import { TEXT_OFFSET_PT_MAX, TEXT_SIZE_PT } from '../annotate/textStyle';
import { windowReach } from '../zoom/zoomModel';
import { NEWER_PAPER_FACES, SCENE_JSON_MAX_BYTES, readPaperFaces } from './paperFacesFile';
import {
  EMBEDDED_RASTER_MAX_SIDE,
  SVG_STORED_MAX_BYTES,
  browserSanitizeEnv,
  rasterHeaderSize,
  sanitizeSvg,
  type SanitizeEnv,
} from '../upload/svgSanitize';
import {
  DEFAULT_DIAGRAM_STYLE,
  DIAGRAM_FORMAT_VERSION,
  DIAGRAM_PAGE_SIDES,
  DIAGRAM_SHOW_AS,
  FIRST_PAGE_NUMBER_RANGE,
  PAGE_COLUMNS_RANGE,
  PAGE_MARGIN_MM_RANGE,
  PAGE_ROWS_RANGE,
  PAPER_SIZES,
  PATH_WIDTH_MM_RANGE,
  SPREAD_AMOUNT_RANGE,
  SPREAD_AXIS_RANGE,
  SPREAD_SKEW_RANGE,
  isTurn,
  showAsOf,
  isKnownAsset,
  normalizePageSetup,
  DEFAULT_PATH_COLOR,
  DEFAULT_PATH_WIDTH_MM,
  readHexColor,
  randomDiagramId,
  withReferencedAssets,
  isKnownAnnotation,
  type DiagramNewerFields,
  type DiagramTicks,
  type DiagramAnnotation,
  type DiagramAnnotationKind,
  type DiagramBehind,
  type DiagramImportedMark,
  type DiagramPathNode,
  type DiagramPleatKinks,
  type DiagramRotation,
  type KnownDiagramAnnotation,
  type DiagramAsset,
  type KnownDiagramAsset,
  type DiagramCpRender,
  type DiagramCpScope,
  type DiagramCpSource,
  type DiagramDocument,
  type DiagramEntry,
  type DiagramReferencesSource,
  type DiagramFixedPicture,
  type DiagramPicture,
  type DiagramHanStyle,
  type DiagramIdFactory,
  type DiagramLayerSpread,
  type DiagramPageSetup,
  type DiagramRasterAsset,
  type DiagramShowAs,
  type DiagramStep,
  type DiagramStepSource,
  type DiagramStyle,
  type DiagramSvgAsset,
  type DiagramTurn,
  type DiagramPaperFaces,
  type DiagramScenePicture,
  type DiagramStepPlace,
  type DiagramStepZoom,
  type DiagramZoomEdge,
  type DiagramZoomAreaWas,
  type DiagramZoomOutline,
  type DiagramZoomShape,
  type QuarterTurns,
  type ReferencesPlanSettings,
} from './diagramDocument';
import { validateStepDiagramModel } from './stepDiagramModelFile';
import { normalizeStepPlace, PLACE_OFFSETS, placeOffset, placeScale } from './stepPlace';

/** A diagram read from a file. */
export interface ReadDiagram {
  document: DiagramDocument;
  /**
   * The file was written by a newer build (`formatVersion` above this one's).
   * The document shown is a best-effort reading; nothing may change it, and
   * {@link raw} is what is written back.
   */
  readOnly: boolean;
  /** The value as read, for writing back a read-only diagram unchanged. */
  raw: Record<string, unknown>;
}

export interface ReadDiagramOptions {
  newId?: DiagramIdFactory;
  /** Parses and serializes the SVG assets sanitized on the way in; the browser's by default. */
  sanitizeEnv?: SanitizeEnv;
}

/**
 * Read one of `workspace.diagrams`. `null` for an absent diagram or one that
 * is not an object.
 */
export function readDiagram(value: unknown, options: ReadDiagramOptions = {}): ReadDiagram | null {
  if (!isRecord(value)) return null;
  const newId = options.newId ?? randomDiagramId;
  const formatVersion = typeof value.formatVersion === 'number' ? value.formatVersion : 1;
  // Made only when the diagram holds an SVG, so reading one without needs no DOM.
  let sanitizeEnv = options.sanitizeEnv;
  const env = () => (sanitizeEnv ??= browserSanitizeEnv());
  const assets = readAssets(value.assets, env);
  const steps: DiagramEntry[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(value.steps) ? value.steps : []) {
    const step = readEntry(entry, assets, env);
    // Two steps with one id would make every edit by id ambiguous; the first
    // one wins and the copy is malformed.
    if (step && !seen.has(step.id)) {
      seen.add(step.id);
      steps.push(step);
    }
  }
  const newer = readNewerFields(value);
  const document: DiagramDocument = {
    formatVersion: DIAGRAM_FORMAT_VERSION,
    id: typeof value.id === 'string' && value.id.length > 0 ? value.id : newId('diagram'),
    title: typeof value.title === 'string' ? xmlText(value.title) : '',
    hanStyle: readHanStyle(value.hanStyle),
    style: readStyle(value.style),
    page: normalizePageSetup(value.page),
    steps,
    assets,
    ...(newer ? { newer } : {}),
  };
  return { document, readOnly: formatVersion > DIAGRAM_FORMAT_VERSION, raw: value };
}

const DOCUMENT_KEYS = new Set([
  'formatVersion',
  'id',
  'title',
  'hanStyle',
  'style',
  'page',
  'steps',
  'assets',
]);
const PAGE_KEYS = new Set([
  'size',
  'orientation',
  'marginMm',
  'layout',
  'columns',
  'rows',
  'showPath',
  'pathWidthMm',
  'pathColor',
  'firstPageSide',
  // Retired 2026-10-06, when every diagram came to fit each: the choice of One
  // scale (`paper`) or Fit each (`fit`). Whatever it says is let go, and it is
  // never written.
  'scale',
  'showTitle',
  'pageNumbers',
]);
const PAGE_ENUMS: Record<string, readonly string[]> = {
  size: PAPER_SIZES,
  orientation: ['portrait', 'landscape'],
  layout: ['grid', 'flow'],
  firstPageSide: DIAGRAM_PAGE_SIDES,
};

/** The ranges a page's numbers are read within: past one, a number is a newer build's. */
const PAGE_RANGES: Readonly<Record<string, { readonly min: number; readonly max: number }>> = {
  marginMm: PAGE_MARGIN_MM_RANGE,
  columns: PAGE_COLUMNS_RANGE,
  rows: PAGE_ROWS_RANGE,
  pathWidthMm: PATH_WIDTH_MM_RANGE,
};
const PAGE_NUMBERS_KEYS: ReadonlySet<string> = new Set(['enabled', 'first']);
const STYLE_KEYS: ReadonlySet<string> = new Set(['preset', 'style']);

/**
 * What a newer build wrote at the document's level that this build cannot
 * read, each part as it came (decision 2 of the launch review): a field it
 * has no name for, a Han style or a style it does not read, a page field it
 * has no name for or whose value it does not read. Each falls back alone —
 * shown as this build's default or nearest, the rest of the diagram editable
 * — and is written back as it came until it is changed here. A value of the
 * wrong type is damage rather than news, and is replaced as before.
 */
function readNewerFields(value: Record<string, unknown>): DiagramNewerFields | undefined {
  const fields = Object.fromEntries(Object.entries(value).filter(([key]) => !DOCUMENT_KEYS.has(key)));
  const page = readNewerPage(value.page);
  const newer: DiagramNewerFields = {
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
    ...(typeof value.hanStyle === 'string' && !HAN_STYLES.includes(value.hanStyle) ? { hanStyle: value.hanStyle } : {}),
    ...(isRecord(value.style) && isNewerStyle(value.style) ? { style: value.style } : {}),
    ...(page ? { page } : {}),
  };
  return Object.keys(newer).length > 0 ? newer : undefined;
}

/**
 * A style a newer build wrote: with a field this build has no name for, a
 * preset it does not have, or a paper style it would write back other than
 * it came — a field, a pen or a light it does not read.
 */
function isNewerStyle(value: Record<string, unknown>): boolean {
  if (hasNewerKey(value, STYLE_KEYS)) return true;
  if (typeof value.preset === 'string') return !isBuiltInPaperPresetId(value.preset);
  if (!isRecord(value.style)) return false;
  return !sameJson(JSON.parse(JSON.stringify(normalizePaperStyle(value.style))), value.style);
}

/** The page fields of {@link readNewerFields}, under their keys; none when every one reads. */
function readNewerPage(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const page: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!PAGE_KEYS.has(key)) page[key] = entry;
    else if (Object.hasOwn(PAGE_ENUMS, key) && isNewerWord(entry, PAGE_ENUMS[key]!)) page[key] = entry;
    else if (Object.hasOwn(PAGE_RANGES, key) && isPastRange(entry, PAGE_RANGES[key]!)) page[key] = entry;
  }
  // A colour this build cannot read — another notation, a colour with alpha — is a newer build's.
  if (typeof value.pathColor === 'string' && readHexColor(value.pathColor) === null) page.pathColor = value.pathColor;
  const numbers = value.pageNumbers;
  if (isRecord(numbers) && (hasNewerKey(numbers, PAGE_NUMBERS_KEYS) || isPastRange(numbers.first, FIRST_PAGE_NUMBER_RANGE))) {
    page.pageNumbers = numbers;
  }
  return Object.keys(page).length > 0 ? page : undefined;
}

/** A finite number outside `range`: a newer build's, which reads further. */
function isPastRange(value: unknown, range: { readonly min: number; readonly max: number }): boolean {
  return typeof value === 'number' && Number.isFinite(value) && (value < range.min || value > range.max);
}

/** Two JSON values alike, whatever the order of their keys. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((entry, index) => sameJson(entry, b[index]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}

const HAN_STYLES: readonly string[] = ['sc', 'tc', 'jp', 'kr'];

/**
 * A diagram's value in `workspace.diagrams`. A read-only diagram is written as
 * it was read; otherwise every field is named here, a locked step, annotation
 * or asset goes back exactly as it came, and an asset nothing refers to any
 * more is left out (`withReferencedAssets`).
 */
export function writeDiagram(
  current: DiagramDocument,
  readOnlyRaw: Record<string, unknown> | null = null
): Record<string, unknown> {
  if (readOnlyRaw) return readOnlyRaw;
  const document = withReferencedAssets(current);
  // What a newer build wrote that this one cannot read goes back in its place, as it came.
  const { newer } = document;
  return {
    formatVersion: DIAGRAM_FORMAT_VERSION,
    id: document.id,
    title: document.title,
    hanStyle: newer?.hanStyle ?? document.hanStyle,
    style: newer?.style ?? document.style,
    page: { ...writePageSetup(document.page), ...newer?.page },
    steps: document.steps.map(writeStep),
    assets: Object.fromEntries(
      Object.entries(document.assets).map(([id, asset]) => [id, writeAsset(asset)])
    ),
    ...newer?.fields,
  };
}

/**
 * The page setup as written: every field, but the first page's side only when
 * it is the right, and the flow band's width and colour only when not their
 * defaults — so a diagram that never chose, as every one before the choices,
 * opens in a build that does not know them as it was made.
 *
 * The layout is always written. One that is not said reads as the grid
 * (`UNSAID_PAGE_LAYOUT`), the layout of every diagram saved before the flow
 * became a new one's default; a new diagram's flow is said, so it stays one.
 */
function writePageSetup(page: DiagramPageSetup): Record<string, unknown> {
  const { firstPageSide, pathWidthMm, pathColor, ...rest } = page;
  return {
    ...rest,
    ...(pathWidthMm !== DEFAULT_PATH_WIDTH_MM ? { pathWidthMm } : {}),
    ...(pathColor !== DEFAULT_PATH_COLOR ? { pathColor } : {}),
    ...(firstPageSide === 'right' ? { firstPageSide } : {}),
  };
}

function writeStep(step: DiagramEntry): Record<string, unknown> {
  if (isTurn(step)) {
    if (step.unknown) return step.unknown;
    return step.kind === 'rotate'
      ? { id: step.id, kind: step.kind, rotate: step.rotate }
      : { id: step.id, kind: step.kind, axis: step.axis };
  }
  if (step.unknown) return step.unknown;
  return {
    id: step.id,
    revision: step.revision,
    source: step.source,
    picture: step.picture,
    annotations: step.annotations.map(writeAnnotation),
    annotatedPictureKey: step.annotatedPictureKey,
    text: step.text,
    breakBefore: step.breakBefore,
    ...(step.zoom ? { zoom: writeStepZoom(step.zoom) } : {}),
    ...writeStepPlace(step),
  };
}

/**
 * A step's hand placement as written: a newer build's as it came, else this
 * build's as it keeps one (`normalizeStepPlace`: offsets to a tenth of a mm,
 * none of none, every field only when set) — and nothing when there is none.
 */
function writeStepPlace(step: DiagramStep): Record<string, unknown> {
  if (step.placeNewer) return { place: step.placeNewer };
  const place = normalizeStepPlace(step.place);
  return place ? { place } : {};
}

function writeAnnotation(annotation: DiagramAnnotation): Record<string, unknown> {
  if (!isKnownAnnotation(annotation)) return annotation.unknown;
  const {
    id,
    kind,
    from,
    to,
    bend,
    path,
    back,
    width,
    tail,
    fill,
    color,
    text,
    bold,
    halo,
    sizePt,
    offsetPt,
    rotate,
    axis,
    other,
    ticks,
    kinks,
    mirrored,
    parts,
    offset,
    numbered,
    shortDividers,
    behind,
    radius,
    depth,
    scale,
    size,
    angle,
    edge,
    anchor,
    imported,
    unknown: _known,
    ...unwritten
  } = annotation;
  // Every field is written: a new one is a compile error here until it is, not dropped from the file.
  const _none: Record<string, never> = unwritten;
  return {
    id,
    kind,
    from,
    to,
    ...(bend !== undefined ? { bend } : {}),
    ...(path !== undefined ? { path: path.map(writePathNode) } : {}),
    ...(back !== undefined ? { back: back.map(writePathNode) } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(tail !== undefined ? { tail } : {}),
    ...(fill !== undefined ? { fill } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(text !== undefined ? { text } : {}),
    // Text's options (17b), each only as it is set: a plain label is written as every label was before them.
    ...(bold ? { bold } : {}),
    ...(halo ? { halo } : {}),
    ...(sizePt !== undefined ? { sizePt } : {}),
    ...(offsetPt !== undefined ? { offsetPt: [offsetPt[0], offsetPt[1]] } : {}),
    ...(rotate !== undefined ? { rotate } : {}),
    ...(axis !== undefined ? { axis } : {}),
    ...(other !== undefined ? { other } : {}),
    ...(ticks !== undefined ? { ticks } : {}),
    ...(kinks !== undefined ? { kinks } : {}),
    ...(mirrored ? { mirrored } : {}),
    ...(parts !== undefined ? { parts } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(numbered ? { numbered } : {}),
    ...(shortDividers ? { shortDividers } : {}),
    ...(radius !== undefined ? { radius } : {}),
    ...(scale !== undefined ? { scale } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(angle !== undefined ? { angle } : {}),
    ...(edge !== undefined ? { edge } : {}),
    ...(anchor !== undefined ? { anchor } : {}),
    ...(depth !== undefined ? { depth } : {}),
    // A mark lifted from a References card (17d); the author's own are written as every mark was.
    ...(imported !== undefined ? { imported } : {}),
    // From end to end, as a reader expects it.
    ...(behind !== undefined
      ? { behind: { ...(behind.from !== undefined ? { from: behind.from } : {}), ...(behind.to !== undefined ? { to: behind.to } : {}) } }
      : {}),
  };
}

/** A shaped arrow's node, every field named, as an annotation's are. */
function writePathNode(node: DiagramPathNode): Record<string, unknown> {
  return {
    at: node.at,
    ...(node.in !== undefined ? { in: node.in } : {}),
    ...(node.out !== undefined ? { out: node.out } : {}),
    ...(node.type !== undefined ? { type: node.type } : {}),
  };
}

function writeAsset(asset: DiagramAsset): Record<string, unknown> {
  if (!isKnownAsset(asset)) return asset.unknown;
  return asset.kind === 'svg'
    ? {
        id: asset.id,
        kind: 'svg',
        svg: asset.svg,
        widthPx: asset.widthPx,
        heightPx: asset.heightPx,
        bytes: asset.bytes,
      }
    : {
        id: asset.id,
        kind: 'raster',
        src: asset.src,
        widthPx: asset.widthPx,
        heightPx: asset.heightPx,
        bytes: asset.bytes,
      };
}

/**
 * The fields each kind of source is written with, and the parts of one that
 * are records. A field outside its set is one a newer build added: read here,
 * it would be dropped on the way out, so it makes the step a newer build's
 * instead, carried whole and locked. A field joins its set only in the build
 * that reads it; a kind with no set is a newer build's.
 */
const SOURCE_KEYS: Readonly<Record<DiagramStepSource['kind'], ReadonlySet<string>>> = {
  upload: new Set(['kind', 'assetId', 'rotationQuarterTurns', 'mirrored']),
  cp: new Set(['kind', 'scope', 'fingerprint', 'thumbnail', 'render', 'remembered']),
  'references-step': new Set([
    'kind',
    'region',
    'fingerprint',
    'thumbnail',
    'mode',
    'settings',
    'card',
    'line',
    'side',
    'plan',
    'way',
    'sentence',
    'marks',
  ]),
};
/** Within a crease-pattern source: the scopes this build reads, and their fields. */
const CP_SCOPE_KEYS: Readonly<Record<DiagramCpScope['kind'], ReadonlySet<string>>> = {
  segment: new Set(['kind', 'region']),
};
/** The fields a region is written with (`readRegionReference`). */
const REGION_KEYS: ReadonlySet<string> = new Set(['boundary', 'bounds', 'segmentIdHint']);
/** Within a References source: the planner's settings, the line, and the marks it pulled. */
const PLAN_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  'precreaseGrid',
  'gridWhereNeeded',
  'allowDanglingFolds',
  'mergeSymmetricSteps',
]);
const PLAN_LINE_KEYS: ReadonlySet<string> = new Set(['n', 'd']);
const PULLED_MARKS_KEYS: ReadonlySet<string> = new Set(['letters', 'highlights']);
/**
 * The render modes this build reads, and the fields each is written with: a
 * mode or a field it has no name for is a newer build's render.
 */
const CP_RENDER_FIELDS: Readonly<Record<DiagramCpRender['mode'], ReadonlySet<string>>> = {
  'crease-pattern': new Set(['mode', 'rotationDeg', 'side']),
  'folded-flat': new Set(['mode', 'side', 'rotationDeg', 'foldCase', 'spread']),
  'folded-3d': new Set(['mode', 'camera', 'side']),
  // `shape` is Pose's mesh, which this build carries and never reads (`readCpRender`).
  simulated: new Set(['mode', 'foldPercent', 'view', 'shape']),
};
/** The fields each kind of picture is written with, as {@link SOURCE_KEYS} are a source's. */
const PICTURE_KEYS: Readonly<Record<DiagramPicture['kind'], ReadonlySet<string>>> = {
  asset: new Set(['kind', 'assetId', 'paperScale', 'styleKey', 'key']),
  scene: new Set(['kind', 'sceneJson', 'paperScale', 'styleKey', 'key', 'paperFaces']),
  fixed: new Set(['kind', 'svg', 'widthPx', 'heightPx', 'key']),
  'step-diagram': new Set(['kind', 'model', 'mirrored', 'key']),
};
/** The fields each kind of asset is written with: one with another is carried, as one of a kind this build does not know. */
const ASSET_KEYS: Readonly<Record<KnownDiagramAsset['kind'], ReadonlySet<string>>> = {
  svg: new Set(['id', 'kind', 'svg', 'widthPx', 'heightPx', 'bytes']),
  raster: new Set(['id', 'kind', 'src', 'widthPx', 'heightPx', 'bytes']),
};

/**
 * What this build makes of a step's source or picture: the value as it reads
 * — null when it does not — and whether a newer build wrote it, with a kind,
 * a field or a value this build has no name for at any depth, or with more
 * than this build keeps. A newer build's makes its step one, carried whole
 * and locked.
 */
interface StepPartRead<T> {
  read: T | null;
  newer: boolean;
}

/**
 * One entry in the order: a turn when it says what kind (D22) — a step never
 * does — and a step otherwise. A turn of a kind, or with a field or value,
 * this build does not know is a newer build's, carried whole as a locked turn:
 * it can be moved or deleted, never changed, and takes no number.
 */
function readEntry(
  value: unknown,
  assets: Record<string, DiagramAsset>,
  env: () => SanitizeEnv
): DiagramEntry | null {
  if (!isRecord(value) || !Object.hasOwn(value, 'kind')) return readStep(value, assets, env);
  const id = value.id;
  if (typeof id !== 'string' || id.length === 0) return null;
  const turn = readTurn(id, value);
  // The kind is a stand-in: a locked turn is never drawn or changed.
  return turn === NEWER ? { id, kind: 'turn-over', axis: 'vertical', unknown: value } : turn;
}

/**
 * The keys a step is written with (`writeStep`). A step is built from named
 * fields, so any other key — a field a newer build added — would be dropped
 * on the way in and lost on the way out: it makes the step a newer build's
 * instead, carried whole and locked. A field joins this set only in the
 * build that reads it.
 */
const STEP_KEYS: ReadonlySet<string> = new Set([
  'id',
  'revision',
  'source',
  'picture',
  'annotations',
  'annotatedPictureKey',
  'text',
  'breakBefore',
  'zoom',
  'place',
]);

/** A record with a key outside `known`: a field a newer build wrote. */
function hasNewerKey(value: Record<string, unknown>, known: ReadonlySet<string>): boolean {
  return Object.keys(value).some((key) => !known.has(key));
}

/** A record, when `value` is one, with a key outside `known`. */
function isNewerRecord(value: unknown, known: ReadonlySet<string>): boolean {
  return isRecord(value) && hasNewerKey(value, known);
}

/** A word where one of `known` goes, that is none of them: a newer build's. */
function isNewerWord(value: unknown, known: readonly string[]): boolean {
  return typeof value === 'string' && !known.includes(value);
}

/**
 * One step. A source or picture a newer build wrote makes the step a newer
 * build's, carried whole and locked: one of a kind, or with a field or a
 * value, this build has no name for at any depth — a crease-pattern source's
 * scope, a render's mode, field or camera (the remembered ones' too), a
 * thumbnail's line, a References card's plan, a scene's items — or with more
 * than this build keeps, or naming an asset of a kind this build does not
 * know, which only that newer build can draw ({@link readSource},
 * {@link readPicture}). So does a field of the step this build has no name
 * for ({@link STEP_KEYS}). One of a known kind that does not read — or that
 * names an asset the file does not hold, or one dropped on the way in — is
 * left out, and the step keeps its words.
 */
function readStep(
  value: unknown,
  assets: Record<string, DiagramAsset>,
  env: () => SanitizeEnv
): DiagramStep | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  if (typeof id !== 'string' || id.length === 0) return null;
  const zoom = value.zoom === undefined ? undefined : readStepZoom(value.zoom);
  // An enlarged step's marks are in its window's units, and reach as far as its window's reach.
  const reach = zoom && zoom !== NEWER && zoom.frame ? windowReach(zoom.frame) : PICTURE_REACH;
  const base: DiagramStep = {
    id,
    revision: wholeNumber(value.revision) ?? 0,
    source: null,
    picture: null,
    // More than a step holds is a newer build's step (below), carried whole and never parsed.
    annotations: tooManyAnnotations(value.annotations) ? [] : readAnnotations(value.annotations, reach),
    annotatedPictureKey:
      typeof value.annotatedPictureKey === 'string' ? value.annotatedPictureKey : null,
    text: typeof value.text === 'string' ? xmlText(value.text) : '',
    breakBefore: value.breakBefore === true,
  };
  const paperFaces =
    isRecord(value.picture) && value.picture.kind === 'scene' && value.picture.paperFaces !== undefined
      ? readPaperFaces(value.picture.paperFaces)
      : undefined;
  const sourceRead = readSource(value.source, assets);
  const pictureRead = readPicture(value.picture, assets, env);
  // Marks are drawn in their step's frame: a newer build's step whose frame
  // or marks this build cannot read shows nothing.
  if (zoom === NEWER || tooManyAnnotations(value.annotations)) return { ...base, unknown: value };
  const framed = withZoom(base, zoom);
  // A newer build's step shows what this build reads of it (decision 2 of the
  // launch review): its picture, as its link and its frame say, and its marks
  // — never its hand placement, which this build would lay it out by.
  if (hasNewerKey(value, STEP_KEYS) || paperFaces === NEWER_PAPER_FACES || sourceRead.newer || pictureRead.newer) {
    return { ...withPicture(framed, sourceRead.read, pictureRead.read, paperFaces), unknown: value };
  }
  return withPicture({ ...framed, ...readStepPlace(value.place) }, sourceRead.read, pictureRead.read, paperFaces);
}

/**
 * A step with its frame, when it is enlarged. One that does not read is
 * dropped, and the marks drawn in its window are out of step with the whole
 * picture.
 */
function withZoom(step: DiagramStep, zoom: DiagramStepZoom | null | undefined): DiagramStep {
  if (zoom === undefined) return step;
  return zoom === null ? { ...step, annotatedPictureKey: null } : { ...step, zoom };
}

/** A step with its source, and the picture that source takes. */
function withPicture(
  step: DiagramStep,
  source: DiagramStepSource | null,
  picture: DiagramPicture | null,
  paperFaces: ReturnType<typeof readPaperFaces> | undefined
): DiagramStep {
  if (source?.kind === 'upload') {
    // An upload is its asset: a source and a picture that disagree about which
    // one are not a picture to show.
    return picture?.kind === 'asset' && picture.assetId === source.assetId
      ? { ...step, source, picture }
      : step;
  }
  if (source?.kind === 'cp') {
    // A linked step may have no picture yet ("Pose to capture"); its picture is
    // a scene, a fixed picture, or a capture too detailed to keep as vector,
    // kept as a bitmap asset. A flat fold's scene keeps its faces when they
    // agree with it.
    const flat = source.render.mode === 'folded-flat' ? source.render : null;
    const faces =
      picture?.kind === 'scene' &&
      flat &&
      paperFaces &&
      paperFaces !== NEWER_PAPER_FACES &&
      paperFacesFitScene(paperFaces.faces, picture, flat.spread !== undefined)
        ? { ...picture, paperFaces: paperFaces.json }
        : picture;
    return { ...step, source, picture: faces?.kind === 'step-diagram' ? null : faces };
  }
  if (source?.kind === 'references-step') {
    // A References step's picture is its card's diagram, or none.
    return { ...step, source, picture: picture?.kind === 'step-diagram' ? picture : null };
  }
  // A picture with no source to say what it is of is left out.
  return step;
}

/**
 * A crease-pattern source a newer build wrote: a field, a scope, a render —
 * the one shown, or one remembered for another way of showing (D19) — or a
 * thumbnail this build has no name for. Read here, such a source would be
 * written back without what this build cannot name, so the step is carried
 * whole instead.
 */
function isNewerCpSource(value: Record<string, unknown>): boolean {
  return (
    hasNewerKey(value, SOURCE_KEYS.cp) ||
    isNewerScope(value.scope) ||
    isNewerRender(value.render) ||
    isNewerRemembered(value.remembered) ||
    isNewerSheetThumbnail(value.thumbnail)
  );
}

/** A crease-pattern source's scope of a kind, or with a field, this build has no name for. */
function isNewerScope(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (!Object.hasOwn(CP_SCOPE_KEYS, value.kind)) return true;
  return hasNewerKey(value, CP_SCOPE_KEYS[value.kind as DiagramCpScope['kind']]) || isNewerRecord(value.region, REGION_KEYS);
}

/**
 * A References source a newer build wrote: a field, a mode or a side, or a
 * field of its region, its planner's settings, its line or the marks it
 * pulled, that this build has no name for; or a thumbnail it cannot keep.
 */
function isNewerReferencesSource(value: Record<string, unknown>): boolean {
  return (
    hasNewerKey(value, SOURCE_KEYS['references-step']) ||
    isNewerRecord(value.region, REGION_KEYS) ||
    isNewerSheetThumbnail(value.thumbnail) ||
    isNewerWord(value.mode, ['sequence', 'find']) ||
    isNewerWord(value.side, ['front', 'back']) ||
    isNewerRecord(value.settings, PLAN_SETTINGS_KEYS) ||
    isNewerRecord(value.line, PLAN_LINE_KEYS) ||
    isNewerRecord(value.marks, PULLED_MARKS_KEYS)
  );
}

/**
 * An upload source a newer build wrote: a field this build has no name for,
 * a turn past the four it draws, or an asset of a kind it does not know.
 */
function isNewerUploadSource(value: Record<string, unknown>, assets: Record<string, DiagramAsset>): boolean {
  const turns = value.rotationQuarterTurns;
  return (
    hasNewerKey(value, SOURCE_KEYS.upload) ||
    (typeof turns === 'number' && Number.isFinite(turns) && readQuarterTurns(turns) === null) ||
    namesUnknownAsset(value, assets)
  );
}

/**
 * A render of a mode, with a field, a camera's field or a side this build
 * has no name for, a spread it does not read, or a fold past the whole of
 * one. A render that does not read at all is damage, judged where it is read.
 */
function isNewerRender(value: unknown): boolean {
  if (!isRecord(value) || typeof value.mode !== 'string') return false;
  if (!Object.hasOwn(CP_RENDER_FIELDS, value.mode)) return true;
  const fields = CP_RENDER_FIELDS[value.mode as DiagramCpRender['mode']];
  if (hasNewerKey(value, fields)) return true;
  switch (value.mode as DiagramCpRender['mode']) {
    case 'crease-pattern':
      return readPatternSide(value.side) === NEWER;
    case 'folded-flat':
      return readSpread(value.spread) === NEWER || isNewerWord(value.side, ['front', 'back']);
    case 'folded-3d':
      return isNewerRecord(value.camera, FOLDED_FIGURE_CAMERA_KEYS) || isNewerWord(value.side, ['front', 'back']);
    case 'simulated': {
      const foldPercent = finiteNumber(value.foldPercent);
      return isNewerRecord(value.view, FOLDED_FIGURE_CAMERA_KEYS) || (foldPercent !== null && (foldPercent < 0 || foldPercent > 100));
    }
  }
}

/**
 * The side a crease pattern is seen from: the front when unsaid, as every one
 * was before it had a back; a newer build's when a word this build has no
 * name for; anything else, damage.
 */
function readPatternSide(value: unknown): 'front' | 'back' | typeof NEWER | null {
  return readPreset(value, ['front', 'back'] as const, 'front');
}

/** Remembered poses under a way of showing this build does not know, or one of them a newer build's render. */
function isNewerRemembered(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([way, render]) => !(DIAGRAM_SHOW_AS as readonly string[]).includes(way) || isNewerRender(render)
  );
}

/** A source or picture naming an asset the table carries but this build cannot read. */
function namesUnknownAsset(value: Record<string, unknown>, assets: Record<string, DiagramAsset>): boolean {
  if (typeof value.assetId !== 'string') return false;
  const asset = Object.hasOwn(assets, value.assetId) ? assets[value.assetId] : undefined;
  return asset !== undefined && !isKnownAsset(asset);
}

/**
 * A step's source, by its kind: what reads of it, and whether a newer build
 * wrote it ({@link StepPartRead}). A kind this build has no name for is a
 * newer build's; anything that is not a source at all is none.
 */
function readSource(value: unknown, assets: Record<string, DiagramAsset>): StepPartRead<DiagramStepSource> {
  if (!isRecord(value)) return { read: null, newer: false };
  switch (value.kind) {
    case 'upload':
      return { read: readUploadSource(value, assets), newer: isNewerUploadSource(value, assets) };
    case 'cp':
      return { read: readCpSource(value), newer: isNewerCpSource(value) };
    case 'references-step':
      return { read: readReferencesSource(value), newer: isNewerReferencesSource(value) };
    default:
      return { read: null, newer: typeof value.kind === 'string' };
  }
}

/** An upload's source: the asset it shows, which must read, and how it is turned and flipped. */
function readUploadSource(value: Record<string, unknown>, assets: Record<string, DiagramAsset>): DiagramStepSource | null {
  const assetId = value.assetId;
  if (typeof assetId !== 'string' || !hasKnownAsset(assets, assetId)) return null;
  return {
    kind: 'upload',
    assetId,
    rotationQuarterTurns: readQuarterTurns(value.rotationQuarterTurns) ?? 0,
    mirrored: value.mirrored === true,
  };
}

/** A whole number of quarter turns, 0 to 3; null for anything else. */
function readQuarterTurns(value: unknown): QuarterTurns | null {
  return value === 0 || value === 1 || value === 2 || value === 3 ? value : null;
}

/**
 * A crease-pattern source as a step stores it: through the file's own reader,
 * so what a capture writes is field for field what a load reads back — the
 * same shapes, in the same order. Null for one the reader refuses.
 */
export function storedCpSource(source: DiagramCpSource): DiagramCpSource | null {
  return readCpSource(JSON.parse(JSON.stringify(source)) as Record<string, unknown>);
}

/** A crease-pattern source, every field checked; null when any does not read. */
function readCpSource(value: Record<string, unknown>): DiagramCpSource | null {
  const scope = readCpScope(value.scope);
  const render = readCpRender(value.render);
  const thumbnail = readSheetThumbnail(value.thumbnail);
  const fingerprint = value.fingerprint;
  if (!scope || !render || !thumbnail) return null;
  if (typeof fingerprint !== 'string' || fingerprint.length === 0) return null;
  const remembered = readRememberedPoses(value.remembered, render);
  return { kind: 'cp', scope, fingerprint, thumbnail, render, ...(remembered ? { remembered } : {}) };
}

/**
 * The poses a step remembers for the other ways of showing its pattern (D19):
 * each one that reads, under the way it shows; an entry that does not read,
 * or names the way the step is shown now, is dropped rather than the step.
 */
function readRememberedPoses(
  value: unknown,
  render: DiagramCpRender
): Partial<Record<DiagramShowAs, DiagramCpRender>> | null {
  if (!isRecord(value)) return null;
  const remembered: Partial<Record<DiagramShowAs, DiagramCpRender>> = {};
  for (const way of DIAGRAM_SHOW_AS) {
    const pose = readCpRender(value[way]);
    if (pose && showAsOf(pose) === way && way !== showAsOf(render)) remembered[way] = pose;
  }
  return Object.keys(remembered).length > 0 ? remembered : null;
}

/**
 * A References source as a step stores it: through the file's own reader, as
 * {@link storedCpSource} is. Null for one the reader refuses.
 */
export function storedReferencesSource(source: DiagramReferencesSource): DiagramReferencesSource | null {
  return readReferencesSource(JSON.parse(JSON.stringify(source)) as Record<string, unknown>);
}

/**
 * Marks as a step stores them (17d): written and read back through the
 * file's own reader, as {@link storedReferencesSource} is, so the marks lifted
 * from a card are field for field what a load gives — the same shapes, in
 * the same order. One the reader would not take as this build's is left out.
 */
export function storedAnnotations(
  annotations: readonly KnownDiagramAnnotation[],
  reach: AnnotationReach = PICTURE_REACH
): KnownDiagramAnnotation[] {
  const written = JSON.parse(JSON.stringify(annotations.map(writeAnnotation))) as unknown;
  return readAnnotations(written, reach).filter(isKnownAnnotation);
}

/** A References source, every field checked; null when any does not read. */
function readReferencesSource(value: Record<string, unknown>): DiagramReferencesSource | null {
  const region = readRegionReference(value.region);
  const thumbnail = readSheetThumbnail(value.thumbnail);
  if (!region || !thumbnail) return null;
  // Null is a sheet that could not be fingerprinted when it was sent; an empty one is not a fingerprint.
  const fingerprint = value.fingerprint;
  if (fingerprint !== null && (typeof fingerprint !== 'string' || fingerprint.length === 0)) return null;
  if (value.mode !== 'sequence' && value.mode !== 'find') return null;
  if (value.side !== 'front' && value.side !== 'back') return null;
  const settings = value.settings === null ? null : readPlanSettings(value.settings);
  const line = value.line === null ? null : readPlanLine(value.line);
  const card = value.card === null ? null : wholeNumber(value.card);
  if (settings === undefined || line === undefined) return null;
  if (value.card !== null && (card === null || card < 1)) return null;
  // Kept when they read, and dropped alone when they do not: they say which
  // plan and way, and a step that cannot say is still the step.
  const plan = typeof value.plan === 'string' && value.plan.length > 0 ? value.plan : undefined;
  const way = typeof value.way === 'string' && value.way.length > 0 ? value.way : undefined;
  const sentence = typeof value.sentence === 'string' ? xmlText(value.sentence) : undefined;
  const marks = readPulledMarks(value.marks);
  return {
    kind: 'references-step',
    region,
    fingerprint,
    thumbnail,
    mode: value.mode,
    settings,
    card,
    line,
    side: value.side,
    ...(plan !== undefined ? { plan } : {}),
    ...(way !== undefined ? { way } : {}),
    ...(sentence !== undefined ? { sentence } : {}),
    ...(marks !== undefined ? { marks } : {}),
  };
}

/**
 * Which of a card's marks a step pulled (17d): letters and reference lines,
 * each a boolean. One that does not read is dropped alone, as a plan or a
 * way is: the step pulls every mark again, as one sent before the choice.
 */
function readPulledMarks(value: unknown): DiagramReferencesSource['marks'] {
  if (!isRecord(value) || typeof value.letters !== 'boolean' || typeof value.highlights !== 'boolean') return undefined;
  return { letters: value.letters, highlights: value.highlights };
}

/** The four planner settings, each a boolean; undefined when they do not read. */
function readPlanSettings(value: unknown): ReferencesPlanSettings | undefined {
  if (!isRecord(value)) return undefined;
  const { precreaseGrid, gridWhereNeeded, allowDanglingFolds, mergeSymmetricSteps } = value;
  const flags = [precreaseGrid, gridWhereNeeded, allowDanglingFolds, mergeSymmetricSteps];
  if (flags.some((flag) => typeof flag !== 'boolean')) return undefined;
  return {
    precreaseGrid: precreaseGrid as boolean,
    gridWhereNeeded: gridWhereNeeded as boolean,
    allowDanglingFolds: allowDanglingFolds as boolean,
    mergeSymmetricSteps: mergeSymmetricSteps as boolean,
  };
}

/** A line `n · p = d`, with a unit normal; undefined when it does not read. */
function readPlanLine(value: unknown): { n: [number, number]; d: number } | undefined {
  if (!isRecord(value) || !Array.isArray(value.n) || value.n.length !== 2) return undefined;
  const nx = finiteNumber(value.n[0]);
  const ny = finiteNumber(value.n[1]);
  const d = finiteNumber(value.d);
  if (nx === null || ny === null || d === null) return undefined;
  if (Math.abs(Math.hypot(nx, ny) - 1) > 1e-6) return undefined;
  return { n: [nx, ny], d };
}

function readCpScope(value: unknown): DiagramCpScope | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'segment') {
    const region = readRegionReference(value.region);
    return region ? { kind: 'segment', region } : null;
  }
  return null;
}

function readCpRender(value: unknown): DiagramCpRender | null {
  if (!isRecord(value)) return null;
  const side = value.side === 'front' || value.side === 'back' ? value.side : null;
  const rotationDeg = finiteNumber(value.rotationDeg);
  switch (value.mode) {
    case 'crease-pattern': {
      const seen = readPatternSide(value.side);
      // A newer build's side made the step a newer build's before this was reached.
      if (rotationDeg === null || seen === null || seen === NEWER) return null;
      // The front is written as no side at all, so a front read with one is written back without it.
      return {
        mode: 'crease-pattern',
        rotationDeg: normalizeDegrees(rotationDeg),
        ...(seen === 'back' ? { side: 'back' as const } : {}),
      };
    }
    case 'folded-flat': {
      const foldCase = wholeNumber(value.foldCase);
      const spread = readSpread(value.spread);
      if (!side || rotationDeg === null || foldCase === null || foldCase < 1) return null;
      // A newer build's spread made the step a newer build's before this was reached.
      if (spread === null || spread === NEWER) return null;
      return {
        mode: 'folded-flat',
        side,
        rotationDeg: normalizeDegrees(rotationDeg),
        foldCase,
        ...(spread ? { spread } : {}),
      };
    }
    case 'folded-3d': {
      const camera = readFoldedFigureCamera(value.camera);
      return side && camera ? { mode: 'folded-3d', camera, side } : null;
    }
    case 'simulated': {
      const foldPercent = finiteNumber(value.foldPercent);
      const view = readFoldedFigureCamera(value.view);
      if (foldPercent === null || foldPercent < 0 || foldPercent > 100 || !view) return null;
      // Pose's mesh, carried as it came: one that is no record is dropped alone.
      const shape = isRecord(value.shape) ? value.shape : undefined;
      return { mode: 'simulated', foldPercent, view, ...(shape ? { shape } : {}) };
    }
    default:
      return null;
  }
}

/** A spread's fields, by its kind: any other makes the step a newer build's. */
const SPREAD_FIELDS: Readonly<Record<SpreadKind, ReadonlySet<string>>> = {
  depth: new Set(['kind', 'amount', 'toward']),
  affine: new Set(['kind', 'amount', 'keep', 'skew', 'axisDeg']),
};

/**
 * A flat fold's spread (Phase 13): undefined when it has none. One with no
 * `kind` is a depth spread, as every spread was before there were two (13g).
 * A kind, a field, a direction, a layer held still or a value past what this
 * build reads is a newer build's; one of the wrong type, or no step at all,
 * is damage.
 */
function readSpread(value: unknown): DiagramLayerSpread | undefined | typeof NEWER | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const kind = value.kind === undefined ? 'depth' : value.kind;
  if (typeof kind !== 'string') return null;
  if (!(SPREAD_KINDS as readonly string[]).includes(kind)) return NEWER;
  const known = kind as SpreadKind;
  // A field it has no name for is news before a missing one is damage, as for an annotation.
  if (Object.keys(value).some((key) => !SPREAD_FIELDS[known].has(key))) return NEWER;
  const amount = finiteNumber(value.amount);
  if (amount === null || amount <= 0) return null;
  const past = amount > SPREAD_AMOUNT_RANGE[known].max;
  if (known === 'depth') {
    if (typeof value.toward !== 'string') return null;
    if (past || !(SPREAD_DIRECTIONS as readonly string[]).includes(value.toward)) return NEWER;
    return { kind: 'depth', amount, toward: value.toward as SpreadDirection };
  }
  const skew = finiteNumber(value.skew);
  const axisDeg = finiteNumber(value.axisDeg);
  if (typeof value.keep !== 'string' || skew === null || axisDeg === null) return null;
  if (
    past ||
    !(SPREAD_KEEPS as readonly string[]).includes(value.keep) ||
    skew < SPREAD_SKEW_RANGE.min ||
    skew > SPREAD_SKEW_RANGE.max ||
    axisDeg < SPREAD_AXIS_RANGE.min ||
    axisDeg > SPREAD_AXIS_RANGE.max
  ) {
    return NEWER;
  }
  return { kind: 'affine', amount, keep: value.keep as SpreadKeep, skew, axisDeg };
}

/** An angle in [0, 360), so one rotation is written one way. */
function normalizeDegrees(degrees: number): number {
  const turned = degrees % 360;
  return turned < 0 ? turned + 360 : turned;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readPicture(
  value: unknown,
  assets: Record<string, DiagramAsset>,
  env: () => SanitizeEnv
): StepPartRead<DiagramPicture> {
  if (!isRecord(value)) return { read: null, newer: false };
  if (typeof value.kind !== 'string') return { read: null, newer: false };
  if (!Object.hasOwn(PICTURE_KEYS, value.kind)) return { read: null, newer: true };
  const kind = value.kind as DiagramPicture['kind'];
  const read = readPictureOfKind(kind, value, assets, env);
  const newer = hasNewerKey(value, PICTURE_KEYS[kind]) || read === NEWER || (kind === 'asset' && namesUnknownAsset(value, assets));
  return { read: read === NEWER ? null : read, newer };
}

/**
 * A picture of a kind this build reads: null when it does not read, and a
 * newer build's when it holds more than this build keeps — a scene or an SVG
 * past its cap, a scene with an item or a field this build has no name for,
 * a References card drawn with a primitive it does not draw.
 */
function readPictureOfKind(
  kind: DiagramPicture['kind'],
  value: Record<string, unknown>,
  assets: Record<string, DiagramAsset>,
  env: () => SanitizeEnv
): DiagramPicture | typeof NEWER | null {
  const key = value.key;
  if (typeof key !== 'string' || key.length === 0) return null;
  const paperScale = positiveOrNull(value.paperScale);
  switch (kind) {
    case 'asset': {
      const assetId = value.assetId;
      if (typeof assetId !== 'string' || !hasKnownAsset(assets, assetId)) return null;
      const styleKey = typeof value.styleKey === 'string' && value.styleKey.length <= 512 ? value.styleKey : null;
      return { kind: 'asset', assetId, paperScale, ...(styleKey === null ? {} : { styleKey }), key };
    }
    case 'scene': {
      const read = readSceneJson(value.sceneJson);
      if (read === null || read === NEWER) return read;
      const styleKey = typeof value.styleKey === 'string' ? value.styleKey : null;
      const picture: DiagramScenePicture = { kind: 'scene', sceneJson: read.json, paperScale, styleKey, key };
      readScenes.set(picture, read.scene);
      return picture;
    }
    case 'fixed':
      return readFixedPicture(value, key, env());
    case 'step-diagram': {
      const read = validateStepDiagramModel(value.model);
      if (read.status === 'unknown') return NEWER;
      return read.status === 'ok'
        ? { kind: 'step-diagram', model: read.model, mirrored: value.mirrored === true, key }
        : null;
    }
  }
}

function positiveOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Each scene picture a load read, and the scene its JSON was checked as: what
 * a flat capture's faces are checked against (`paperFacesFitScene`) with no
 * second parse of a scene that may be megabytes.
 */
const readScenes = new WeakMap<DiagramScenePicture, unknown>();

/**
 * A stored scene, validated as any scene from a file is (`readPaperScene`,
 * which drops markup), and written back in the validated form, so what is kept
 * is only what was checked; with the scene it was checked as. One longer than
 * this build keeps, or with an item or a field it has no name for, is a newer
 * build's: carried whole with its step, never cut short.
 */
function readSceneJson(value: unknown): { json: string; scene: unknown } | typeof NEWER | null {
  if (typeof value !== 'string') return null;
  // Never parsed: past the cap, it is only carried.
  if (value.length > SCENE_JSON_MAX_BYTES) return NEWER;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (isNewerPaperScene(parsed)) return NEWER;
  const scene = readPaperScene(parsed);
  if (!scene) return null;
  // The cap holds for what is kept, too: filling in a field's default can
  // make the written scene longer than the one read. A file this build saved
  // never does; one that does is carried as it came.
  const json = JSON.stringify(scene);
  return json.length <= SCENE_JSON_MAX_BYTES ? { json, scene } : NEWER;
}

/**
 * A scene as a step stores it: through the file's own validator, so what a
 * capture writes is byte for byte what a load reads back, and only what was
 * checked is kept. Null for a scene the validator refuses.
 */
export function storedSceneJson(scene: unknown): string | null {
  const read = readPaperScene(scene);
  return read ? JSON.stringify(read) : null;
}

/**
 * A no-layer-order picture: our own SVG, sanitized again as an upload is
 * (D7), with its key as its ids' prefix — the key is the picture's, so a copy
 * in a duplicated step loads to the same bytes.
 */
function readFixedPicture(
  value: Record<string, unknown>,
  key: string,
  env: SanitizeEnv
): DiagramFixedPicture | typeof NEWER | null {
  if (typeof value.svg !== 'string') return null;
  // Longer than this build keeps: a newer build's, carried and never sanitized here.
  if (value.svg.length > SVG_STORED_MAX_BYTES) return NEWER;
  // A key that cannot prefix an id is refused by the sanitizer.
  const result = sanitizeSvg(value.svg, { idPrefix: key, mode: 'load', env });
  if (!result.ok) return null;
  // Checked again after sanitizing, as an SVG asset is: prefixing every id
  // lengthens the markup. A picture this build saved loads again; one that
  // does not is carried as it came.
  if (result.svg.length > SVG_STORED_MAX_BYTES) return NEWER;
  return { kind: 'fixed', svg: result.svg, widthPx: result.widthPx, heightPx: result.heightPx, key };
}

function hasKnownAsset(assets: Record<string, DiagramAsset>, id: string): boolean {
  const asset = Object.hasOwn(assets, id) ? assets[id] : undefined;
  return asset !== undefined && isKnownAsset(asset);
}

/** The fields each kind is written with; any other makes the annotation a newer build's. */
const ANNOTATION_FIELDS: Readonly<Record<DiagramAnnotationKind, ReadonlySet<string>>> = (() => {
  // Every kind can be a mark lifted from a References card (17d).
  const base = ['id', 'kind', 'from', 'to', 'imported'];
  const fields = (...more: string[]) => new Set([...base, ...more]);
  return {
    'valley-arrow': fields('bend', 'path', 'behind'),
    'mountain-arrow': fields('bend', 'path', 'behind'),
    'fold-unfold-arrow': fields('bend', 'path', 'behind', 'back'),
    'pleat-arrow': fields('kinks', 'mirrored', 'behind'),
    'push-arrow': fields(),
    'white-arrow': fields('path', 'width', 'tail', 'fill'),
    'turn-over': fields('axis'),
    rotate: fields('rotate'),
    'valley-line': fields('behind'),
    'mountain-line': fields('behind'),
    'hidden-line': fields(),
    'solid-line': fields('color', 'behind'),
    label: fields('text', 'color', 'bold', 'halo', 'sizePt', 'offsetPt'),
    circle: fields('behind'),
    'right-angle': fields(),
    callout: fields('text'),
    'angle-mark': fields('other', 'ticks'),
    divisions: fields('parts', 'offset', 'mirrored', 'ticks', 'numbered', 'shortDividers'),
    'close-up': fields('radius', 'scale'),
    zoom: fields('radius', 'size', 'angle', 'scale', 'edge', 'anchor'),
    star: fields('fill', 'angle', 'scale'),
    eye: fields('angle', 'scale'),
    oval: fields('size', 'angle'),
    rectangle: fields('size', 'angle'),
    'x-ray': fields('radius', 'anchor', 'depth'),
  };
})();

/** A newer build's value: well formed, but past what this build reads. */
const NEWER = Symbol('newer');

/** More annotations than a step of this build holds: a newer build's step, not one to cut short. */
function tooManyAnnotations(value: unknown): boolean {
  return Array.isArray(value) && value.length > MAX_STEP_ANNOTATIONS;
}

/**
 * A step's annotations (D8), by the file's three rules: one that does not read
 * is dropped; one of a kind, a field or an enumerated value this build does
 * not know — or a well-formed value past the ranges it reads — is a newer
 * build's, and is carried verbatim. A second annotation with an id already
 * read is dropped.
 */
function readAnnotations(value: unknown, reach: AnnotationReach): DiagramAnnotation[] {
  if (!Array.isArray(value)) return [];
  const out: DiagramAnnotation[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length === 0 || ids.has(entry.id)) continue;
    const annotation = readAnnotation(entry.id, entry, reach);
    if (annotation === NEWER) out.push({ id: entry.id, unknown: entry });
    else if (annotation) out.push(annotation);
    else continue;
    ids.add(entry.id);
  }
  return out;
}

/**
 * One annotation: its kind's fields, then the tag a mark lifted from a
 * References card carries (17d) — a state this build does not know is news,
 * told before any damage, as for the rest.
 */
function readAnnotation(
  id: string,
  entry: Record<string, unknown>,
  reach: AnnotationReach
): KnownDiagramAnnotation | typeof NEWER | null {
  const imported = readImported(entry.imported);
  if (imported === NEWER) return NEWER;
  const read = readAnnotationOfKind(id, entry, reach);
  if (read === null || read === NEWER || imported === undefined) return read;
  return imported === null ? null : { ...read, imported };
}

/** A lifted mark's tag (17d): unsaid, the author's; `untouched` or `edited`; another word, a newer build's; anything else, damage. */
function readImported(value: unknown): DiagramImportedMark | undefined | typeof NEWER | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  return value === 'untouched' || value === 'edited' ? value : NEWER;
}

function readAnnotationOfKind(
  id: string,
  entry: Record<string, unknown>,
  reach: AnnotationReach
): KnownDiagramAnnotation | typeof NEWER | null {
  if (typeof entry.kind !== 'string') return null;
  if (!Object.hasOwn(ANNOTATION_FIELDS, entry.kind)) return NEWER;
  const kind = entry.kind as DiagramAnnotationKind;
  const fields = ANNOTATION_FIELDS[kind];
  if (Object.keys(entry).some((key) => !fields.has(key))) return NEWER;
  const from = readAnnotationPoint(entry.from, reach);
  // A sign's, a label's, an enlarge area's, an eye's, a shape's or an x-ray's one place is `from`; `to` is written as it again.
  const to =
    isPointKind(kind) || kind === 'zoom' || kind === 'eye' || isAreaKind(kind) || kind === 'x-ray'
      ? from
      : readAnnotationPoint(entry.to, reach);
  if (from === null || to === null) return null;
  if (from === NEWER || to === NEWER) return NEWER;
  // The ends behind a flap, for a kind that has them: news before damage, as for the rest.
  const behind = readBehind(entry.behind, behindEnds(kind));
  if (behind === NEWER || behind === null) return behind;
  const annotation: KnownDiagramAnnotation = { id, kind, from, to: [to[0], to[1]], ...(behind ? { behind } : {}) };
  switch (kind) {
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow': {
      // A shaped arrow first, before an absent bend is filled in: a path is not the default arc.
      if (entry.path !== undefined) {
        // An arc and a path both: no build of this one writes that.
        if (entry.bend !== undefined) return NEWER;
        const path = readPath(entry.path, reach);
        if (path === null || path === NEWER) return path;
        const first = path[0]!.at;
        const last = path[path.length - 1]!.at;
        // The arrow's ends are its path's: one that says otherwise does not read.
        if (first[0] !== from[0] || first[1] !== from[1] || last[0] !== to[0] || last[1] !== to[1]) return null;
        if (entry.back === undefined) return { ...annotation, path };
        // A fold-and-unfold arrow's return shaped by hand: a path from the tip.
        const back = readPath(entry.back, reach);
        if (back === null || back === NEWER) return back;
        const start = back[0]!.at;
        if (start[0] !== to[0] || start[1] !== to[1]) return null;
        return { ...annotation, path, back };
      }
      // A return with no path to return along: no build of this one writes that.
      if (entry.back !== undefined) return NEWER;
      if (entry.bend === undefined) {
        const shape = arrowShape(annotation);
        return shape.kind === 'arc' ? { ...annotation, bend: shape.bend } : annotation;
      }
      if (typeof entry.bend !== 'number' || !Number.isFinite(entry.bend) || entry.bend === 0) return null;
      return Math.abs(entry.bend) > MAX_BEND ? NEWER : { ...annotation, bend: entry.bend };
    }
    case 'white-arrow': {
      // Always a path, with its two presets: a value either preset does not
      // know is news, told before any damage, as for a whole annotation.
      const path = entry.path === undefined ? null : readPath(entry.path, reach);
      const width = readPreset(entry.width, WHITE_ARROW_WIDTHS, DEFAULT_WHITE_ARROW.width);
      const tail = readPreset(entry.tail, WHITE_ARROW_TAILS, DEFAULT_WHITE_ARROW.tail);
      const fill = readFill(entry.fill);
      if (path === NEWER || width === NEWER || tail === NEWER || fill === NEWER) return NEWER;
      if (path === null || width === null || tail === null || fill === null) return null;
      // The arrow's ends are its path's: one that says otherwise does not read.
      const first = path[0]!.at;
      const last = path[path.length - 1]!.at;
      if (first[0] !== from[0] || first[1] !== from[1] || last[0] !== to[0] || last[1] !== to[1]) return null;
      return { ...annotation, path, width, tail, ...(fill !== undefined ? { fill } : {}) };
    }
    case 'label': {
      // Its words, then its options (17b): news before damage, as for the rest.
      const text = readLabelText(entry.text);
      const color = readColor(entry.color);
      const bold = readFlag(entry.bold);
      const halo = readFlag(entry.halo);
      const sizePt = readTextSize(entry.sizePt);
      const offsetPt = readTextOffset(entry.offsetPt);
      if (text === NEWER || color === NEWER || sizePt === NEWER || offsetPt === NEWER) return NEWER;
      if (text === null || color === null || bold === null || halo === null || sizePt === null || offsetPt === null) return null;
      return {
        ...annotation,
        text,
        ...(color !== undefined ? { color } : {}),
        ...(bold ? { bold: true } : {}),
        ...(halo ? { halo: true } : {}),
        ...(sizePt !== undefined ? { sizePt } : {}),
        ...(offsetPt !== undefined ? { offsetPt } : {}),
      };
    }
    // A callout's words are read as a label's: one line, as long as a label may be.
    case 'callout': {
      const text = readLabelText(entry.text);
      return text === null || text === NEWER ? text : { ...annotation, text };
    }
    case 'rotate': {
      const rotate = readRotation(entry.rotate);
      return rotate === null || rotate === NEWER ? rotate : { ...annotation, rotate };
    }
    case 'turn-over': {
      const axis = readAxis(entry.axis);
      return axis === null || axis === NEWER ? axis : { ...annotation, axis };
    }
    case 'right-angle':
      // `to` says which way it opens, from its corner, at any distance: at the corner it opens no way.
      return from[0] === to[0] && from[1] === to[1] ? null : annotation;
    case 'angle-mark': {
      // Its second arm, and its ticks; a count past three is news, told before damage.
      const other = readAnnotationPoint(entry.other, reach);
      const ticks = readTicks(entry.ticks);
      if (other === NEWER || ticks === NEWER) return NEWER;
      if (other === null || ticks === null) return null;
      const mark: KnownDiagramAnnotation = { ...annotation, other, ...(ticks !== undefined ? { ticks } : {}) };
      // Arms that make no angle mark none.
      return angleMarkArms(mark) ? mark : null;
    }
    case 'pleat-arrow': {
      // Its Zs and the side they step to; a count past five is news, told before damage.
      const kinks = readKinks(entry.kinks);
      const mirrored = readMirrored(entry.mirrored);
      if (kinks === NEWER) return NEWER;
      if (kinks === null || mirrored === null) return null;
      return { ...annotation, ...(kinks !== undefined ? { kinks } : {}), ...(mirrored ? { mirrored: true } : {}) };
    }
    case 'divisions': {
      // Its parts and its offset, which it must have, its ticks, its side,
      // whether it prints its count and whether its dividers between its ends
      // are short (Revision 3); a value past the ranges this build draws is
      // news, told before damage.
      const parts = readDivisionsParts(entry.parts);
      const offset = readDivisionsOffset(entry.offset);
      const ticks = readTicks(entry.ticks);
      const mirrored = readMirrored(entry.mirrored);
      const numbered = readNumbered(entry.numbered);
      const shortDividers = readFlag(entry.shortDividers);
      if (parts === NEWER || offset === NEWER || ticks === NEWER) return NEWER;
      if (parts === null || offset === null || ticks === null || mirrored === null || numbered === null || shortDividers === null) {
        return null;
      }
      return {
        ...annotation,
        parts,
        offset,
        ...(ticks !== undefined ? { ticks } : {}),
        ...(mirrored ? { mirrored: true } : {}),
        ...(numbered ? { numbered: true } : {}),
        ...(shortDividers ? { shortDividers: true } : {}),
      };
    }
    case 'close-up': {
      // Its area's radius, which it must have, and its scale; a value past the
      // ranges this build draws is news, told before damage.
      const radius = readCloseUpRadius(entry.radius);
      const scale = readCloseUpScale(entry.scale);
      if (radius === NEWER || scale === NEWER) return NEWER;
      if (radius === null || scale === null) return null;
      return { ...annotation, radius, ...(scale !== undefined ? { scale } : {}) };
    }
    case 'zoom':
      return readZoomArea(annotation, entry);
    case 'solid-line': {
      // Its colour (17a); unsaid, the style's arrow ink.
      const color = readColor(entry.color);
      if (color === NEWER || color === null) return color;
      return color !== undefined ? { ...annotation, color } : annotation;
    }
    case 'star': {
      // Its fill, as a white arrow's; its scale, as a close-up's, past its
      // range a newer build's — news before damage, as for the rest. Its turn
      // is any number, read within [0, 360); one that does not read is
      // dropped alone, and the star kept upright.
      const fill = readFill(entry.fill);
      const scale = readGlyphScale(entry.scale);
      if (fill === NEWER || scale === NEWER) return NEWER;
      if (fill === null || scale === null) return null;
      const angle = finiteNumber(entry.angle);
      return {
        ...annotation,
        ...(fill !== undefined ? { fill } : {}),
        ...(angle !== null ? { angle: normalizeDegrees(angle) } : {}),
        ...(scale !== undefined ? { scale } : {}),
      };
    }
    case 'eye': {
      // Its scale as a star's, past its range a newer build's; the way it
      // looks any number, read within [0, 360), one that does not read
      // dropped alone, and the eye kept looking right (Revision 3).
      const scale = readGlyphScale(entry.scale);
      if (scale === NEWER || scale === null) return scale;
      const angle = finiteNumber(entry.angle);
      return {
        ...annotation,
        ...(angle !== null ? { angle: normalizeDegrees(angle) } : {}),
        ...(scale !== undefined ? { scale } : {}),
      };
    }
    case 'oval':
    case 'rectangle': {
      // Its size, as an enlarge area's rounded rectangle's: always written —
      // without one it does not read — and past R3-30b's range a newer
      // build's, news before damage. Its turn any number, read within
      // [0, 180) as a half turn draws it the same; one that does not read
      // dropped alone, and the shape kept upright (Revision 3).
      const size = readZoomSize(entry.size);
      if (size === NEWER || size === null) return size;
      const angle = finiteNumber(entry.angle);
      return { ...annotation, size, ...(angle !== null ? { angle: rectangleAngle(angle) } : {}) };
    }
    case 'x-ray': {
      // Its window's radius, as an enlarge circle's is read, and its depth,
      // which it must have — a whole number from one, with no upper bound
      // (Revision 3); a radius past the range this build draws is news, told
      // before damage. Its anchor, a point on the paper, dropped alone when it
      // does not read, and the window counted at its centre.
      const radius = readCloseUpRadius(entry.radius);
      const depth = readXRayDepth(entry.depth);
      if (radius === NEWER) return NEWER;
      if (radius === null || depth === null) return null;
      const anchor = readPaperPoint(entry.anchor);
      return { ...annotation, radius, depth, ...(anchor !== null ? { anchor } : {}) };
    }
    // Nothing beyond the fields every kind has. Each kind is named, so a new
    // one is a compile error here until it says what it reads.
    case 'push-arrow':
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
    case 'circle':
      return annotation;
  }
}

/** The fields a shaped arrow's node is written with; any other makes the arrow a newer build's. */
const PATH_NODE_FIELDS: ReadonlySet<string> = new Set(['at', 'in', 'out', 'type']);

/**
 * A shaped arrow's path, by the file's rules. Damage: not a list, fewer than
 * two nodes, a node that is not a record, or a point — a node's or a
 * handle's — that is not two numbers. A newer build's: more nodes than this
 * build shapes, a field on a node it has no name for, a `type` other than
 * `corner`, a handle before the tail or after the tip, or a point past
 * reach. News is told before damage, as for a whole annotation. Whether a
 * smooth node's handles are in line is never asked: that is editing's rule.
 */
function readPath(value: unknown, reach: AnnotationReach): DiagramPathNode[] | typeof NEWER | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  if (value.length > MAX_PATH_NODES) return NEWER;
  if (!value.every(isRecord)) return null;
  const last = value.length - 1;
  const newer = value.some(
    (node, index) =>
      Object.keys(node).some((key) => !PATH_NODE_FIELDS.has(key)) ||
      (index === 0 && node.in !== undefined) ||
      (index === last && node.out !== undefined) ||
      (typeof node.type === 'string' && node.type !== 'corner')
  );
  if (newer) return NEWER;
  const nodes: DiagramPathNode[] = [];
  let past = false;
  for (const entry of value) {
    if (entry.type !== undefined && entry.type !== 'corner') return null;
    const at = readAnnotationPoint(entry.at, reach);
    const handles = (['in', 'out'] as const).map((side) =>
      entry[side] === undefined ? undefined : readAnnotationPoint(entry[side], reach)
    );
    if (at === null || handles.includes(null)) return null;
    if (at === NEWER || handles.includes(NEWER)) {
      past = true;
      continue;
    }
    const [inHandle, outHandle] = handles as ([number, number] | undefined)[];
    nodes.push({
      at,
      ...(inHandle ? { in: inHandle } : {}),
      ...(outHandle ? { out: outHandle } : {}),
      ...(entry.type === 'corner' ? { type: 'corner' as const } : {}),
    });
  }
  return past ? NEWER : nodes;
}

/** An x-ray's depth (Revision 3): a whole number from one, always written; anything else — unsaid too — damage. */
function readXRayDepth(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

/** An angle mark's ticks, or equal divisions': unsaid, one; a whole count past three, a newer build's; anything else, damage. */
function readTicks(value: unknown): DiagramTicks | undefined | typeof NEWER | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return null;
  return value <= 3 ? (value as DiagramTicks) : NEWER;
}

/** A label's or a callout's words: one line, as long as a label may be; longer, a newer build's; not a string, damage. */
function readLabelText(value: unknown): string | typeof NEWER | null {
  if (typeof value !== 'string') return null;
  const text = xmlText(value);
  return text.length > LABEL_MAX_LENGTH ? NEWER : text;
}

/** A label's Bold or halo (17b), or equal divisions' short dividers (Revision 3), read as `numbered` is: unsaid or false, no; true, yes; anything else, damage. */
function readFlag(value: unknown): boolean | null {
  if (value === undefined) return false;
  return typeof value === 'boolean' ? value : null;
}

/**
 * A label's size in pt (17b): unsaid, with the picture; a finite number from
 * 4 to 48, that size; a larger one, a newer build's; anything else, damage.
 */
function readTextSize(value: unknown): number | undefined | typeof NEWER | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < TEXT_SIZE_PT.min) return null;
  return value <= TEXT_SIZE_PT.max ? value : NEWER;
}

/**
 * How far a label's words hang off its anchor, in pt (17b): unsaid, centred
 * on it; two finite numbers each within ±200 pt, that offset; one further, a
 * newer build's; anything else, damage.
 */
function readTextOffset(value: unknown): [number, number] | undefined | typeof NEWER | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [dx, dy] = value as unknown[];
  if (typeof dx !== 'number' || typeof dy !== 'number' || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return Math.abs(dx) <= TEXT_OFFSET_PT_MAX && Math.abs(dy) <= TEXT_OFFSET_PT_MAX ? [dx, dy] : NEWER;
}

/**
 * A solid line's colour (17a), or a label's (17b): unsaid, the style's arrow ink; a `#rrggbb`
 * string, that colour; any other string, a newer build's — a named colour, a
 * theme's — and anything else, damage. Read as a white arrow's fill is.
 */
function readColor(value: unknown): string | undefined | typeof NEWER | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  return isAnnotationColor(value) ? value : NEWER;
}

/** A white arrow's fill: unsaid, the page's white; `black`, a solid arrow (15d); another word, a newer build's; anything else, damage. */
function readFill(value: unknown): 'black' | undefined | typeof NEWER | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  return value === 'black' ? value : NEWER;
}

/**
 * The ends of a mark behind a flap (15e): unsaid or empty, none. An end its
 * kind has no name for, or more layers than this build counts, is a newer
 * build's; a count that is not a whole number of layers, or not a record,
 * is damage.
 */
function readBehind(value: unknown, ends: readonly ('from' | 'to')[]): DiagramBehind | undefined | typeof NEWER | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  if (Object.keys(value).some((key) => !(ends as readonly string[]).includes(key))) return NEWER;
  const behind: DiagramBehind = {};
  for (const end of ends) {
    const layers = value[end];
    if (layers === undefined) continue;
    if (typeof layers !== 'number' || !Number.isInteger(layers) || layers < 1) return null;
    if (layers > MAX_BEHIND_LAYERS) return NEWER;
    behind[end] = layers;
  }
  return behind.from !== undefined || behind.to !== undefined ? behind : undefined;
}

/**
 * A close-up's area's radius (15f), which it must have: one smaller or
 * larger than this build draws, a newer build's; anything that is not a
 * size — unsaid too — damage.
 */
function readCloseUpRadius(value: unknown): number | typeof NEWER | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value < MIN_CLOSE_UP_RADIUS || value > MAX_CLOSE_UP_RADIUS ? NEWER : value;
}

/** A close-up's scale (15f): unsaid, twice; one past the range this build draws, a newer build's; anything else, damage. */
function readCloseUpScale(value: unknown): number | undefined | typeof NEWER | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value < CLOSE_UP_SCALE.min || value > CLOSE_UP_SCALE.max ? NEWER : value;
}

/**
 * A star's or an eye's scale (Revision 3): unsaid, its print size; a positive number,
 * as a close-up's is read, past {@link GLYPH_SCALE} a newer build's; anything
 * else, damage.
 */
function readGlyphScale(value: unknown): number | undefined | typeof NEWER | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value < GLYPH_SCALE.min || value > GLYPH_SCALE.max ? NEWER : value;
}

/**
 * An enlarge area (Revision 2): a circle's radius, as a close-up's area's is
 * read, or a rounded rectangle's size, exactly one of them — both or neither
 * does not read; its turn, its Size, its Edge and a picked anchor, each
 * unsaid by default. A value past what this build reads is a newer build's,
 * told before damage; a turn, Size, Edge or anchor that does not read is
 * dropped alone, and the area is kept.
 */
function readZoomArea(
  annotation: KnownDiagramAnnotation,
  entry: Record<string, unknown>
): KnownDiagramAnnotation | typeof NEWER | null {
  const radius = entry.radius === undefined ? undefined : readCloseUpRadius(entry.radius);
  const size = entry.size === undefined ? undefined : readZoomSize(entry.size);
  const scale = readCloseUpScale(entry.scale);
  const edge = entry.edge === undefined ? undefined : readPreset(entry.edge, ZOOM_EDGES, 'cut');
  if (radius === NEWER || size === NEWER || scale === NEWER || edge === NEWER) return NEWER;
  if ((radius === undefined) === (size === undefined) || radius === null || size === null) return null;
  const angle = finiteNumber(entry.angle);
  const anchor = readPaperPoint(entry.anchor);
  return {
    ...annotation,
    ...(radius !== undefined ? { radius } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(angle !== null ? { angle } : {}),
    ...(scale !== undefined && scale !== null ? { scale } : {}),
    ...(edge !== undefined && edge !== null ? { edge } : {}),
    ...(anchor !== null ? { anchor } : {}),
  };
}

/** How an enlarged step draws its frame, as this build draws it. */
const ZOOM_EDGES: readonly DiagramZoomEdge[] = ['cut', 'whole'];
/** An enlarge area's, or a frame's, shapes, as this build draws them. */
const ZOOM_SHAPES: readonly DiagramZoomShape[] = ['circle', 'rounded'];

/**
 * A rounded rectangle's width and height: two sizes, each from a slip to
 * twice the frame — past that, a newer build's, as a close-up's radius is;
 * anything that is not two sizes, damage.
 */
function readZoomSize(value: unknown): [number, number] | typeof NEWER | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [width, height] = value;
  if (![width, height].every((side) => typeof side === 'number' && Number.isFinite(side) && side > 0)) return null;
  const sides = [width, height] as [number, number];
  return sides.some((side) => side < ZOOM_SIDE.min || side > ZOOM_SIDE.max) ? NEWER : sides;
}

/** A point on the paper, in paper coordinates: two finite numbers, or null. Paper is never past reach. */
function readPaperPoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [x, y] = value;
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

/** The fields an enlarged step's `zoom` is written with; any other makes the step a newer build's. */
const STEP_ZOOM_KEYS: ReadonlySet<string> = new Set(['from', 'shape', 'frame', 'imprint', 'scale', 'edge', 'areaWas']);
/** The fields an outline is written with; an imprint's add its paper point and whether it was picked. */
const OUTLINE_KEYS: ReadonlySet<string> = new Set(['centre', 'radius', 'size', 'angle']);
const IMPRINT_KEYS: ReadonlySet<string> = new Set([...OUTLINE_KEYS, 'on', 'picked']);
/** The fields the area a step was captured from is recorded with (review fix 4). */
const AREA_WAS_KEYS: ReadonlySet<string> = new Set(['stepId', 'outline', 'anchor', 'scale', 'edge']);

/**
 * An enlarged step's `zoom` (Revision 2). A field, a shape or an edge this
 * build has no name for, or a value past what it reads, is a newer build's,
 * and makes the step one: locked, written back whole. Anything else that does
 * not read is damage: the zoom is dropped (the step's marks were in its
 * window's units, so they are out of step with the whole picture now).
 */
function readStepZoom(value: unknown): DiagramStepZoom | typeof NEWER | null {
  if (!isRecord(value)) return null;
  if (hasNewerKey(value, STEP_ZOOM_KEYS)) return NEWER;
  const shape = typeof value.shape === 'string' ? readPreset(value.shape, ZOOM_SHAPES, 'circle') : null;
  const edge = value.edge === undefined ? undefined : readPreset(value.edge, ZOOM_EDGES, 'cut');
  const scale = readCloseUpScale(value.scale);
  const frame = value.frame === undefined ? undefined : readZoomOutline(value.frame, OUTLINE_KEYS, true);
  const imprint = value.imprint === undefined ? undefined : readZoomOutline(value.imprint, IMPRINT_KEYS, false);
  const areaWas = readAreaWas(value.areaWas);
  if (shape === NEWER || edge === NEWER || scale === NEWER || frame === NEWER || imprint === NEWER || areaWas === NEWER) {
    return NEWER;
  }
  if (typeof value.from !== 'string' || value.from.length === 0) return null;
  if (shape === null || edge === null || scale === null || frame === null || imprint === null) return null;
  const outlines = [frame, imprint].filter((outline) => outline !== undefined) as DiagramZoomOutline[];
  // Its outlines are its shape: a circle's a radius, a rectangle's a size.
  if (outlines.some((outline) => (outline.radius !== undefined) !== (shape === 'circle'))) return null;
  let readImprint: DiagramStepZoom['imprint'];
  if (imprint !== undefined) {
    const raw = value.imprint as Record<string, unknown>;
    const on = readPaperPoint(raw.on);
    if (on === null || (raw.picked !== undefined && raw.picked !== true)) return null;
    readImprint = { ...imprint, on, ...(raw.picked === true ? { picked: true as const } : {}) };
  }
  return {
    from: value.from,
    shape,
    ...(frame !== undefined ? { frame } : {}),
    ...(readImprint !== undefined ? { imprint: readImprint } : {}),
    ...(scale !== undefined ? { scale } : {}),
    ...(edge !== undefined ? { edge } : {}),
    ...(areaWas !== undefined ? { areaWas } : {}),
  };
}

/**
 * The area an enlarged step was captured from, as it was then (review fix
 * 4): its step's id, its outline in that step's picture units, a picked
 * anchor on the paper, and the Size and Edge the capture copied, each
 * unsaid by default as on the area. A field this build has no name for, or
 * a value past what it reads, is a newer build's, as the zoom's own are.
 * Unsaid — a file from before it — or damaged, there is none, and the step
 * is not known to be out of date until its area is edited: the record alone
 * is dropped, never the frame.
 */
function readAreaWas(value: unknown): DiagramZoomAreaWas | undefined | typeof NEWER {
  if (value === undefined || !isRecord(value)) return undefined;
  if (hasNewerKey(value, AREA_WAS_KEYS)) return NEWER;
  const outline = readZoomOutline(value.outline, OUTLINE_KEYS, true);
  const scale = readCloseUpScale(value.scale);
  const edge = value.edge === undefined ? undefined : readPreset(value.edge, ZOOM_EDGES, 'cut');
  if (outline === NEWER || scale === NEWER || edge === NEWER) return NEWER;
  const anchor = value.anchor === undefined ? undefined : readPaperPoint(value.anchor);
  if (typeof value.stepId !== 'string' || value.stepId.length === 0 || outline === null || anchor === null) return undefined;
  if (scale === null || edge === null) return undefined;
  return {
    stepId: value.stepId,
    outline,
    ...(anchor !== undefined ? { anchor } : {}),
    ...(scale !== undefined ? { scale } : {}),
    ...(edge !== undefined ? { edge } : {}),
  };
}

/**
 * A frame's outline, in its step's picture units (`inPicture`, its centre
 * within reach, past which it is a newer build's) or its imprint's on the
 * paper: a centre, exactly one of a radius and a size, each a size, and a
 * turn. A field outside `keys` is a newer build's.
 */
function readZoomOutline(
  value: unknown,
  keys: ReadonlySet<string>,
  inPicture: boolean
): DiagramZoomOutline | typeof NEWER | null {
  if (!isRecord(value)) return null;
  if (hasNewerKey(value, keys)) return NEWER;
  const centre = inPicture ? readAnnotationPoint(value.centre) : readPaperPoint(value.centre);
  if (centre === NEWER) return NEWER;
  const radius = value.radius === undefined ? undefined : finiteNumber(value.radius);
  const size = value.size === undefined ? undefined : readPaperPoint(value.size);
  const angle = value.angle === undefined ? undefined : finiteNumber(value.angle);
  if (centre === null || radius === null || size === null || angle === null) return null;
  if ((radius === undefined) === (size === undefined)) return null;
  if (radius !== undefined && !(radius > 0)) return null;
  if (size !== undefined && !(size[0] > 0 && size[1] > 0)) return null;
  return {
    centre,
    ...(radius !== undefined ? { radius } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(angle !== undefined ? { angle } : {}),
  };
}

/** An enlarged step's `zoom` as written: every optional field only when set, in the order it is read. */
function writeStepZoom(zoom: DiagramStepZoom): Record<string, unknown> {
  const outline = ({ centre, radius, size, angle }: DiagramZoomOutline) => ({
    centre,
    ...(radius !== undefined ? { radius } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(angle !== undefined ? { angle } : {}),
  });
  return {
    from: zoom.from,
    shape: zoom.shape,
    ...(zoom.frame ? { frame: outline(zoom.frame) } : {}),
    ...(zoom.imprint
      ? { imprint: { ...outline(zoom.imprint), on: zoom.imprint.on, ...(zoom.imprint.picked ? { picked: true } : {}) } }
      : {}),
    ...(zoom.scale !== undefined ? { scale: zoom.scale } : {}),
    ...(zoom.edge !== undefined ? { edge: zoom.edge } : {}),
    ...(zoom.areaWas
      ? {
          areaWas: {
            stepId: zoom.areaWas.stepId,
            outline: outline(zoom.areaWas.outline),
            ...(zoom.areaWas.anchor ? { anchor: zoom.areaWas.anchor } : {}),
            ...(zoom.areaWas.scale !== undefined ? { scale: zoom.areaWas.scale } : {}),
            ...(zoom.areaWas.edge !== undefined ? { edge: zoom.areaWas.edge } : {}),
          },
        }
      : {}),
  };
}

/** The fields a step's placement is written with, and its pin's; any other is a newer build's. */
const PLACE_KEYS: ReadonlySet<string> = new Set([...PLACE_OFFSETS, 'scale']);
const PLACE_SCALE_KEYS: ReadonlySet<string> = new Set(['mmPerUnit', 'frameMm']);

/**
 * A step's hand placement (`implementation-plans/diagram-page-overrides.md`).
 * A field this build has no name for, of the placement or of its pin, keeps
 * the whole record as it came, a newer build's (`placeNewer`): written back
 * verbatim and never applied, the step still editable — placement is how a
 * step is laid out, and a locked step would print with no picture. A field
 * that does not read is dropped alone, as is an offset of none; a placement
 * left with nothing is none. How large a pin may print is the layout's to
 * hold, not the reader's, which does not know the picture's units.
 */
function readStepPlace(value: unknown): Pick<DiagramStep, 'place' | 'placeNewer'> {
  if (!isRecord(value)) return {};
  if (hasNewerKey(value, PLACE_KEYS) || (isRecord(value.scale) && hasNewerKey(value.scale, PLACE_SCALE_KEYS))) {
    return { placeNewer: value };
  }
  const place: DiagramStepPlace = {};
  for (const part of PLACE_OFFSETS) {
    const offset = placeOffset(value[part]);
    if (offset) place[part] = offset;
  }
  const scale = placeScale(value.scale);
  if (scale) place.scale = scale;
  return Object.keys(place).length > 0 ? { place } : {};
}

/**
 * Whether a flat capture's faces agree with its stored scene: every face the
 * scene draws is one `rings` lists, and — when the step's picture is spread,
 * where a face's drawn places are read from the scene — every named face is
 * drawn whole there once, one ring corner for corner with its own.
 */
function paperFacesFitScene(faces: DiagramPaperFaces, picture: DiagramScenePicture, spread: boolean): boolean {
  let scene = readScenes.get(picture);
  if (scene === undefined) {
    try {
      scene = JSON.parse(picture.sceneJson);
    } catch {
      return false;
    }
  }
  const items = isRecord(scene) && Array.isArray(scene.items) ? scene.items : [];
  const whole = new Map<number, number | null>();
  for (const item of items) {
    if (!isRecord(item) || item.kind !== 'face' || typeof item.face !== 'number') continue;
    if (!Number.isInteger(item.face) || item.face < 0 || item.face >= faces.rings.length) return false;
    if (whole.has(item.face)) continue;
    whole.set(item.face, Array.isArray(item.rings) && item.rings.length === 1 && Array.isArray(item.rings[0]) ? item.rings[0].length : null);
  }
  if (!spread) return true;
  return faces.rings.every((ring, face) => ring.length === 0 || whole.get(face) === ring.length);
}

/** A pleat arrow's Zs: unsaid, one; a whole count past five, a newer build's; anything else, damage. */
function readKinks(value: unknown): DiagramPleatKinks | undefined | typeof NEWER | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return null;
  return value <= 5 ? (value as DiagramPleatKinks) : NEWER;
}

/**
 * How many parts equal divisions cut their line into, which they must say: a
 * whole number past the most this build draws, a newer build's; fewer than
 * two, not whole, or unsaid, damage.
 */
function readDivisionsParts(value: unknown): number | typeof NEWER | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < DIVISIONS_PARTS.min) return null;
  return value > DIVISIONS_PARTS.max ? NEWER : value;
}

/**
 * How far equal divisions' line stands off the line they measure, in mm,
 * which they must say: past the furthest this build draws, a newer build's;
 * below none, not a number, or unsaid, damage.
 */
function readDivisionsOffset(value: unknown): number | typeof NEWER | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < DIVISIONS_OFFSET_MM.min) return null;
  return value > DIVISIONS_OFFSET_MM.max ? NEWER : value;
}

/** Whether equal divisions print their count: unsaid or false, no; true, yes; anything else, damage. */
function readNumbered(value: unknown): boolean | null {
  if (value === undefined) return false;
  return typeof value === 'boolean' ? value : null;
}

/** Which side a pleat arrow's Zs step to, or equal divisions' line lies: unsaid or false, the right; true, the left; anything else, damage. */
function readMirrored(value: unknown): boolean | null {
  if (value === undefined) return false;
  return typeof value === 'boolean' ? value : null;
}

/** A white arrow's widths and tails, as this build draws them. */
const WHITE_ARROW_WIDTHS: readonly DiagramWhiteArrowWidth[] = ['narrow', 'regular', 'wide'];
const WHITE_ARROW_TAILS: readonly WhiteArrowTail[] = ['pointed', 'square', 'cleft'];

/** One of a set of presets: `fallback` when unsaid, a newer build's when a string this build has no name for. */
function readPreset<T extends string>(value: unknown, known: readonly T[], fallback: T): T | typeof NEWER | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') return null;
  return (known as readonly string[]).includes(value) ? (value as T) : NEWER;
}

/** How far and which way a rotation turns: a quarter clockwise when unsaid. Shared by the glyph and the turn (D22). */
function readRotation(value: unknown): DiagramRotation | typeof NEWER | null {
  if (value === undefined) return DEFAULT_ROTATION;
  if (!isRecord(value)) return null;
  // A field it has no name for is news before a missing one is damage, as for a whole annotation.
  if (Object.keys(value).some((key) => key !== 'amount' && key !== 'direction')) return NEWER;
  if (typeof value.amount !== 'string' || typeof value.direction !== 'string') return null;
  if (!['eighth', 'quarter', 'half'].includes(value.amount) || !['cw', 'ccw'].includes(value.direction)) {
    return NEWER;
  }
  return { amount: value.amount as DiagramRotation['amount'], direction: value.direction as DiagramRotation['direction'] };
}

/** The axis a turn-over turns about: the vertical one, side to side, when unsaid. */
function readAxis(value: unknown): 'vertical' | 'horizontal' | typeof NEWER | null {
  if (value === undefined) return 'vertical';
  if (typeof value !== 'string') return null;
  return value === 'vertical' || value === 'horizontal' ? value : NEWER;
}

/** A turn's fields, by its kind (D22): any other is a newer build's. */
const TURN_FIELDS: Readonly<Record<DiagramTurn['kind'], ReadonlySet<string>>> = {
  'turn-over': new Set(['id', 'kind', 'axis']),
  rotate: new Set(['id', 'kind', 'rotate']),
};

/**
 * One turn between steps (D22). A kind, a field or a value this build does
 * not know is a newer build's; a known one that does not read is left out.
 */
function readTurn(id: string, entry: Record<string, unknown>): DiagramTurn | typeof NEWER | null {
  if (typeof entry.kind !== 'string') return null;
  if (!Object.hasOwn(TURN_FIELDS, entry.kind)) return NEWER;
  const kind = entry.kind as DiagramTurn['kind'];
  if (Object.keys(entry).some((key) => !TURN_FIELDS[kind].has(key))) return NEWER;
  if (kind === 'rotate') {
    const rotate = readRotation(entry.rotate);
    return rotate === null || rotate === NEWER ? rotate : { id, kind, rotate };
  }
  const axis = readAxis(entry.axis);
  return axis === null || axis === NEWER ? axis : { id, kind, axis };
}

/**
 * A point in its step's units — its picture's, or an enlarged step's
 * window's — a newer build's when it reaches past where this build lets one
 * go there (`reach`).
 */
function readAnnotationPoint(value: unknown, reach: AnnotationReach = PICTURE_REACH): [number, number] | typeof NEWER | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [x, y] = value;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return isWithinReach([x, y], reach) ? [x, y] : NEWER;
}

/**
 * The assets table, under its keys. An SVG is sanitized again and a bitmap
 * header-checked, and one that fails is dropped (the steps that showed it
 * become empty). One a newer build wrote — of a kind, or with a field, this
 * build has no name for; an SVG longer, or a bitmap larger, than it keeps; a
 * bitmap in a format it does not read — is carried verbatim, and the steps
 * that show it are carried, locked, with it.
 */
function readAssets(value: unknown, env: () => SanitizeEnv): Record<string, DiagramAsset> {
  if (!isRecord(value)) return {};
  const out: Record<string, DiagramAsset> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!isRecord(entry) || typeof entry.kind !== 'string') continue;
    const asset = readAsset(id, entry, env);
    if (asset === NEWER) out[id] = { id, unknown: entry };
    else if (asset) out[id] = asset;
  }
  return out;
}

function readAsset(
  id: string,
  entry: Record<string, unknown>,
  env: () => SanitizeEnv
): KnownDiagramAsset | typeof NEWER | null {
  if (!Object.hasOwn(ASSET_KEYS, entry.kind as string)) return NEWER;
  const kind = entry.kind as KnownDiagramAsset['kind'];
  if (hasNewerKey(entry, ASSET_KEYS[kind])) return NEWER;
  return kind === 'svg' ? readSvgAsset(id, entry, env()) : readRasterAsset(id, entry);
}

function readSvgAsset(
  id: string,
  entry: Record<string, unknown>,
  env: SanitizeEnv
): DiagramSvgAsset | typeof NEWER | null {
  if (typeof entry.svg !== 'string') return null;
  // Longer than this build keeps: a newer build's, carried and never sanitized here.
  if (entry.svg.length > SVG_STORED_MAX_BYTES) return NEWER;
  // The asset's id is its ids' prefix, as at import, which is what makes a
  // load of an untouched file change nothing.
  const result = sanitizeSvg(entry.svg, { idPrefix: id, mode: 'load', env });
  if (!result.ok) return null;
  if (result.svg.length > SVG_STORED_MAX_BYTES) return NEWER;
  return {
    id,
    kind: 'svg',
    svg: result.svg,
    widthPx: result.widthPx,
    heightPx: result.heightPx,
    bytes: result.svg.length,
  };
}

const RASTER_SRC = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/;
/** A bitmap of a format this build does not read: a newer build's. */
const OTHER_RASTER_SRC = /^data:image\/[a-z0-9.+-]+;base64,/i;

/**
 * A bitmap as an upload stored it: a PNG or JPEG data URL whose header agrees
 * with the stored size, at most 2048 px a side. One in another image format,
 * or larger, is a newer build's; anything else is dropped.
 */
function readRasterAsset(id: string, entry: Record<string, unknown>): DiagramRasterAsset | typeof NEWER | null {
  const { src, widthPx, heightPx } = entry;
  if (typeof src !== 'string' || typeof widthPx !== 'number' || typeof heightPx !== 'number') return null;
  const match = RASTER_SRC.exec(src);
  if (!match) return OTHER_RASTER_SRC.test(src) ? NEWER : null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
  const size = rasterHeaderSize(bytes, match[1]);
  if (!size || size.width !== widthPx || size.height !== heightPx) return null;
  if (Math.max(size.width, size.height) > EMBEDDED_RASTER_MAX_SIDE) return NEWER;
  return { id, kind: 'raster', src, widthPx, heightPx, bytes: src.length };
}

function readHanStyle(value: unknown): DiagramHanStyle {
  return value === 'sc' || value === 'tc' || value === 'jp' || value === 'kr' ? value : 'sc';
}

function readStyle(value: unknown): DiagramStyle {
  if (!isRecord(value)) return DEFAULT_DIAGRAM_STYLE;
  if (isBuiltInPaperPresetId(value.preset)) return { preset: value.preset };
  if (isRecord(value.style)) return { style: normalizePaperStyle(value.style) };
  return DEFAULT_DIAGRAM_STYLE;
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
