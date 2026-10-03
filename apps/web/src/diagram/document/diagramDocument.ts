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

/**
 * Where a step's picture comes from. The variants arrive with the phases that
 * build them; until then a step's source is always `null`, and a source this
 * build does not know makes the step an unknown, locked one (see
 * {@link DiagramStep.unknown}).
 */
export type DiagramStepSource = never;

/** A step's captured picture. Variants arrive with their phases, as sources do. */
export type DiagramPicture = never;

/**
 * An annotation this build cannot read, kept verbatim so a newer build's work
 * survives a round trip through this one. Readable kinds arrive with Annotate.
 */
export interface UnknownDiagramAnnotation {
  id: string;
  unknown: Record<string, unknown>;
}

export type DiagramAnnotation = UnknownDiagramAnnotation;

/** An asset this build cannot read, kept verbatim like an unknown annotation. */
export interface UnknownDiagramAsset {
  id: string;
  unknown: Record<string, unknown>;
}

export type DiagramAsset = UnknownDiagramAsset;

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
