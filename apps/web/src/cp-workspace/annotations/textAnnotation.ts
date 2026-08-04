/**
 * Rich-text boxes placed on the crease-pattern canvas — the `'text'` variant of
 * the shared {@link AnnotationBase} substrate. A text box carries a Lexical
 * document (bold/italic/underline, block/text-type presets, color, alignment)
 * plus a resizable box that reflows its content.
 *
 * This is a **leaf** module: pure types + helpers, no DOM/Lexical-runtime or
 * store dependencies, so persistence, the renderer, and the store can all import
 * it and it can be unit-tested headlessly. (The editor runtime lives in the DOM
 * layer, `../CpTextAnnotationLayer.tsx`.)
 *
 * The full model persists in `.osf`. Oriedita export flattens each box to a
 * single `{x, y, text}` element (see {@link textAnnotationPlainText}); import
 * inflates `{x, y, text}` back into a default-styled box.
 */

import type { SerializedEditorState } from 'lexical';
import type { AnnotationBase } from './annotationBase';

export interface TextAnnotation extends AnnotationBase {
  /** Discriminant marking this annotation as a rich-text box. */
  kind: 'text';
  /**
   * The rich content as a Lexical {@link SerializedEditorState}. Source of truth
   * for rendering and `.osf`; {@link plainText} is a derived cache.
   */
  doc: SerializedEditorState;
  /**
   * Plain-text projection of {@link doc}, kept in sync on every edit. Used for
   * the Oriedita flatten codec, hit-test/measurement fallbacks, and empty-box
   * detection without spinning up a Lexical editor.
   */
  plainText: string;
  /**
   * Base font size in **model units**; the box and its text scale together with
   * zoom (like an image). Block/text-type presets scale this via CSS `em`.
   */
  fontSize: number;
  /** When true, the box height tracks its content instead of being fixed. */
  autoHeight: boolean;
  /**
   * Minimum box height in model units (0 = none). A drag-created box seeds this
   * with the dragged height, so the box starts that tall and grows *downward*
   * only if content overflows — content is never hidden. Click-created boxes
   * leave it 0 and size purely to their content.
   */
  minHeight: number;
}

/** A partial update to a text box (its `id` and `kind` never change). */
export type TextAnnotationUpdate = Partial<Omit<TextAnnotation, 'id' | 'kind'>>;

/** Default base font size (model units) as a fraction of a unit-square edge. */
export const DEFAULT_TEXT_FONT_SIZE = 0.04;

/** Default box width (model units) for a freshly created text box. */
export const DEFAULT_TEXT_BOX_WIDTH = 0.5;

