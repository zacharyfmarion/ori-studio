import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Contextual name field for a selected BP flap or tree vertex. A flap's name
 * lives on its dual tree leaf vertex, so the same editor serves both the tree
 * and packing surfaces. Mirrors Box Pleating Studio's flap/vertex panel "Name"
 * input: empty and duplicate names are allowed (no validation). Commits on blur
 * and Enter; Escape reverts.
 *
 * Reset-on-selection is handled by keying the element on the object id (a fresh
 * mount reruns the draft initializer); the effect below syncs external changes
 * (undo/redo) while the same object stays selected.
 *
 * When `autoFocus` is set, the input focuses and selects its text on mount —
 * because the element is keyed on the object id, that mount coincides with a
 * fresh selection, so selecting a node lets you immediately type its name.
 */
export function BpNameEditor({
  title,
  name,
  placeholder,
  ariaLabel,
  autoFocus = false,
  onRename,
}: {
  title: string;
  name: string;
  placeholder?: string;
  ariaLabel: string;
  autoFocus?: boolean;
  onRename: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDraft(name);
  }, [name]);
  useEffect(() => {
    if (!autoFocus) return undefined;
    // Defer to the next frame so this focus wins the browser's native focus from
    // the pointerdown that selected the node (the canvas dot is focusable), which
    // otherwise runs after our synchronous focus and steals it back.
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    });
    return () => cancelAnimationFrame(frame);
    // Mount-only: a fresh selection remounts this component (keyed by id), so
    // focusing once per mount is exactly "focus on new selection".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => {
    if (draft !== name) onRename(draft);
  };

  return (
    <div className="bp-name-editor" role="group" aria-label={ariaLabel}>
      <span className="bp-name-editor__title">{title}</span>
      <span className="bp-name-editor__label">{t('panels:bpNameEditor.label', 'Name')}</span>
      <input
        ref={inputRef}
        className="bp-name-editor__input"
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setDraft(name);
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
