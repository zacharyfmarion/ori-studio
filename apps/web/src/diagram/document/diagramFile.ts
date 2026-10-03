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
import { readFoldedSourceBounds, readRegionReference } from '../../cp-workspace/regions/regionReference';
import { readSheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import { isBuiltInPaperPresetId } from '../../lib/paper/paperPresets';
import { readPaperScene } from '../../lib/paper/paperSceneValidate';
import { normalizePaperStyle } from '../../lib/paper/paperStyle';
import { xmlText } from '../../lib/xmlEscape';
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
  PAPER_SIZES,
  isKnownAsset,
  normalizePageSetup,
  randomDiagramId,
  withReferencedAssets,
  type DiagramAnnotation,
  type DiagramAsset,
  type DiagramCpRender,
  type DiagramCpScope,
  type DiagramCpSource,
  type DiagramDocument,
  type DiagramFixedPicture,
  type DiagramPicture,
  type DiagramHanStyle,
  type DiagramIdFactory,
  type DiagramRasterAsset,
  type DiagramStep,
  type DiagramStepSource,
  type DiagramStyle,
  type DiagramSvgAsset,
  type QuarterTurns,
} from './diagramDocument';

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
  const steps: DiagramStep[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(value.steps) ? value.steps : []) {
    const step = readStep(entry, assets, env);
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

function writeStep(step: DiagramStep): Record<string, unknown> {
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
  return annotation.unknown;
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
const SOURCE_KINDS = new Set(['upload', 'cp']);
/** The picture kinds this build reads. */
const PICTURE_KINDS = new Set(['asset', 'scene', 'fixed']);
/** Within a crease-pattern source: the scopes and render modes this build reads. */
const CP_SCOPE_KINDS = new Set(['segment', 'figure-bounds']);
const CP_RENDER_MODES = new Set(['crease-pattern', 'folded-flat', 'folded-3d']);

/** The most a stored scene may be, as JSON: D2's per-step budget, with room. */
const SCENE_JSON_MAX_BYTES = 4 * 1024 * 1024;

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
    annotations: readAnnotations(value.annotations),
    annotatedPictureKey:
      typeof value.annotatedPictureKey === 'string' ? value.annotatedPictureKey : null,
    text: typeof value.text === 'string' ? xmlText(value.text) : '',
    breakBefore: value.breakBefore === true,
  };
  if (
    isNewerKind(value.source, SOURCE_KINDS) ||
    isNewerKind(value.picture, PICTURE_KINDS) ||
    isNewerCpSource(value.source) ||
    namesUnknownAsset(value.source, assets) ||
    namesUnknownAsset(value.picture, assets)
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
    return { ...base, source, picture };
  }
  // A picture with no source to say what it is of is left out.
  return base;
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

/** A crease-pattern source, every field checked; null when any does not read. */
function readCpSource(value: Record<string, unknown>): DiagramCpSource | null {
  const scope = readCpScope(value.scope);
  const render = readCpRender(value.render);
  const thumbnail = readSheetThumbnail(value.thumbnail);
  const fingerprint = value.fingerprint;
  if (!scope || !render || !thumbnail) return null;
  if (typeof fingerprint !== 'string' || fingerprint.length === 0) return null;
  return { kind: 'cp', scope, fingerprint, thumbnail, render };
}

function readCpScope(value: unknown): DiagramCpScope | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'segment') {
    const region = readRegionReference(value.region);
    return region ? { kind: 'segment', region } : null;
  }
  if (value.kind === 'figure-bounds') {
    const bounds = readFoldedSourceBounds(value.bounds);
    return bounds ? { kind: 'figure-bounds', bounds } : null;
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
      return { kind: 'asset', assetId, paperScale, key };
    }
    case 'scene': {
      const sceneJson = readSceneJson(value.sceneJson);
      if (sceneJson === null) return null;
      const styleKey = typeof value.styleKey === 'string' ? value.styleKey : null;
      return { kind: 'scene', sceneJson, paperScale, styleKey, key };
    }
    case 'fixed':
      return readFixedPicture(value, key, env());
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
  return storedSceneJson(parsed);
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
  if (!result.ok) return null;
  return { kind: 'fixed', svg: result.svg, widthPx: result.widthPx, heightPx: result.heightPx, key };
}

function hasKnownAsset(assets: Record<string, DiagramAsset>, id: string): boolean {
  const asset = Object.hasOwn(assets, id) ? assets[id] : undefined;
  return asset !== undefined && isKnownAsset(asset);
}

/** No annotation kind is readable yet: each one with an id is carried verbatim. */
function readAnnotations(value: unknown): DiagramAnnotation[] {
  if (!Array.isArray(value)) return [];
  const out: DiagramAnnotation[] = [];
  for (const entry of value) {
    if (isRecord(entry) && typeof entry.id === 'string' && entry.id.length > 0) {
      out.push({ id: entry.id, unknown: entry });
    }
  }
  return out;
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
