/**
 * The diagram as it is stored in the project file (`workspace.diagram`), read
 * leniently and written back exactly.
 *
 * Three rules, from implementation-plans/diagram-workspace.md (Contracts):
 *
 * - **Malformed is dropped.** A step, annotation or asset that does not read is
 *   left out; the rest of the diagram opens. A diagram that is not an object at
 *   all reads as no diagram.
 * - **Unknown is kept.** An unrecognised kind at any depth — a step's source or
 *   picture, an annotation, an asset — is not malformed: it is a newer build's
 *   work. The enclosing step, annotation or asset is carried verbatim in its
 *   `unknown` field and written back unchanged, so a desktop build that lags
 *   the web build never deletes what it cannot show.
 * - **A newer document opens read-only.** When `formatVersion` is above this
 *   build's, the whole raw value is kept and written back unchanged; what is
 *   shown is a best-effort reading of it.
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

import { readFoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import { readRegionReference } from '../../cp-workspace/regions/regionReference';
import { readSheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import { isBuiltInPaperPresetId } from '../../lib/paper/paperPresets';
import { readPaperScene } from '../../lib/paper/paperSceneValidate';
import { normalizePaperStyle } from '../../lib/paper/paperStyle';
import { xmlText } from '../../lib/xmlEscape';
import {
  ANNOTATION_REACH,
  arrowBend,
  DEFAULT_ROTATION,
  LABEL_MAX_LENGTH,
  MAX_BEND,
  MAX_STEP_ANNOTATIONS,
  isPointKind,
} from '../annotate/annotationModel';
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
  DIAGRAM_SHOW_AS,
  PAPER_SIZES,
  isTurn,
  showAsOf,
  isKnownAsset,
  normalizePageSetup,
  randomDiagramId,
  withReferencedAssets,
  isKnownAnnotation,
  type DiagramAnnotation,
  type DiagramAnnotationKind,
  type DiagramRotation,
  type KnownDiagramAnnotation,
  type DiagramAsset,
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
  type DiagramRasterAsset,
  type DiagramShowAs,
  type DiagramStep,
  type DiagramStepSource,
  type DiagramStyle,
  type DiagramSvgAsset,
  type DiagramTurn,
  type QuarterTurns,
  type ReferencesPlanSettings,
} from './diagramDocument';
import { validateStepDiagramModel } from './stepDiagramModelFile';

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
 * Read `workspace.diagram`. `null` for an absent diagram or one that is not an
 * object.
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
  const document: DiagramDocument = {
    formatVersion: DIAGRAM_FORMAT_VERSION,
    id: typeof value.id === 'string' && value.id.length > 0 ? value.id : newId('diagram'),
    title: typeof value.title === 'string' ? xmlText(value.title) : '',
    hanStyle: readHanStyle(value.hanStyle),
    style: readStyle(value.style),
    page: normalizePageSetup(value.page),
    steps,
    assets,
  };
  const newer = formatVersion > DIAGRAM_FORMAT_VERSION || unknownDocumentField(value) !== null;
  return { document, readOnly: newer, raw: value };
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
  'scale',
  'showTitle',
  'pageNumbers',
]);
const PAGE_ENUMS: Record<string, readonly string[]> = {
  size: PAPER_SIZES,
  orientation: ['portrait', 'landscape'],
  layout: ['grid', 'flow'],
  scale: ['paper', 'fit'],
};

/**
 * The first document-level field a newer build wrote that this one cannot
 * keep, or `null`.
 *
 * Steps, annotations and assets of an unknown kind are carried one by one and
 * the rest of the diagram stays editable. A field of the document itself
 * cannot be carried that way: this build would write its own reading of it —
 * an unknown page size as A4 — and the next edit would build on that. So a key
 * it does not know, or a value it does not know for one of its enums, opens
 * the diagram read-only, as a newer `formatVersion` does, and the file is
 * written back as it came. A value of the wrong type is damage rather than
 * news, and is replaced as before.
 */
