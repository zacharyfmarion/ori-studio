import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { textCoordinate } from '../lib/creasePatternViewport';
import type { OristudioCpTextElement } from '../engine/oristudioCpTypes';
import type { CpOverlayView } from './CreasePatternWebglCanvas';

/**
 * DOM overlay for crease-pattern text annotations on the WebGL surface. Text is
 * low-count and CSS-styled, so it rides a DOM layer over the canvas rather than the
 * GPU (no glyph atlas needed). Each label projects its model position through the
 * camera's reported {@link CpOverlayView} and scales its font with zoom (the SVG's
 * 12px is in user space; `zoomPercent` is the user→CSS scale, so 100% ⇒ 12 CSS px).
 *
 * The container is click-through; individual labels are clickable only when the
 * current tool allows entity selection, so clicks fall through to draw tools.
 *
 * When the Text tool is active this layer also owns the inline editor: clicking a
 * label (or an empty-canvas point relayed as {@link createDraftAt}) opens a
 * `<textarea>` at the anchor. Keystrokes mutate a local draft only; the draft is
 * committed to the engine on blur / ESC / tool change / switching texts (mirroring
 * Oriedita's `record()`-on-commit granularity — one edit session = one undo entry).
 * A blank draft is dropped (new text is never created; an existing text emptied out
 * is deleted), matching Oriedita's blank-text GC.
 */
const BASE_FONT_PX = 12;

interface Point {
  x: number;
  y: number;
}

/**
 * An in-progress inline edit. `textId === null` is a create draft (no model element
 * exists yet — it is only materialised on commit if non-blank); otherwise it edits
 * the existing text with that 1-based id.
 */
interface EditSession {
  textId: number | null;
  anchor: Point;
  draft: string;
}

function projectAnchor(view: CpOverlayView, anchor: Point): { left: number; top: number } {
  return {
    left: view.origin[0] + anchor.x * view.ex[0] + anchor.y * view.ey[0],
    top: view.origin[1] + anchor.x * view.ex[1] + anchor.y * view.ey[1],
  };
}

