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
  type PointerEvent,
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

/**
 * Invert the view's linear part to turn a CSS-pixel drag delta into a model-space
 * delta (the origin cancels for a delta, so only [ex ey] is needed). Returns null
 * for a degenerate (non-invertible) view.
 */
function clientDeltaToModel(
  view: CpOverlayView,
  dxCss: number,
  dyCss: number
): Point | null {
  const det = view.ex[0] * view.ey[1] - view.ey[0] * view.ex[1];
  if (Math.abs(det) < 1e-12) return null;
  return {
    x: (dxCss * view.ey[1] - dyCss * view.ey[0]) / det,
    y: (view.ex[0] * dyCss - view.ex[1] * dxCss) / det,
  };
}

// A drag must exceed this many CSS px before it counts as a move (below it, the
// gesture is treated as a click that opens the editor).
const DRAG_THRESHOLD_PX = 3;

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
  onMoveText,
  onDeselect,
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
  /** Delete an existing text (emptied-out content, or a right-click delete). */
  onDeleteText?: (id: number) => void;
  /** Commit a drag: move text `id` by `delta` model units. May resolve after the
   * document reflects the move, so the overlay can hold the optimistic offset. */
  onMoveText?: (id: number, delta: Point) => void | Promise<unknown>;
  /** Clear the text selection (dismissing an edit by clicking away or pressing ESC). */
  onDeselect?: () => void;
}) {
  const selectedSet = useMemo(() => new Set(selectedTextIds), [selectedTextIds]);
  const fontPx = Math.max(1, BASE_FONT_PX * (zoomPercent / 100));

  const [session, setSession] = useState<EditSession | null>(null);
  // Mirror of `session` for imperative reads. All session mutations go through
  // `setSessionSafely`, which keeps this in sync. It is the authority for commits.
  const sessionRef = useRef<EditSession | null>(null);
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

  const setSessionSafely = useCallback((next: EditSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  // Commit the open session exactly once, OUTSIDE any state updater. Commits must
  // not live inside a setState updater: React StrictMode double-invokes updaters in
  // dev, which would run the create/set side effect twice (two texts). Nulling the
  // ref first also makes re-entrant calls (e.g. blur + backdrop from one click) a
  // no-op on the second.
  const commitCurrentSession = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    sessionRef.current = null;
    commitSession(current);
  }, [commitSession]);

  // Open a create draft when the canvas relays an empty-space click. Commit any
  // in-progress session first, then start fresh at the new point.
  useEffect(() => {
    if (!createDraftAt) return;
    commitCurrentSession();
    setSessionSafely({ textId: null, anchor: { x: createDraftAt.x, y: createDraftAt.y }, draft: '' });
    onCreateDraftConsumed?.();
  }, [createDraftAt, commitCurrentSession, setSessionSafely, onCreateDraftConsumed]);

  // Leaving the Text tool commits the open session (parity with Oriedita hiding the
  // editor + firing record() when the mouse mode changes away from TEXT).
  useEffect(() => {
    if (textToolActive) return;
    commitCurrentSession();
    setSessionSafely(null);
  }, [textToolActive, commitCurrentSession, setSessionSafely]);

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
      commitCurrentSession();
      setSessionSafely({
        textId: id,
        anchor: { x: textCoordinate(text.x), y: textCoordinate(text.y) },
        draft: text.text,
      });
      onSelectText?.(id);
    },
    [texts, commitCurrentSession, setSessionSafely, onSelectText]
  );

  // Plain (non-Text-tool) selection stays a click; the Text tool routes clicks and
  // drags through the pointer handlers below instead.
  const handleLabelClick = useCallback(
    (id: number, event: MouseEvent<HTMLSpanElement>) => {
      event.stopPropagation();
      if (!textToolActive) {
        onToggleText(id, event.shiftKey || event.metaKey || event.ctrlKey);
      }
    },
    [textToolActive, onToggleText]
  );

  // Text-tool drag/click: press to start a potential drag; a move past the
  // threshold becomes a drag (live-offset preview), and release commits the move —
  // or, if it never moved, opens the inline editor (a click).
  const dragRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    origin: Point;
    delta: Point;
  } | null>(null);
  // The dragged label's live ABSOLUTE model position (origin + delta), not a
  // relative offset. Rendering the absolute target means that when the Move
  // command's document update lands (texts prop → origin + delta) while we still
  // hold `drag`, the label stays put instead of briefly double-shifting to
  // origin + 2*delta and snapping back.
  const [drag, setDrag] = useState<{ id: number; x: number; y: number } | null>(null);

  const handleLabelPointerDown = useCallback(
    (id: number, event: PointerEvent<HTMLSpanElement>) => {
      if (!textToolActive || event.button !== 0) return;
      const text = texts[id - 1];
      if (!text) return;
      event.stopPropagation();
      dragRef.current = {
        id,
        startX: event.clientX,
        startY: event.clientY,
        origin: { x: textCoordinate(text.x), y: textCoordinate(text.y) },
        delta: { x: 0, y: 0 },
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [textToolActive, texts]
  );

  const handleLabelPointerMove = useCallback(
    (event: PointerEvent<HTMLSpanElement>) => {
      const state = dragRef.current;
      if (!state) return;
      const dxCss = event.clientX - state.startX;
      const dyCss = event.clientY - state.startY;
      if (Math.abs(dxCss) < DRAG_THRESHOLD_PX && Math.abs(dyCss) < DRAG_THRESHOLD_PX && !drag) {
        return;
      }
      const delta = clientDeltaToModel(view, dxCss, dyCss) ?? { x: 0, y: 0 };
      state.delta = delta;
      setDrag({ id: state.id, x: state.origin.x + delta.x, y: state.origin.y + delta.y });
    },
    [view, drag]
  );

  const handleLabelPointerUp = useCallback(
    (id: number, event: PointerEvent<HTMLSpanElement>) => {
      const state = dragRef.current;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!state || state.id !== id) return;
      const moved = drag != null && (state.delta.x !== 0 || state.delta.y !== 0);
      if (moved) {
        // Hold the label at its final absolute position until the Move command's
        // document update lands, so it doesn't snap back to the old spot for a frame
        // before the committed position renders (the drag "lag").
        const committed = { id, x: state.origin.x + state.delta.x, y: state.origin.y + state.delta.y };
        setDrag(committed);
        Promise.resolve(onMoveText?.(id, state.delta)).finally(() => {
          setDrag((current) => (current === committed ? null : current));
        });
      } else {
        setDrag(null);
        startEditSession(id);
      }
    },
    [drag, onMoveText, startEditSession]
  );

  const handleLabelContextMenu = useCallback(
    (id: number, event: MouseEvent<HTMLSpanElement>) => {
      if (!textToolActive) return;
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = null;
      setDrag(null);
      onDeleteText?.(id);
    },
    [textToolActive, onDeleteText]
  );

  // Commit and close the editor. `deselect` also clears the selection — used by the
  // explicit dismiss gestures (ESC, clicking the empty canvas) so a dismissed text
  // is no longer selected. Blur alone keeps the selection (commit only).
  const dismissSession = useCallback(
    (deselect: boolean) => {
      commitCurrentSession();
      setSessionSafely(null);
      if (deselect) onDeselect?.();
    },
    [commitCurrentSession, setSessionSafely, onDeselect]
  );

  const handleTextareaKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Keep canvas/global shortcuts from firing while typing.
      event.stopPropagation();
      if (event.key === 'Escape') {
        // ESC just unfocuses: commit what's typed (blank is dropped) and deselect.
        // It never deletes a text that has content.
        event.preventDefault();
        dismissSession(true);
      }
      // Enter inserts a newline (multi-line text, matching Oriedita); commit is
      // via blur / ESC only.
    },
    [dismissSession]
  );

  const handleTextareaBlur = useCallback(() => {
    dismissSession(false);
  }, [dismissSession]);

  const handleDraftChange = useCallback(
    (value: string) => {
      const current = sessionRef.current;
      if (current) setSessionSafely({ ...current, draft: value });
    },
    [setSessionSafely]
  );

  const editorPos = session ? projectAnchor(view, session.anchor) : null;
  const editorRows = session ? Math.max(1, session.draft.split('\n').length) : 1;

  return (
    <div className="cp-text-overlay" aria-hidden="true">
      {/* While editing, a backdrop under the labels/editor catches clicks on empty
          space so they dismiss the editor (commit + deselect) instead of falling
          through to the canvas and starting a new text box. Labels sit above it, so
          clicking another label still switches the edit. */}
      {session && (
        <div
          className="cp-text-editor-backdrop"
          onPointerDown={(event) => {
            event.stopPropagation();
            dismissSession(true);
          }}
        />
      )}
      {texts.map((text, index) => {
        const id = index + 1;
        // Hide the label currently being edited — the textarea stands in for it.
        if (session && session.textId === id) return null;
        // The label being dragged renders at its live absolute model position.
        const dragging = drag?.id === id;
        const mx = dragging ? drag.x : textCoordinate(text.x);
        const my = dragging ? drag.y : textCoordinate(text.y);
        const { left, top } = projectAnchor(view, { x: mx, y: my });
        const isSelected = selectedSet.has(id);
        const style: CSSProperties = {
          left,
          top,
          fontSize: fontPx,
          pointerEvents: selectable ? 'auto' : 'none',
          // Every label is draggable under the Text tool, so show the move cursor on
          // hover (a plain click still opens the editor).
          cursor: textToolActive ? 'move' : undefined,
        };
        return (
          <span
            key={id}
            className={['cp-text-label', isSelected ? 'cp-text-label--selected' : '']
              .join(' ')
              .trim()}
            style={style}
            onClick={(event) => handleLabelClick(id, event)}
            onPointerDown={(event) => handleLabelPointerDown(id, event)}
            onPointerMove={handleLabelPointerMove}
            onPointerUp={(event) => handleLabelPointerUp(id, event)}
            onContextMenu={(event) => handleLabelContextMenu(id, event)}
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
