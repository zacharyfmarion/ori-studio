import { useCallback, useEffect, useState, type FocusEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  $getRoot,
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
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Trash2,
  Underline,
  type LucideIcon,
} from 'lucide-react';
import { FloatingToolbar } from '../components/ui/FloatingToolbar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/Select';
import { textAlignLabel, textBlockLabel, textColorLabel } from '../i18n/enumLabels';
import { registerTextEditor } from './annotations/textEditorRegistry';
import {
  TEXT_ALIGNS,
  TEXT_BLOCK_PRESETS,
  TEXT_COLORS,
  type TextAlign,
  type TextBlockType,
} from './annotations/textFormatting';
import {
  $readSelectionFormat,
  setSelectionAlign,
  setSelectionBlock,
  setSelectionColor,
  type TextSelectionFormat,
} from './annotations/textSelectionFormatting';
import {
  CANVAS_COMPANION_PROPS,
  isCanvasCompanionSurface,
} from './canvasObjects/canvasCompanionSurface';
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

const INITIAL_TOOLBAR_STATE: TextSelectionFormat = {
  bold: false,
  italic: false,
  underline: false,
  block: 'paragraph',
  align: 'left',
  color: '',
};

const ALIGN_ICONS: Record<TextAlign, LucideIcon> = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
};

/**
 * The editing toolbar, per *selection*: block preset, marks, alignment,
 * colour, and Delete. The same properties on the Properties pane apply to
 * the whole box (see `useTextProperties`); here they follow the caret, the
 * way a rich-text toolbar does, so one heading line or one red word is
 * reachable without leaving the box.
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
  const [state, setState] = useState<TextSelectionFormat>(INITIAL_TOOLBAR_STATE);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const format = $readSelectionFormat();
        if (format) setState(format);
      });
    });
  }, [editor]);

  // Every edit here folds into the single "edit text" undo entry recorded
  // when the box leaves edit mode, so none manages its own gesture boundary.
  const toggleMark = useCallback(
    (mark: 'bold' | 'italic' | 'underline') => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, mark);
    },
    [editor]
  );
  // A list that closed puts focus on its trigger; the caret wants it back, so
  // the next keystroke lands in the text rather than on the toolbar.
  const refocusEditor = useCallback(
    (event: Event) => {
      event.preventDefault();
      editor.focus();
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
        <Select value={state.block} onValueChange={(value) => setSelectionBlock(editor, value as TextBlockType)}>
          <SelectTrigger
            className="cp-text-toolbar__select"
            aria-label={t('panels:textAnnotation.textStyle', 'Text style')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent {...CANVAS_COMPANION_PROPS} onCloseAutoFocus={refocusEditor}>
            {TEXT_BLOCK_PRESETS.map((preset) => (
              <SelectItem key={preset.value} value={preset.value}>
                {textBlockLabel(t, preset.value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        {TEXT_ALIGNS.map((align) => {
          const Icon = ALIGN_ICONS[align];
          return (
            <IconButton
              key={align}
              size="sm"
              variant="toolbar"
              isActive={state.align === align}
              title={textAlignLabel(t, align)}
              onClick={() => setSelectionAlign(editor, align)}
            >
              <Icon size={14} />
            </IconButton>
          );
        })}
        <span className="floating-toolbar__separator" />
        {/* Radix reserves `''` for "nothing chosen", so the default colour
            travels as `'default'` — the pane's select spells it the same way —
            and a colour outside the six shows as nothing chosen. */}
        <Select
          value={
            (TEXT_COLORS as readonly string[]).includes(state.color) ? state.color || 'default' : ''
          }
          onValueChange={(value) => setSelectionColor(editor, value === 'default' ? '' : value)}
        >
          <SelectTrigger
            className="cp-text-toolbar__select"
            aria-label={t('panels:textAnnotation.color', 'Text color')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent {...CANVAS_COMPANION_PROPS} onCloseAutoFocus={refocusEditor}>
            {TEXT_COLORS.map((color) => (
              <SelectItem key={color || 'default'} value={color || 'default'}>
                {color && (
                  <span className="select-swatch" style={{ background: color }} aria-hidden="true" />
                )}
                {textColorLabel(t, color)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
