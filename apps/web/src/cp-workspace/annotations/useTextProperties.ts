import { useCallback, useMemo } from 'react';
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  SKIP_DOM_SELECTION_TAG,
  type ElementFormatType,
  type LexicalEditor,
  type SerializedEditorState,
} from 'lexical';
import { $createHeadingNode, type HeadingTagType } from '@lexical/rich-text';
import { $copyBlockFormatIndent, getCSSFromStyleObject, getStyleObjectFromCSS } from '@lexical/selection';
import type { PropertySheet } from '../../lib/propertyDescriptors';
import type { TargetOf } from '../canvasObjects/canvasObjectKinds';
import { serializedStateToPlainText } from './textAnnotation';
import { setDocAlign, setDocBlock, setDocColor } from './textDocTransforms';
import { useTextEditSession } from './textEditSession';
import { textEditorFor } from './textEditorRegistry';
import type { TextAlign, TextBlockType, TextColor } from './textFormatting';
import { buildTextProperties, type TextPropertyDeps } from './textProperties';
import { useAnnotationPaneDeps } from './useAnnotationPaneDeps';

/**
 * The text sheet, with the two write paths its whole-box fields need.
 *
 * **Idle** — the box is not being edited: a pure JSON transform on the stored
 * doc (`textDocTransforms`), recorded as one entry through the annotation
 * verb, the way any discrete property lands.
 *
 * **Editing** — the box's editor is live: the same change is made *in the
 * editor*, through the registry, with no bracket of its own. The session
 * holds the layer's bracket and records one 'Edit text' entry on exit;
 * `OnChangePlugin` writes the store as it does for a keystroke. A JSON
 * transform here would be overwritten by the editor's next update, and a
 * second bracket would double-record. The edit never touches the editor's
 * selection: blocks are re-created in place (a text node under the caret
 * moves with its block, and `replace` remaps a point on a replaced block),
 * styles are patched node by node, and the DOM selection is left alone so
 * the pane control keeps focus for the next click.
 */
export function useTextProperties(target: TargetOf<'text'>): PropertySheet {
  const deps = useAnnotationPaneDeps(target.id);
  const id = target.id;
  const editing = useTextEditSession()?.id === id;
  const doc = target.annotation.doc;
  const { t, commit } = deps;

  const idle = useCallback(
    (next: SerializedEditorState, label: string) =>
      commit({ doc: next, plainText: serializedStateToPlainText(next) }, label),
    [commit]
  );
  const live = useCallback(
    (edit: (editor: LexicalEditor) => void): boolean => {
      const editor = editing ? textEditorFor(id) : null;
      if (!editor) return false;
      editor.update(() => edit(editor), { tag: SKIP_DOM_SELECTION_TAG });
      return true;
    },
    [editing, id]
  );

  const setAlign = useCallback(
    (align: TextAlign) => {
      if (
        live(() => {
          for (const block of $getRoot().getChildren()) {
            if ($isElementNode(block)) block.setFormat(align as ElementFormatType);
          }
        })
      ) {
        return;
      }
      idle(setDocAlign(doc, align), t('panels:cpProperties.text.changeAlignment', 'Change text alignment'));
    },
    [live, idle, doc, t]
  );

  const setBlock = useCallback(
    (type: TextBlockType) => {
      if (
        live(() => {
          // `$setBlocksType` per block without a select-all, so the caret's
          // node moves with its block and the selection needs no restoring.
          for (const block of $getRoot().getChildren()) {
            if (!$isElementNode(block)) continue;
            const element =
              type === 'paragraph'
                ? $createParagraphNode()
                : $createHeadingNode(type as HeadingTagType);
            $copyBlockFormatIndent(block, element);
            block.replace(element, true);
          }
        })
      ) {
        return;
      }
      idle(setDocBlock(doc, type), t('panels:cpProperties.text.changeStyle', 'Change text style'));
    },
    [live, idle, doc, t]
  );

  const setColor = useCallback(
    (color: TextColor) => {
      if (
        live(() => {
          const patch = (css: string): string => {
            const styles = getStyleObjectFromCSS(css);
            if (color) styles.color = color;
            else delete styles.color;
            return getCSSFromStyleObject(styles);
          };
          for (const block of $getRoot().getChildren()) {
            if (!$isElementNode(block)) continue;
            let hasText = false;
            for (const node of block.getChildren()) {
              if ($isTextNode(node)) {
                hasText = true;
                node.setStyle(patch(node.getStyle()));
              }
            }
            if (!hasText) block.setTextStyle(patch(block.getTextStyle()));
          }
          // A collapsed caret carries its own style for what is typed next.
          const selection = $getSelection();
          if ($isRangeSelection(selection) && selection.isCollapsed()) {
            selection.setStyle(patch(selection.style));
          }
        })
      ) {
        return;
      }
      idle(setDocColor(doc, color), t('panels:cpProperties.text.changeColor', 'Change text color'));
    },
    [live, idle, doc, t]
  );

  const textDeps = useMemo<TextPropertyDeps>(
    () => ({ ...deps, setAlign, setBlock, setColor }),
    [deps, setAlign, setBlock, setColor]
  );
  return useMemo(() => buildTextProperties(target, textDeps), [target, textDeps]);
}
