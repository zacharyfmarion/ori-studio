import { Fragment, memo, type CSSProperties, type ReactNode } from 'react';
import type { SerializedEditorState } from 'lexical';
import { decodeInlineMarks, normalizeTextAlign, type TextAlign } from './annotations/textFormatting';

/**
 * A pure, read-only renderer for a Lexical {@link SerializedEditorState}. It
 * walks the serialized JSON directly (no Lexical runtime) and emits styled React
 * nodes for the marks text annotations support: bold/italic/underline/
 * strikethrough, per-run color, block/text-type (paragraph/heading), and
 * alignment. Used to draw text boxes that aren't being edited — the live editor
 * only mounts for the one box under edit.
 */

interface SerializedNode {
  type?: string;
  tag?: string;
  text?: string;
  format?: number | string;
  style?: string;
  children?: SerializedNode[];
}

function parseStyle(style: string | undefined): CSSProperties | undefined {
  if (!style) return undefined;
  const out: Record<string, string> = {};
  for (const decl of style.split(';')) {
    const idx = decl.indexOf(':');
    if (idx <= 0) continue;
    const prop = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (prop === 'color') out.color = value;
  }
  return Object.keys(out).length ? (out as CSSProperties) : undefined;
}

function renderInline(node: SerializedNode, key: number): ReactNode {
  if (node.type === 'linebreak') return <br key={key} />;
  if (typeof node.text === 'string') {
    const marks = decodeInlineMarks(typeof node.format === 'number' ? node.format : 0);
    const style: CSSProperties = { ...parseStyle(node.style) };
    if (marks.bold) style.fontWeight = 700;
    if (marks.italic) style.fontStyle = 'italic';
    const decorations: string[] = [];
    if (marks.underline) decorations.push('underline');
    if (marks.strikethrough) decorations.push('line-through');
    if (decorations.length) style.textDecoration = decorations.join(' ');
    return (
      <span key={key} style={style}>
        {node.text}
      </span>
    );
  }
  if (Array.isArray(node.children)) {
    return <Fragment key={key}>{node.children.map((child, i) => renderInline(child, i))}</Fragment>;
  }
  return null;
}

function renderBlock(node: SerializedNode, key: number): ReactNode {
  const align: TextAlign = normalizeTextAlign(node.format);
  const style: CSSProperties = { textAlign: align, margin: 0 };
  const children = Array.isArray(node.children)
    ? node.children.map((child, i) => renderInline(child, i))
    : null;
  const content = children && children.length ? children : <br />;
  if (node.type === 'heading') {
    const Tag = (node.tag === 'h2' ? 'h2' : 'h1') as 'h1' | 'h2';
    return (
      <Tag key={key} className={`cp-text-view__block cp-text-view__${node.tag ?? 'h1'}`} style={style}>
        {content}
      </Tag>
    );
  }
  return (
    <p key={key} className="cp-text-view__block" style={style}>
      {content}
    </p>
  );
}

// Memoized: the text layer re-renders every camera frame to reposition boxes, but
// the rich content only changes on edit — skip re-reconciling it when the doc ref
// is unchanged (the box's `style` still updates for the new font size/position).
export const CpTextView = memo(function CpTextView({
  state,
}: {
  state: SerializedEditorState;
}) {
  const root = (state as unknown as { root?: SerializedNode }).root;
  const blocks = Array.isArray(root?.children) ? root.children : [];
  return <>{blocks.map((block, i) => renderBlock(block, i))}</>;
});
