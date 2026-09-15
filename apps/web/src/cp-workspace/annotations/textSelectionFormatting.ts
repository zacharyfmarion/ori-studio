import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  FORMAT_ELEMENT_COMMAND,
  type ElementFormatType,
  type LexicalEditor,
} from 'lexical';
import { $createHeadingNode, $isHeadingNode, type HeadingTagType } from '@lexical/rich-text';
import { $getSelectionStyleValueForProperty, $patchStyleText, $setBlocksType } from '@lexical/selection';
import { normalizeTextAlign, type TextAlign, type TextBlockType } from './textFormatting';

/**
 * Formatting of the editor's *current selection*: what it carries, and the
 * per-selection edits the editing toolbar makes. The whole-box counterparts —
 * every block, every text node, no selection involved — are
 * `textDocTransforms` (idle) and `useTextProperties` (live).
 *
 * Each write is the editor's own idiom for that change (`$setBlocksType`,
 * `FORMAT_ELEMENT_COMMAND`, `$patchStyleText`), so a keyboard shortcut and
 * the toolbar produce the same document. None opens a bracket: the session
 * records one 'Edit text' entry on exit, and these fold into it like a
 * keystroke.
 */
export interface TextSelectionFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** The block under the anchor. */
  block: TextBlockType;
  /** The block under the anchor. */
  align: TextAlign;
  /** `''` is the default, and also what a selection of mixed colours reads as. */
  color: string;
}

/** What the range selection carries, or `null` outside one. Call inside a read or update. */
export function $readSelectionFormat(): TextSelectionFormat | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const anchorNode = selection.anchor.getNode();
  const block = anchorNode.getKey() === 'root' ? anchorNode : anchorNode.getTopLevelElementOrThrow();
  return {
    bold: selection.hasFormat('bold'),
    italic: selection.hasFormat('italic'),
    underline: selection.hasFormat('underline'),
    block: $isHeadingNode(block) ? (block.getTag() === 'h2' ? 'h2' : 'h1') : 'paragraph',
    align: normalizeTextAlign($isElementNode(block) ? block.getFormatType() : 'left'),
    color: $getSelectionStyleValueForProperty(selection, 'color', ''),
  };
}

/** Re-create every block the selection touches as `type`. */
export function setSelectionBlock(editor: LexicalEditor, type: TextBlockType): void {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    $setBlocksType(selection, () =>
      type === 'paragraph' ? $createParagraphNode() : $createHeadingNode(type as HeadingTagType)
    );
  });
}

/** Align every block the selection touches. */
export function setSelectionAlign(editor: LexicalEditor, align: TextAlign): void {
  editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, align as ElementFormatType);
}

/** Colour the selected text; `''` clears to the default. A collapsed caret takes it for what is typed next. */
export function setSelectionColor(editor: LexicalEditor, color: string): void {
  editor.update(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) $patchStyleText(selection, { color: color || null });
  });
}