export function unknownDocumentField(value: Record<string, unknown>): string | null {
  for (const key of Object.keys(value)) if (!DOCUMENT_KEYS.has(key)) return key;
  if (typeof value.hanStyle === 'string' && !HAN_STYLES.includes(value.hanStyle)) return 'hanStyle';
  if (isRecord(value.style)) {
    for (const key of Object.keys(value.style)) if (key !== 'preset' && key !== 'style') return `style.${key}`;
    if (typeof value.style.preset === 'string' && !isBuiltInPaperPresetId(value.style.preset)) {
      return 'style.preset';
    }
  }
  if (isRecord(value.page)) {
    for (const key of Object.keys(value.page)) if (!PAGE_KEYS.has(key)) return `page.${key}`;
    for (const [key, known] of Object.entries(PAGE_ENUMS)) {
      const entry = value.page[key];
      if (typeof entry === 'string' && !known.includes(entry)) return `page.${key}`;
    }
    const numbers = value.page.pageNumbers;
    if (isRecord(numbers)) {
      for (const key of Object.keys(numbers)) if (key !== 'enabled' && key !== 'first') return `page.pageNumbers.${key}`;
    }
  }
  return null;
}

const HAN_STYLES: readonly string[] = ['sc', 'tc', 'jp', 'kr'];

/**
 * The value written to `workspace.diagram`. A read-only diagram is written as
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
  return {
    formatVersion: DIAGRAM_FORMAT_VERSION,
    id: document.id,
    title: document.title,
    hanStyle: document.hanStyle,
    style: document.style,
    page: document.page,
    steps: document.steps.map(writeStep),
    assets: Object.fromEntries(
      Object.entries(document.assets).map(([id, asset]) => [id, writeAsset(asset)])
    ),
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
  };
}

function writeAnnotation(annotation: DiagramAnnotation): Record<string, unknown> {
  if (!isKnownAnnotation(annotation)) return annotation.unknown;
  const { id, kind, from, to, bend, text, rotate, axis } = annotation;
  return {
    id,
    kind,
    from,
    to,
    ...(bend !== undefined ? { bend } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(rotate !== undefined ? { rotate } : {}),
    ...(axis !== undefined ? { axis } : {}),
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

/** The source kinds this build reads. Any other is a newer build's. */
const SOURCE_KINDS = new Set(['upload', 'cp', 'references-step']);
/** The picture kinds this build reads. */
const PICTURE_KINDS = new Set(['asset', 'scene', 'fixed', 'step-diagram']);
/** Within a crease-pattern source: the scopes and render modes this build reads. */
const CP_SCOPE_KINDS = new Set(['segment']);
const CP_RENDER_MODES = new Set(['crease-pattern', 'folded-flat', 'folded-3d', 'simulated']);

/** The most a stored scene may be, as JSON: D2's per-step budget, with room. */
const SCENE_JSON_MAX_BYTES = 4 * 1024 * 1024;

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
 * One step. A source or picture of a kind this build does not know — at any
 * depth: a crease-pattern source's scope or render mode too — makes the step a
 * newer build's, carried whole and locked; and so does one of a known kind
 * that names an asset of a kind this build does not know, which only that
 * newer build can draw. One of a known kind that does not read — or that names
 * an asset the file does not hold, or one dropped on the way in — is left out,
 * and the step keeps its words.
 */
