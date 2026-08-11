import { useCallback, useEffect, useState, type FocusEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  COMMAND_PRIORITY_HIGH,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  KEY_ESCAPE_COMMAND,
  type EditorState,
  type ElementFormatType,
  type SerializedEditorState,
} from 'lexical';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createHeadingNode,
  $isHeadingNode,
  HeadingNode,
  type HeadingTagType,
} from '@lexical/rich-text';
import { $setBlocksType, $patchStyleText } from '@lexical/selection';
import { $createParagraphNode } from 'lexical';
import { Bold, Italic, Trash2, Underline } from 'lucide-react';
import { FloatingToolbar } from '../components/ui/FloatingToolbar';
import { resolveCpViewportCanvas } from './cpViewportCanvas';
import { useCanvasObjectAnchor } from './canvasObjects/useCanvasObjectAnchor';
import type { AnnotationBox } from './annotations/annotationTransform';
import { IconButton } from '../components/ui/IconButton';
import { TEXT_BLOCK_PRESETS, type TextAlign, type TextBlockType } from './annotations/textFormatting';

const LEXICAL_THEME = {
  paragraph: 'cp-text-view__block',
  heading: { h1: 'cp-text-view__h1', h2: 'cp-text-view__h2' },
  text: {
    bold: 'cp-rt-bold',
    italic: 'cp-rt-italic',
    underline: 'cp-rt-underline',
    strikethrough: 'cp-rt-strikethrough',
    underlineStrikethrough: 'cp-rt-underline cp-rt-strikethrough',
  },
};

/** Swatches offered by the color control (English labels localized at call site). */
const TEXT_COLORS = [
  { value: '', label: 'Default' },
  { value: '#e5484d', label: 'Red' },
  { value: '#f5a623', label: 'Orange' },
  { value: '#30a46c', label: 'Green' },
  { value: '#4c9aff', label: 'Blue' },
  { value: '#8e4ec6', label: 'Purple' },
];

export interface CpTextEditorProps {
  doc: SerializedEditorState;
  /** The edited box, so the toolbar can anchor to it. */
  box: AnnotationBox;
  /** Element the canvas is positioned against. */
  container: HTMLElement | null;
  /** Content changed: persist the new doc + its plain-text projection. */
  onChange: (doc: SerializedEditorState, plainText: string) => void;
  /**
   * Leave inline-edit mode. `'blur'` = a click outside committed the edit (that
   * same click must not also spawn a new box); `'escape'` = keyboard exit.
   */
  onExit: (reason: 'blur' | 'escape') => void;
  onDelete: () => void;
}

export function CpTextEditor({ doc, box, container, onChange, onExit, onDelete }: CpTextEditorProps) {
  const { t } = useTranslation();
  const handleChange = useCallback(
    (editorState: EditorState) => {
      const json = editorState.toJSON();
      const plain = editorState.read(() => $getRoot().getTextContent());
      onChange(json, plain);
    },
    [onChange]
  );

  const handleBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      // Keep editing when focus moves into the text toolbar (buttons/selects).
      const next = event.relatedTarget as HTMLElement | null;
      if (next && next.closest('[data-cp-text-toolbar]')) return;
      onExit('blur');
    },
    [onExit]
  );

  const handleEscape = useCallback(() => onExit('escape'), [onExit]);

  return (
    <LexicalComposer
      initialConfig={{
        namespace: 'cp-text',
        editable: true,
        nodes: [HeadingNode],
        editorState: JSON.stringify(doc),
        theme: LEXICAL_THEME,
        onError: (error) => console.error('[cp-text] lexical error', error),
      }}
    >
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            className="cp-text-editor__content ph-no-capture"
            onBlur={handleBlur}
          />
        }
        placeholder={
          <div className="cp-text-editor__placeholder">
            {t('panels:textAnnotation.placeholder', 'Type…')}
          </div>
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <AutoFocusPlugin />
      <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
      <EscapeExitPlugin onEscape={handleEscape} />
      <TextToolbar box={box} container={container} onDelete={onDelete} />
    </LexicalComposer>
  );
}

/**
 * Routes Escape to {@link CpTextEditorProps.onExit} as a keyboard exit.
 *
 * It has to be a Lexical command rather than a `keydown` prop on the
 * contenteditable: `@lexical/rich-text` answers `KEY_ESCAPE_COMMAND` by blurring
 * the editor, and that blur beats React's delegated listener — so Escape would
 * otherwise arrive as a click-away commit, taking the caller's focus handling
 * and click-suppression down the wrong branch. Claiming the command first keeps
 * the editor focused until the caller decides what to do.
 */
function EscapeExitPlugin({ onEscape }: { onEscape: () => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          onEscape();
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
    [editor, onEscape]
  );
  return null;
}

interface ToolbarState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  block: TextBlockType;
  align: TextAlign;
  color: string;
}

const INITIAL_TOOLBAR_STATE: ToolbarState = {
  bold: false,
  italic: false,
  underline: false,
  block: 'paragraph',
  align: 'left',
  color: '',
};