export const CpTextOverlay = memo(function CpTextOverlay({
  texts,
  selectedTextIds,
  view,
  zoomPercent,
  selectable,
  textToolActive = false,
  createDraftAt = null,
  onCreateDraftConsumed,
  onToggleText,
  onSelectText,
  onCreateText,
  onSetTextContent,
  onDeleteText,
}: {
  texts: readonly OristudioCpTextElement[];
  selectedTextIds: readonly number[];
  view: CpOverlayView;
  zoomPercent: number;
  selectable: boolean;
  /** Text tool is active: labels open the inline editor and show an editing cursor. */
  textToolActive?: boolean;
  /** Model point of an empty-canvas click relayed from the canvas — opens a create draft. */
  createDraftAt?: Point | null;
  /** Called after a `createDraftAt` signal has been consumed so the panel can clear it. */
  onCreateDraftConsumed?: () => void;
  /** Plain (non-Text-tool) selection toggle. */
  onToggleText: (id: number, additive?: boolean) => void;
  /** Single-select a text (used when opening its inline editor under the Text tool). */
  onSelectText?: (id: number) => void;
  /** Commit a new text: append at `anchor` with `text` (non-blank). */
  onCreateText?: (anchor: Point, text: string) => void;
  /** Commit an edit to an existing text's content. */
  onSetTextContent?: (id: number, text: string) => void;
  /** Delete an existing text (its content was emptied out). */
  onDeleteText?: (id: number) => void;
}) {
  const selectedSet = useMemo(() => new Set(selectedTextIds), [selectedTextIds]);
  const fontPx = Math.max(1, BASE_FONT_PX * (zoomPercent / 100));

  const [session, setSession] = useState<EditSession | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Latest props the commit closure needs, without making commit itself churn.
  const commitDepsRef = useRef({ texts, onCreateText, onSetTextContent, onDeleteText });
  commitDepsRef.current = { texts, onCreateText, onSetTextContent, onDeleteText };

  const commitSession = useCallback((toCommit: EditSession | null) => {
    if (!toCommit) return;
    const { texts: liveTexts, onCreateText: create, onSetTextContent: setContent, onDeleteText: del } =
      commitDepsRef.current;
    const blank = toCommit.draft.trim().length === 0;
    if (toCommit.textId === null) {
      // New text: materialise only if the user typed something.
      if (!blank) create?.(toCommit.anchor, toCommit.draft);
    } else {
      const original = liveTexts[toCommit.textId - 1]?.text ?? '';
      if (toCommit.draft !== original) {
        if (blank) del?.(toCommit.textId);
        else setContent?.(toCommit.textId, toCommit.draft);
      }
    }
  }, []);

  // Open a create draft when the canvas relays an empty-space click. Commit any
  // in-progress session first, then start fresh at the new point.
  useEffect(() => {
    if (!createDraftAt) return;
    setSession((current) => {
      commitSession(current);
      return { textId: null, anchor: { x: createDraftAt.x, y: createDraftAt.y }, draft: '' };
    });
    onCreateDraftConsumed?.();
  }, [createDraftAt, commitSession, onCreateDraftConsumed]);

  // Leaving the Text tool commits the open session (parity with Oriedita hiding the
  // editor + firing record() when the mouse mode changes away from TEXT).
  useEffect(() => {
    if (textToolActive) return;
    setSession((current) => {
      commitSession(current);
      return null;
    });
  }, [textToolActive, commitSession]);

  // A stable identity for the edited target: changes when the session opens or
  // switches texts/anchor, but NOT as the draft is typed — so focus is placed once
  // per session and typing never steals the caret back to the end.
  const editorKey = session
    ? `${session.textId ?? 'new'}:${session.anchor.x}:${session.anchor.y}`
    : '';

  // Focus the editor when a session opens (and place the caret at the end).
  useEffect(() => {
    if (!editorKey) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [editorKey]);

  const startEditSession = useCallback(
    (id: number) => {
      const text = texts[id - 1];
      if (!text) return;
      setSession((current) => {
        commitSession(current);
        return {
          textId: id,
          anchor: { x: textCoordinate(text.x), y: textCoordinate(text.y) },
          draft: text.text,
        };
      });
      onSelectText?.(id);
    },
    [texts, commitSession, onSelectText]
  );

  const handleLabelClick = useCallback(
    (id: number, event: MouseEvent<HTMLSpanElement>) => {
      event.stopPropagation();
      if (textToolActive) {
        startEditSession(id);
      } else {
        onToggleText(id, event.shiftKey || event.metaKey || event.ctrlKey);
      }
    },
    [textToolActive, startEditSession, onToggleText]
  );

  const handleTextareaKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Keep canvas/global shortcuts from firing while typing.
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        setSession((current) => {
          commitSession(current);
          return null;
        });
      }
      // Enter inserts a newline (multi-line text, matching Oriedita); commit is
      // via blur / ESC only.
    },
    [commitSession]
  );

  const handleTextareaBlur = useCallback(() => {
    setSession((current) => {
      commitSession(current);
      return null;
    });
  }, [commitSession]);

  const handleDraftChange = useCallback((value: string) => {
    setSession((current) => (current ? { ...current, draft: value } : current));
  }, []);

  const editorPos = session ? projectAnchor(view, session.anchor) : null;
  const editorRows = session ? Math.max(1, session.draft.split('\n').length) : 1;

  return (
    <div className="cp-text-overlay" aria-hidden="true">
      {texts.map((text, index) => {
        const id = index + 1;
        // Hide the label currently being edited — the textarea stands in for it.
        if (session && session.textId === id) return null;
        const mx = textCoordinate(text.x);
        const my = textCoordinate(text.y);
        const { left, top } = projectAnchor(view, { x: mx, y: my });
        const isSelected = selectedSet.has(id);
        const style: CSSProperties = {
          left,
          top,
          fontSize: fontPx,
          pointerEvents: selectable ? 'auto' : 'none',
          cursor: textToolActive ? (isSelected ? 'move' : 'text') : undefined,
        };
        return (
          <span
            key={id}
            className={['cp-text-label', isSelected ? 'cp-text-label--selected' : '']
              .join(' ')
              .trim()}
            style={style}
            onClick={(event) => handleLabelClick(id, event)}
          >
            {text.text}
          </span>
        );
      })}
      {session && editorPos && (
        <textarea
          ref={textareaRef}
          className="cp-text-editor"
          style={{ left: editorPos.left, top: editorPos.top, fontSize: fontPx }}
          rows={editorRows}
          value={session.draft}
          spellCheck={false}
          onChange={(event) => handleDraftChange(event.target.value)}
          onKeyDown={handleTextareaKeyDown}
          onBlur={handleTextareaBlur}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        />
      )}
    </div>
  );
});
