import type { SerializedEditorState, SerializedLexicalNode } from 'lexical';
import { normalizeTextAlign, type TextAlign, type TextBlockType } from './textFormatting';

/**
 * Whole-box edits to a text annotation's stored document, as pure JSON
 * transforms — for a box that is *not* being edited, where there is no live
 * editor to drive and a Lexical instance for one alignment change would be
 * the expensive way to flip a string.
 *
 * Each transform mirrors what the editor would do to the same document —
 * `setFormat` on every top-level block, `$setBlocksType` over a select-all,
 * `$patchStyleText` over a select-all — closely enough that the headless
 * twin in `textDocTransforms.test.ts` produces a deep-equal state. That test
 * is what keeps a Lexical upgrade from silently forking the two shapes.
 * Every transform returns a new object; the input is never mutated.
 *
 * `textAnnotation.ts` stays a leaf module; this is a sibling that knows the
 * serialized shape one level deeper (block `type`/`tag`/`format`, text-node
 * `style`) and nothing about the store.
 */

/** A top-level block as Lexical serializes it: a paragraph or a heading. */
interface SerializedBlock extends SerializedLexicalNode {
  type: string;
  tag?: string;
  format?: string | number;
  indent?: number;
  direction?: 'ltr' | 'rtl' | null;
  children?: SerializedInline[];
  textFormat?: number;
  textStyle?: string;
}

interface SerializedInline extends SerializedLexicalNode {
  type: string;
  text?: string;
  format?: number;
  style?: string;
  children?: SerializedInline[];
}

interface SerializedRoot extends SerializedLexicalNode {
  children: SerializedBlock[];
}

function rootOf(doc: SerializedEditorState): SerializedRoot {
  return doc.root as unknown as SerializedRoot;
}

function withRootChildren(doc: SerializedEditorState, children: SerializedBlock[]): SerializedEditorState {
  return { ...doc, root: { ...rootOf(doc), children } } as unknown as SerializedEditorState;
}

function blockType(block: SerializedBlock): TextBlockType {
  if (block.type === 'heading') return block.tag === 'h2' ? 'h2' : 'h1';
  return 'paragraph';
}

/** The text nodes under a block, in order, through any inline wrapper. */
function textNodesOf(nodes: readonly SerializedInline[] | undefined): SerializedInline[] {
  const out: SerializedInline[] = [];
  for (const node of nodes ?? []) {
    if (node.type === 'text') out.push(node);
    else if (node.children) out.push(...textNodesOf(node.children));
  }
  return out;
}

/** `getStyleObjectFromCSS` / `getCSSFromStyleObject`, as `@lexical/selection` spells them. */
function styleObject(css: string | undefined): Record<string, string> {
  const styles: Record<string, string> = {};
  for (const declaration of (css ?? '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;
    const key = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    if (key) styles[key] = value;
  }
  return styles;
}

function styleCss(styles: Record<string, string>): string {
  let css = '';
  for (const key of Object.keys(styles)) {
    if (key) css += `${key}: ${styles[key]};`;
  }
  return css;
}

function colorOf(css: string | undefined): string {
  return styleObject(css).color ?? '';
}

function patchedColor(css: string | undefined, color: string): string {
  const styles = styleObject(css);
  if (color) styles.color = color;
  else delete styles.color;
  return styleCss(styles);
}

/**
 * A block as Lexical serializes it: a paragraph always carries `textFormat`
 * and `textStyle` (from its first text node, else its own), a heading only
 * when it has no text and they are not the defaults. A document written by
 * an older build, or by `textDocFromPlainText`, may lack them; every
 * transform writes the full shape so its output is what the editor's own
 * `toJSON` gives for the same state.
 */
function normalizedBlock(block: SerializedBlock): SerializedBlock {
  const first = textNodesOf(block.children)[0];
  if (block.type === 'paragraph') {
    return {
      ...block,
      textFormat: first ? (first.format ?? 0) : (block.textFormat ?? 0),
      textStyle: first ? (first.style ?? '') : (block.textStyle ?? ''),
    };
  }
  const next: SerializedBlock = { ...block };
  if (first || !next.textFormat) delete next.textFormat;
  if (first || !next.textStyle) delete next.textStyle;
  return next;
}

/** One answer, or `null` when the blocks disagree — the mixed state a control shows as nothing chosen. */
function uniform<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null;
  const [first, ...rest] = values;
  return rest.every((value) => value === first) ? (first as T) : null;
}

