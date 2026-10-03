import { useCallback, useEffect, useId, useRef, useState, type Ref } from 'react';
import { registerCanvasSessionEnder } from '../../../cp-workspace/canvasObjects/canvasSessions';
import { registerPendingEditFlush } from '../../../lib/pendingEdits';
import { isComposingKey } from './isComposingKey';
import styles from './TextAreaRow.module.css';

/** Sessions are numbered across every row, so two rows can never share one. */
let lastSession = 0;

/** What is typed but not yet committed, and where it commits to. */
interface PendingEdit {
  text: string;
  /**
   * The `onCommit` that was current when this run of typing began. A pending
   * edit belongs to the thing it was typed into: if the row is re-pointed
   * mid-run — at another step, or at a diagram that replaced its own — the
   * draft still lands where it was written, and that callback can refuse it.
   */
  commit: (text: string, session: number) => void;
  session: number;
}

/**
 * A multi-line text field in a row, its label above it.
 *
 * Commits on blur, after `idleMs` without typing, before any undo or redo
 * runs, before a save or any question about unsaved work (`pendingEdits`),
 * and when the row goes away — so nothing typed is ever lost, and an undo
 * always has the latest text to undo. Each commit carries the session it
 * belongs to (one per focus), so a consumer that records history can make one
 * sitting at the field one entry.
 *
 * Enter is a newline; Escape and Cmd/Ctrl+Enter leave the field, keeping what
 * was typed. There is nothing to revert to: the idle commits have already
 * written most of it, and undo is how a session is taken back.
 */
export function TextAreaRow({
  label,
  labelHidden = false,
  value,
  placeholder,
  disabled = false,
  title,
  rows = 3,
  maxLength,
  idleMs = 600,
  singleLine = false,
  fieldRef,
  onCommit,
}: {
  label: string;
  /**
   * Keep the label for assistive technology only, for a field whose section
   * title already says what it is.
   */
  labelHidden?: boolean;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  /** Why the row is disabled, shown on hover. */
  title?: string;
  rows?: number;
  maxLength?: number;
  /** How long typing must pause before the draft commits. */
  idleMs?: number;
  /**
   * One line of text, wrapped where it does not fit: Enter leaves the field
   * as Escape does, and a line break pasted in is a space.
   */
  singleLine?: boolean;
  /** The field itself, for a caller that puts the focus in it. */
  fieldRef?: Ref<HTMLTextAreaElement>;
  onCommit: (value: string, session: number) => void;
}) {
  const fieldId = useId();
  // Shown while there is uncommitted typing; otherwise the field shows `value`,
  // so an undo or a reload reaches it at once.
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef<PendingEdit | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const session = useRef(0);
  const latest = useRef({ onCommit, value });
  useEffect(() => {
    latest.current = { onCommit, value };
  });

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const edit = pending.current;
    if (!edit) return;
    pending.current = null;
    setDraft(null);
    if (edit.text !== latest.current.value) edit.commit(edit.text, edit.session);
  }, []);

  // An undo about to run commits this first, so the undo takes it back rather
  // than running under a draft that would write the old text again. A document
  // replacement commits it too: the callback it was typed against decides
  // whether it still has anywhere to go.
  useEffect(() => registerCanvasSessionEnder(flush, 'session'), [flush]);
  useEffect(() => registerPendingEditFlush(flush), [flush]);
  useEffect(() => flush, [flush]);

  const beginSession = () => {
    lastSession += 1;
    session.current = lastSession;
  };

  return (
    <div className={styles.row} data-disabled={disabled || undefined} title={title}>
      <label className={labelHidden ? styles.labelHidden : styles.label} htmlFor={fieldId}>
        {label}
      </label>
      <textarea
        ref={fieldRef}
        id={fieldId}
        className={styles.field}
        value={draft ?? value}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        maxLength={maxLength}
        onFocus={beginSession}
        onChange={(event) => {
          const text = singleLine ? event.target.value.replace(/[\r\n]+/g, ' ') : event.target.value;
          // A change can arrive without a focus event (a test, an assistive
          // tool setting the value); it still needs a session of its own.
          if (session.current === 0) beginSession();
          pending.current = {
            text,
            commit: pending.current?.commit ?? latest.current.onCommit,
            session: session.current,
          };
          setDraft(text);
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = setTimeout(flush, idleMs);
        }}
        onBlur={() => {
          flush();
          session.current = 0;
        }}
        onKeyDown={(event) => {
          // An input method's Enter and Escape accept or cancel a conversion.
          if (isComposingKey(event)) return;
          if (
            event.key === 'Escape' ||
            (event.key === 'Enter' && (singleLine || event.metaKey || event.ctrlKey))
          ) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
