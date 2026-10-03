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
 * stored can always be written into an SVG page.
 *
 * React-free, store-free and DOM-free.
 */

import { isBuiltInPaperPresetId } from '../../lib/paper/paperPresets';
import { normalizePaperStyle } from '../../lib/paper/paperStyle';
import { xmlText } from '../../lib/xmlEscape';
import {
  DEFAULT_DIAGRAM_STYLE,
  DIAGRAM_FORMAT_VERSION,
  PAPER_SIZES,
  normalizePageSetup,
  randomDiagramId,
  type DiagramAnnotation,
  type DiagramAsset,
  type DiagramDocument,
  type DiagramHanStyle,
  type DiagramIdFactory,
  type DiagramStep,
  type DiagramStyle,
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

/**
 * Read `workspace.diagram`. `null` for an absent diagram or one that is not an
 * object.
 */
export function readDiagram(
  value: unknown,
  newId: DiagramIdFactory = randomDiagramId
): ReadDiagram | null {
  if (!isRecord(value)) return null;
  const formatVersion = typeof value.formatVersion === 'number' ? value.formatVersion : 1;
  const steps: DiagramStep[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(value.steps) ? value.steps : []) {
    const step = readStep(entry);
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
    assets: readAssets(value.assets),
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
 * it was read; otherwise every field is named here, and a locked step,
 * annotation or asset goes back exactly as it came.
 */
export function writeDiagram(
  document: DiagramDocument,
  readOnlyRaw: Record<string, unknown> | null = null
): Record<string, unknown> {
  if (readOnlyRaw) return readOnlyRaw;
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
  return asset.unknown;
}

function readStep(value: unknown): DiagramStep | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  if (typeof id !== 'string' || id.length === 0) return null;
  // No source or picture kind is readable yet, so any non-null one is a newer
  // build's: the whole step is carried, locked.
  const sourceKnown = value.source === null || value.source === undefined;
  const pictureKnown = value.picture === null || value.picture === undefined;
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
  return sourceKnown && pictureKnown ? base : { ...base, unknown: value };
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

/** No asset kind is readable yet: each one is carried verbatim under its id. */
function readAssets(value: unknown): Record<string, DiagramAsset> {
  if (!isRecord(value)) return {};
  const out: Record<string, DiagramAsset> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (isRecord(entry)) out[id] = { id, unknown: entry };
  }
  return out;
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