function readStep(
  value: unknown,
  assets: Record<string, DiagramAsset>,
  env: () => SanitizeEnv
): DiagramStep | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  if (typeof id !== 'string' || id.length === 0) return null;
  const base: DiagramStep = {
    id,
    revision: wholeNumber(value.revision) ?? 0,
    source: null,
    picture: null,
    // More than a step holds is a newer build's step (below), carried whole and never parsed.
    annotations: tooManyAnnotations(value.annotations) ? [] : readAnnotations(value.annotations),
    annotatedPictureKey:
      typeof value.annotatedPictureKey === 'string' ? value.annotatedPictureKey : null,
    text: typeof value.text === 'string' ? xmlText(value.text) : '',
    breakBefore: value.breakBefore === true,
  };
  if (
    isNewerKind(value.source, SOURCE_KINDS) ||
    isNewerKind(value.picture, PICTURE_KINDS) ||
    isNewerCpSource(value.source) ||
    isNewerStepDiagram(value.picture) ||
    namesUnknownAsset(value.source, assets) ||
    namesUnknownAsset(value.picture, assets) ||
    tooManyAnnotations(value.annotations)
  ) {
    return { ...base, unknown: value };
  }
  const source = readSource(value.source, assets);
  const picture = readPicture(value.picture, assets, env);
  if (source?.kind === 'upload') {
    // An upload is its asset: a source and a picture that disagree about which
    // one are not a picture to show.
    return picture?.kind === 'asset' && picture.assetId === source.assetId
      ? { ...base, source, picture }
      : base;
  }
  if (source?.kind === 'cp') {
    // A linked step may have no picture yet ("Pose to capture"); its picture is
    // a scene, a fixed picture, or a capture too detailed to keep as vector,
    // kept as a bitmap asset.
    return { ...base, source, picture: picture?.kind === 'step-diagram' ? null : picture };
  }
  if (source?.kind === 'references-step') {
    // A References step's picture is its card's diagram, or none.
    return { ...base, source, picture: picture?.kind === 'step-diagram' ? picture : null };
  }
  // A picture with no source to say what it is of is left out.
  return base;
}

/** A References card drawn with a primitive kind or style this build does not draw. */
function isNewerStepDiagram(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.kind === 'step-diagram' &&
    validateStepDiagramModel(value.model).status === 'unknown'
  );
}

/** A crease-pattern source with a scope or render mode this build does not read. */
function isNewerCpSource(value: unknown): boolean {
  if (!isRecord(value) || value.kind !== 'cp') return false;
  return isNewerKind(value.scope, CP_SCOPE_KINDS) || isNewerMode(value.render);
}

function isNewerMode(value: unknown): boolean {
  return isRecord(value) && typeof value.mode === 'string' && !CP_RENDER_MODES.has(value.mode);
}

/** A source or picture naming an asset the table carries but this build cannot read. */
function namesUnknownAsset(value: unknown, assets: Record<string, DiagramAsset>): boolean {
  if (!isRecord(value) || typeof value.assetId !== 'string') return false;
  const asset = Object.hasOwn(assets, value.assetId) ? assets[value.assetId] : undefined;
  return asset !== undefined && !isKnownAsset(asset);
}

/** A value with a `kind` this build does not read. */
function isNewerKind(value: unknown, known: ReadonlySet<string>): boolean {
  return isRecord(value) && typeof value.kind === 'string' && !known.has(value.kind);
}

function readSource(value: unknown, assets: Record<string, DiagramAsset>): DiagramStepSource | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'cp') return readCpSource(value);
  if (value.kind === 'references-step') return readReferencesSource(value);
  if (value.kind !== 'upload') return null;
  const assetId = value.assetId;
  if (typeof assetId !== 'string' || !hasKnownAsset(assets, assetId)) return null;
  const turns = value.rotationQuarterTurns;
  return {
    kind: 'upload',
    assetId,
    rotationQuarterTurns:
      turns === 0 || turns === 1 || turns === 2 || turns === 3 ? (turns as QuarterTurns) : 0,
    mirrored: value.mirrored === true,
  };
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
  };
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
    case 'crease-pattern':
      return rotationDeg === null ? null : { mode: 'crease-pattern', rotationDeg: normalizeDegrees(rotationDeg) };
    case 'folded-flat': {
      const foldCase = wholeNumber(value.foldCase);
      if (!side || rotationDeg === null || foldCase === null || foldCase < 1) return null;
      return { mode: 'folded-flat', side, rotationDeg: normalizeDegrees(rotationDeg), foldCase };
    }
    case 'folded-3d': {
      const camera = readFoldedFigureCamera(value.camera);
      return side && camera ? { mode: 'folded-3d', camera, side } : null;
    }
    case 'simulated': {
      const foldPercent = finiteNumber(value.foldPercent);
      const view = readFoldedFigureCamera(value.view);
      if (foldPercent === null || foldPercent < 0 || foldPercent > 100 || !view) return null;
      return { mode: 'simulated', foldPercent, view };
    }
    default:
      return null;
  }
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
): DiagramPicture | null {
  if (!isRecord(value)) return null;
  const key = value.key;
  if (typeof key !== 'string' || key.length === 0) return null;
  const paperScale = positiveOrNull(value.paperScale);
  switch (value.kind) {
    case 'asset': {
      const assetId = value.assetId;
      if (typeof assetId !== 'string' || !hasKnownAsset(assets, assetId)) return null;
      const styleKey = typeof value.styleKey === 'string' && value.styleKey.length <= 512 ? value.styleKey : null;
      return { kind: 'asset', assetId, paperScale, ...(styleKey === null ? {} : { styleKey }), key };
    }
    case 'scene': {
      const sceneJson = readSceneJson(value.sceneJson);
      if (sceneJson === null) return null;
      const styleKey = typeof value.styleKey === 'string' ? value.styleKey : null;
      return { kind: 'scene', sceneJson, paperScale, styleKey, key };
    }
    case 'fixed':
      return readFixedPicture(value, key, env());
    case 'step-diagram': {
      const read = validateStepDiagramModel(value.model);
      return read.status === 'ok'
        ? { kind: 'step-diagram', model: read.model, mirrored: value.mirrored === true, key }
        : null;
    }
    default:
      return null;
  }
}

function positiveOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * A stored scene, validated as any scene from a file is (`readPaperScene`,
 * which drops markup), and written back in the validated form, so what is kept
 * is only what was checked.
 */
function readSceneJson(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > SCENE_JSON_MAX_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  // The cap holds for what is kept, too: filling in a field's default can
  // make the written scene longer than the one read, and a file this build
  // saved must load in it again.
  const stored = storedSceneJson(parsed);
  return stored !== null && stored.length <= SCENE_JSON_MAX_BYTES ? stored : null;
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
): DiagramFixedPicture | null {
  if (typeof value.svg !== 'string' || value.svg.length > SVG_STORED_MAX_BYTES) return null;
  // A key that cannot prefix an id is refused by the sanitizer.
  const result = sanitizeSvg(value.svg, { idPrefix: key, mode: 'load', env });
  // Checked again after sanitizing, as an SVG asset is: prefixing every id
  // lengthens the markup, and what is saved must load again.
  if (!result.ok || result.svg.length > SVG_STORED_MAX_BYTES) return null;
  return { kind: 'fixed', svg: result.svg, widthPx: result.widthPx, heightPx: result.heightPx, key };
}

function hasKnownAsset(assets: Record<string, DiagramAsset>, id: string): boolean {
  const asset = Object.hasOwn(assets, id) ? assets[id] : undefined;
  return asset !== undefined && isKnownAsset(asset);
}