export interface TextDocSummary {
  align: TextAlign | null;
  block: TextBlockType | null;
  /** `''` is the default colour; `null` is mixed. */
  color: string | null;
}

/** What the whole box currently is, per property, or `null` where its blocks disagree. */
export function textDocSummary(doc: SerializedEditorState): TextDocSummary {
  const blocks = rootOf(doc).children;
  const texts = blocks.flatMap((block) => textNodesOf(block.children));
  // An empty block has no text to carry a colour; its own `textStyle` says
  // what the next typed character gets, which is what a reader sees as "the
  // colour of this box".
  const colors =
    texts.length > 0
      ? texts.map((node) => colorOf(node.style))
      : blocks.map((block) => colorOf(block.textStyle));
  return {
    align: blocks.length === 0 ? 'left' : uniform(blocks.map((block) => normalizeTextAlign(block.format))),
    block: blocks.length === 0 ? 'paragraph' : uniform(blocks.map(blockType)),
    color: blocks.length === 0 ? '' : uniform(colors),
  };
}

/** Every top-level block aligned `align` — `element.setFormat(align)` on each. */
export function setDocAlign(doc: SerializedEditorState, align: TextAlign): SerializedEditorState {
  return withRootChildren(
    doc,
    rootOf(doc).children.map((block) => normalizedBlock({ ...block, format: align }))
  );
}

/**
 * Every top-level block re-created as `type`, the way `$setBlocksType` over a
 * select-all does it: a fresh node of the new type, `format` and `indent`
 * copied from the old one (`$copyBlockFormatIndent`), the children moved
 * across. `direction` is copied too — the editor's reconciler would settle a
 * fresh node on the text's direction, which is what the old block already
 * held. A paragraph carries `textFormat`/`textStyle` from its first text node,
 * as Lexical serializes one; a heading carries neither.
 */
export function setDocBlock(doc: SerializedEditorState, type: TextBlockType): SerializedEditorState {
  return withRootChildren(
    doc,
    rootOf(doc).children.map((block): SerializedBlock => {
      const children = block.children ?? [];
      const base = {
        children,
        direction: block.direction ?? null,
        format: block.format ?? '',
        indent: block.indent ?? 0,
        version: 1,
      };
      return normalizedBlock(
        type === 'paragraph' ? { ...base, type: 'paragraph' } : { ...base, type: 'heading', tag: type }
      );
    })
  );
}

/**
 * Every text node's `color` set (or cleared, for `''`), as `$patchStyleText`
 * over a select-all does it — including an empty block's `textStyle`, which
 * is what the next typed character takes.
 */
export function setDocColor(doc: SerializedEditorState, color: string): SerializedEditorState {
  const patchInline = (node: SerializedInline): SerializedInline =>
    node.type === 'text'
      ? { ...node, style: patchedColor(node.style, color) }
      : node.children
        ? { ...node, children: node.children.map(patchInline) }
        : node;
  return withRootChildren(
    doc,
    rootOf(doc).children.map((block): SerializedBlock => {
      const children = (block.children ?? []).map(patchInline);
      // An empty block takes the colour on its own text style, so the next
      // typed character gets it; a block with text reads it from its first
      // node, in `normalizedBlock`.
      const empty = textNodesOf(children).length === 0;
      return normalizedBlock({
        ...block,
        children,
        ...(empty ? { textStyle: patchedColor(block.textStyle, color) } : {}),
      });
    })
  );
}
