import { useCallback, useEffect, useState, type FocusEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  KEY_ESCAPE_COMMAND,
  type EditorState,
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
import { HeadingNode } from '@lexical/rich-text';
import { Bold, Italic, Trash2, Underline } from 'lucide-react';
import { FloatingToolbar } from '../components/ui/FloatingToolbar';
import { registerTextEditor } from './annotations/textEditorRegistry';
import { isCanvasCompanionSurface } from './canvasObjects/canvasCompanionSurface';
import { resolveCpViewportCanvas } from './cpViewportCanvas';
import { useCanvasObjectAnchor } from './canvasObjects/useCanvasObjectAnchor';
import type { AnnotationBox } from './annotations/annotationTransform';
import { IconButton } from '../components/ui/IconButton';

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

export interface CpTextEditorProps {
  /** The box under edit, so the editor can register itself by id. */
  id: string;
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

export function CpTextEditor({
  id,
  doc,
  box,
  container,
  onChange,
  onExit,
  onDelete,
}: CpTextEditorProps) {
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
      // Keep editing when focus moves into the text toolbar, or into any other
      // surface that edits the selection (the Properties pane). One predicate
      // answers that for the focused-window blur too.
      if (isCanvasCompanionSurface(event.relatedTarget)) return;
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
      <RegisterEditorPlugin id={id} />
      <TextToolbar box={box} container={container} onDelete={onDelete} />
    </LexicalComposer>
  );
}

/** Lets the Properties pane reach this editor by the box's id — see `textEditorRegistry`. */
function RegisterEditorPlugin({ id }: { id: string }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => registerTextEditor(id, editor), [id, editor]);
  return null;
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
}

const INITIAL_TOOLBAR_STATE: ToolbarState = { bold: false, italic: false, underline: false };

/**
 * The editing toolbar: the per-selection marks and Delete. Everything that
 * applies to the whole box — alignment, block preset, colour, size — is a
 * property, in the Properties pane, which edits the live editor while the
 * box is open (see `useTextProperties`).
 */
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
        setState({
          bold: selection.hasFormat('bold'),
          italic: selection.hasFormat('italic'),
          underline: selection.hasFormat('underline'),
        });
      });
    });
  }, [editor]);

  // Marks fold into the single "edit text" undo entry recorded when the box
  // leaves edit mode, so they don't manage their own gesture boundaries.
  const toggleMark = useCallback(
    (mark: 'bold' | 'italic' | 'underline') => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, mark);
    },
    [editor]
  );

  return (
    <FloatingToolbar
      anchorRect={anchorRect}
      boundary={container}
      wheelTarget={resolveCpViewportCanvas}
      className="cp-text-toolbar"
      ariaLabel={t('panels:textAnnotation.textControls', 'Text controls')}
    >
      <div className="cp-text-toolbar__group">
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