/** An empty Lexical editor state: a single empty paragraph. */
export function emptyTextDoc(): SerializedEditorState {
  return {
    root: {
      children: [
        {
          children: [],
          direction: null,
          format: '',
          indent: 0,
          type: 'paragraph',
          version: 1,
        },
      ],
      direction: null,
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  } as unknown as SerializedEditorState;
}

/** A Lexical state holding a single paragraph of `text` (used by import). */
export function textDocFromPlainText(text: string): SerializedEditorState {
  const lines = text.split('\n');
  const children = lines.map((line) => ({
    children: line
      ? [
          {
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: line,
            type: 'text',
            version: 1,
          },
        ]
      : [],
    direction: null,
    format: '',
    indent: 0,
    type: 'paragraph',
    version: 1,
  }));
  return {
    root: {
      children,
      direction: null,
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  } as unknown as SerializedEditorState;
}

/**
 * Flatten a Lexical serialized state to plain text: concatenate every text
 * node's content, joining top-level blocks with a single newline. Pure — walks
 * the JSON directly, no Lexical runtime. This is the Oriedita compatibility
 * projection.
 */
export function serializedStateToPlainText(state: SerializedEditorState): string {
  const root = (state as { root?: { children?: unknown } }).root;
  const blocks = Array.isArray(root?.children) ? root.children : [];
  return blocks.map((block) => nodePlainText(block)).join('\n');
}

function nodePlainText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const record = node as { text?: unknown; type?: unknown; children?: unknown };
  if (record.type === 'linebreak') return '\n';
  if (typeof record.text === 'string') return record.text;
  if (Array.isArray(record.children)) {
    return record.children.map((child) => nodePlainText(child)).join('');
  }
  return '';
}

/** Plain-text projection of a text annotation (its cached {@link TextAnnotation.plainText}). */
export function textAnnotationPlainText(annotation: TextAnnotation): string {
  return annotation.plainText;
}

function generateTextAnnotationId(): string {
  const cryptoObj =
    typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `text-${cryptoObj.randomUUID()}`;
  }
  return `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface CreateTextAnnotationInput {
  center: { x: number; y: number };
  id?: string;
  doc?: SerializedEditorState;
  plainText?: string;
  width?: number;
  height?: number;
  rotation?: number;
  fontSize?: number;
  opacity?: number;
  locked?: boolean;
  hidden?: boolean;
  autoHeight?: boolean;
  minHeight?: number;
  z?: number;
}

export function createTextAnnotation(input: CreateTextAnnotationInput): TextAnnotation {
  const doc = input.doc ?? emptyTextDoc();
  const minHeight = input.minHeight ?? 0;
  return {
    kind: 'text',
    id: input.id ?? generateTextAnnotationId(),
    center: { x: input.center.x, y: input.center.y },
    width: input.width ?? DEFAULT_TEXT_BOX_WIDTH,
    height: input.height ?? Math.max(minHeight, DEFAULT_TEXT_FONT_SIZE * 1.4),
    rotation: input.rotation ?? 0,
    z: input.z ?? 0,
    opacity: input.opacity ?? 1,
    locked: input.locked ?? false,
    hidden: input.hidden ?? false,
    doc,
    plainText: input.plainText ?? serializedStateToPlainText(doc),
    fontSize: input.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
    autoHeight: input.autoHeight ?? true,
    minHeight,
  };
}

/**
 * Box geometry for a Text-tool drag, from the same four corners the marquee drew
 * (`tools/viewAlignedBox`), in perimeter order and crease-pattern model
 * coordinates.
 *
 * Taking the corners rather than the two drag points is what keeps the created
 * box identical to the rectangle the user saw: it inherits the marquee's
 * orientation instead of re-deriving one, so the two cannot drift. Under an
 * unrotated view this is exactly the old min/max box.
 *
 * Returns null when the drag is smaller than `minExtent` along both of the box's
 * own axes, so the caller can fall back to a click-created (auto-sizing) box.
 */
export function textBoxFromDragCorners(
  corners: readonly [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ],
  minExtent: number,
  rotation: number
): {
  center: { x: number; y: number };
  width: number;
  height: number;
  rotation: number;
} | null {
  const [c0, c1, c2] = corners;
  // Edge 1->2 is the box's screen-horizontal side, edge 0->1 its vertical one.
  // Only their *lengths* are used: the corners run press-to-cursor, so their
  // directions flip with the drag, and reading the angle off them would turn a
  // box dragged up-and-left upside down. The orientation comes from the caller's
  // view instead — the same `uprightRotationForView` every other canvas object
  // is created with, so all four kinds agree.
  const width = Math.hypot(c2.x - c1.x, c2.y - c1.y);
  const height = Math.hypot(c1.x - c0.x, c1.y - c0.y);
  if (width < minExtent && height < minExtent) return null;
  return {
    // Corners 0 and 2 are the drag's diagonal, so their midpoint is the centre
    // at any rotation.
    center: { x: (c0.x + c2.x) / 2, y: (c0.y + c2.y) / 2 },
    width: Math.max(width, minExtent),
    height: Math.max(height, minExtent),
    rotation,
  };
}

/** Validate an array of text annotations from `.osf`, dropping invalid entries. */
export function validateTextAnnotations(value: unknown): TextAnnotation[] {
  if (!Array.isArray(value)) return [];
  const out: TextAnnotation[] = [];
  for (const entry of value) {
    const text = validateTextAnnotation(entry);
    if (text) out.push(text);
  }
  return out;
}

/**
 * Defensively validate/normalize a text annotation read from `.osf`. Mirrors the
 * lenient `nativeProjectFile` style: an invalid entry returns null (dropped)
 * rather than throwing, so a malformed box never blocks opening a project.
 */
export function validateTextAnnotation(value: unknown): TextAnnotation | null {
  if (!isRecord(value) || value.kind !== 'text') return null;
  const center = validatePoint(value.center);
  if (!center) return null;
  const doc = isRecord(value.doc) && isRecord((value.doc as { root?: unknown }).root)
    ? (value.doc as unknown as SerializedEditorState)
    : null;
  if (!doc) return null;
  const width = positiveNumber(value.width);
  const height = positiveNumber(value.height);
  if (width === null || height === null) return null;
  return {
    kind: 'text',
    id: typeof value.id === 'string' && value.id.length > 0 ? value.id : generateTextAnnotationId(),
    center,
    width,
    height,
    rotation: finiteNumber(value.rotation) ?? 0,
    z: finiteNumber(value.z) ?? 0,
    opacity: clamp01(finiteNumber(value.opacity) ?? 1),
    locked: value.locked === true,
    hidden: value.hidden === true,
    doc,
    plainText:
      typeof value.plainText === 'string'
        ? value.plainText
        : serializedStateToPlainText(doc),
    fontSize: positiveNumber(value.fontSize) ?? DEFAULT_TEXT_FONT_SIZE,
    autoHeight: value.autoHeight !== false,
    minHeight: Math.max(0, finiteNumber(value.minHeight) ?? 0),
  };
}

function validatePoint(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value)) return null;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  return x === null || y === null ? null : { x, y };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveNumber(value: unknown): number | null {
  const n = finiteNumber(value);
  return n !== null && n > 0 ? n : null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