/** The fields each kind is written with; any other makes the annotation a newer build's. */
const ANNOTATION_FIELDS: Readonly<Record<DiagramAnnotationKind, ReadonlySet<string>>> = (() => {
  const base = ['id', 'kind', 'from', 'to'];
  const fields = (...more: string[]) => new Set([...base, ...more]);
  return {
    'valley-arrow': fields('bend'),
    'mountain-arrow': fields('bend'),
    'fold-unfold-arrow': fields('bend'),
    'push-arrow': fields(),
    'turn-over': fields('axis'),
    rotate: fields('rotate'),
    'valley-line': fields(),
    'mountain-line': fields(),
    'hidden-line': fields(),
    label: fields('text'),
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
function readAnnotations(value: unknown): DiagramAnnotation[] {
  if (!Array.isArray(value)) return [];
  const out: DiagramAnnotation[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length === 0 || ids.has(entry.id)) continue;
    const annotation = readAnnotation(entry.id, entry);
    if (annotation === NEWER) out.push({ id: entry.id, unknown: entry });
    else if (annotation) out.push(annotation);
    else continue;
    ids.add(entry.id);
  }
  return out;
}

function readAnnotation(
  id: string,
  entry: Record<string, unknown>
): KnownDiagramAnnotation | typeof NEWER | null {
  if (typeof entry.kind !== 'string') return null;
  if (!Object.hasOwn(ANNOTATION_FIELDS, entry.kind)) return NEWER;
  const kind = entry.kind as DiagramAnnotationKind;
  const fields = ANNOTATION_FIELDS[kind];
  if (Object.keys(entry).some((key) => !fields.has(key))) return NEWER;
  const from = readAnnotationPoint(entry.from);
  const to = isPointKind(kind) ? from : readAnnotationPoint(entry.to);
  if (from === null || to === null) return null;
  if (from === NEWER || to === NEWER) return NEWER;
  const annotation: KnownDiagramAnnotation = { id, kind, from, to: [to[0], to[1]] };
  switch (kind) {
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow': {
      if (entry.bend === undefined) return { ...annotation, bend: arrowBend(annotation) };
      if (typeof entry.bend !== 'number' || !Number.isFinite(entry.bend) || entry.bend === 0) return null;
      return Math.abs(entry.bend) > MAX_BEND ? NEWER : { ...annotation, bend: entry.bend };
    }
    case 'label': {
      if (typeof entry.text !== 'string') return null;
      const text = xmlText(entry.text);
      return text.length > LABEL_MAX_LENGTH ? NEWER : { ...annotation, text };
    }
    case 'rotate': {
      const rotate = readRotation(entry.rotate);
      return rotate === null || rotate === NEWER ? rotate : { ...annotation, rotate };
    }
    case 'turn-over': {
      const axis = readAxis(entry.axis);
      return axis === null || axis === NEWER ? axis : { ...annotation, axis };
    }
    // Nothing beyond the fields every kind has. Each kind is named, so a new
    // one is a compile error here until it says what it reads.
    case 'push-arrow':
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
      return annotation;
  }
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

/** A point in picture units; a newer build's when it reaches past where this build lets one go. */
function readAnnotationPoint(value: unknown): [number, number] | typeof NEWER | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [x, y] = value;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.abs(x) > ANNOTATION_REACH || Math.abs(y) > ANNOTATION_REACH ? NEWER : [x, y];
}

/**
 * The assets table, under its keys. An SVG is sanitized again and a bitmap
 * header-checked, and one that fails is dropped (the steps that showed it
 * become empty); a kind this build does not know is carried verbatim.
 */
function readAssets(value: unknown, env: () => SanitizeEnv): Record<string, DiagramAsset> {
  if (!isRecord(value)) return {};
  const out: Record<string, DiagramAsset> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    if (entry.kind === 'svg') {
      const asset = readSvgAsset(id, entry, env());
      if (asset) out[id] = asset;
    } else if (entry.kind === 'raster') {
      const asset = readRasterAsset(id, entry);
      if (asset) out[id] = asset;
    } else if (typeof entry.kind === 'string') {
      out[id] = { id, unknown: entry };
    }
  }
  return out;
}

function readSvgAsset(
  id: string,
  entry: Record<string, unknown>,
  env: SanitizeEnv
): DiagramSvgAsset | null {
  if (typeof entry.svg !== 'string' || entry.svg.length > SVG_STORED_MAX_BYTES) return null;
  // The asset's id is its ids' prefix, as at import, which is what makes a
  // load of an untouched file change nothing.
  const result = sanitizeSvg(entry.svg, { idPrefix: id, mode: 'load', env });
  if (!result.ok || result.svg.length > SVG_STORED_MAX_BYTES) return null;
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

/**
 * A bitmap as an upload stored it: a PNG or JPEG data URL whose header agrees
 * with the stored size, at most 2048 px a side. Anything else is dropped.
 */
function readRasterAsset(id: string, entry: Record<string, unknown>): DiagramRasterAsset | null {
  const { src, widthPx, heightPx } = entry;
  if (typeof src !== 'string' || typeof widthPx !== 'number' || typeof heightPx !== 'number') return null;
  const match = RASTER_SRC.exec(src);
  if (!match) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
  const size = rasterHeaderSize(bytes, match[1]);
  if (!size || size.width !== widthPx || size.height !== heightPx) return null;
  if (Math.max(size.width, size.height) > EMBEDDED_RASTER_MAX_SIDE) return null;
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