function TextToolbar({
  box,
  container,
  onDelete,
}: {
  /** The edited box, so the toolbar can anchor to it. */
  box: AnnotationBox;
  /** Element the canvas is positioned against. */
  container: HTMLElement | null;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [editor] = useLexicalComposerContext();
  // Subscribed here, not in the panel — see CpImageInspector.
  const anchorRect = useCanvasObjectAnchor(box, 'model', container);
  const [state, setState] = useState<ToolbarState>(INITIAL_TOOLBAR_STATE);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const anchorNode = selection.anchor.getNode();
        const block = anchorNode.getKey() === 'root'
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();
        let blockType: TextBlockType = 'paragraph';
        if ($isHeadingNode(block)) blockType = block.getTag() === 'h2' ? 'h2' : 'h1';
        const format = $isElementNode(block) ? block.getFormatType() : 'left';
        const align: TextAlign =
          format === 'center' ? 'center' : format === 'right' || format === 'end' ? 'right' : 'left';
        setState({
          bold: selection.hasFormat('bold'),
          italic: selection.hasFormat('italic'),
          underline: selection.hasFormat('underline'),
          block: blockType,
          align,
          color: selection.style.match(/color:\s*([^;]+)/)?.[1]?.trim() ?? '',
        });
      });
    });
  }, [editor]);

  // Formatting changes fold into the single "edit text" undo entry recorded when
  // the box leaves edit mode, so they don't manage their own gesture boundaries.
  const setBlock = useCallback(
    (type: TextBlockType) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        $setBlocksType(selection, () =>
          type === 'paragraph' ? $createParagraphNode() : $createHeadingNode(type as HeadingTagType)
        );
      });
    },
    [editor]
  );

  const setAlign = useCallback(
    (align: TextAlign) => {
      editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, align as ElementFormatType);
    },
    [editor]
  );

  const setColor = useCallback(
    (color: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) $patchStyleText(selection, { color: color || null });
      });
    },
    [editor]
  );

  const toggleMark = useCallback(
    (mark: 'bold' | 'italic' | 'underline') => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, mark);
    },
    [editor]
  );

  return (
    <FloatingToolbar
      anchorRect={anchorRect}
      wheelTarget={resolveCpViewportCanvas}
      className="cp-text-toolbar"
      ariaLabel={t('panels:textAnnotation.textControls', 'Text controls')}
    >
      <div data-cp-text-toolbar className="cp-text-toolbar__group">
        <select
          className="cp-text-toolbar__select"
          value={state.block}
          onChange={(event) => setBlock(event.target.value as TextBlockType)}
          title={t('panels:textAnnotation.textStyle', 'Text style')}
          aria-label={t('panels:textAnnotation.textStyle', 'Text style')}
        >
          {TEXT_BLOCK_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.value === 'paragraph'
                ? t('panels:textAnnotation.blockBody', 'Body')
                : preset.value === 'h1'
                  ? t('panels:textAnnotation.blockHeading', 'Heading')
                  : t('panels:textAnnotation.blockSubheading', 'Subheading')}
            </option>
          ))}
        </select>
        <span className="floating-toolbar__separator" />
        <IconButton
          size="sm"
          variant="toolbar"
          isActive={state.bold}
          title={t('panels:textAnnotation.bold', 'Bold')}
          onClick={() => toggleMark('bold')}
        >
          <Bold size={14} />
        </IconButton>
        <IconButton
          size="sm"
          variant="toolbar"
          isActive={state.italic}
          title={t('panels:textAnnotation.italic', 'Italic')}
          onClick={() => toggleMark('italic')}
        >
          <Italic size={14} />
        </IconButton>
        <IconButton
          size="sm"
          variant="toolbar"
          isActive={state.underline}
          title={t('panels:textAnnotation.underline', 'Underline')}
          onClick={() => toggleMark('underline')}
        >
          <Underline size={14} />
        </IconButton>
        <span className="floating-toolbar__separator" />
        <div className="cp-text-toolbar__align" role="group" aria-label={t('panels:textAnnotation.alignment', 'Alignment')}>
          {(['left', 'center', 'right'] as const).map((align) => (
            <button
              key={align}
              type="button"
              className="cp-text-toolbar__align-btn"
              data-active={state.align === align || undefined}
              title={
                align === 'left'
                  ? t('panels:textAnnotation.alignLeft', 'Align left')
                  : align === 'center'
                    ? t('panels:textAnnotation.alignCenter', 'Align center')
                    : t('panels:textAnnotation.alignRight', 'Align right')
              }
              onClick={() => setAlign(align)}
            >
              <AlignGlyph align={align} />
            </button>
          ))}
        </div>
        <span className="floating-toolbar__separator" />
        <label className="cp-text-toolbar__color" title={t('panels:textAnnotation.color', 'Text color')}>
          <select
            className="cp-text-toolbar__color-select"
            value={state.color}
            onChange={(event) => setColor(event.target.value)}
            aria-label={t('panels:textAnnotation.color', 'Text color')}
          >
            {TEXT_COLORS.map((color) => (
              <option key={color.value || 'default'} value={color.value}>
                {color.label}
              </option>
            ))}
          </select>
        </label>
        <span className="floating-toolbar__separator" />
        <IconButton
          size="sm"
          variant="toolbar"
          title={t('panels:textAnnotation.deleteText', 'Delete text')}
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </IconButton>
      </div>
    </FloatingToolbar>
  );
}

function AlignGlyph({ align }: { align: TextAlign }) {
  const lines =
    align === 'left'
      ? ['M2 3h12', 'M2 6h8', 'M2 9h12', 'M2 12h8']
      : align === 'center'
        ? ['M2 3h12', 'M4 6h8', 'M2 9h12', 'M4 12h8']
        : ['M2 3h12', 'M6 6h8', 'M2 9h12', 'M6 12h8'];
  return (
    <svg width="14" height="14" viewBox="0 0 16 15" aria-hidden="true">
      {lines.map((d, i) => (
        <path key={i} d={d} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      ))}
    </svg>
  );
}
