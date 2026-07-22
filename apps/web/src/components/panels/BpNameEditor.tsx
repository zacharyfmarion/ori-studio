import { useEffect, useState } from 'react';
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
 * The field never takes focus on its own. Selecting a flap used to focus it, but
 * while it holds focus it owns the keyboard: Delete edits the name instead of
 * deleting the node, and the undo shortcut undoes the field's text instead of
 * the edit. Click into it to rename.
 */
export function BpNameEditor({
  title,
  name,
  placeholder,
  ariaLabel,
  onRename,
  onEscape,
}: {
  title: string;
  name: string;
  placeholder?: string;
  ariaLabel: string;
  onRename: (name: string) => void;
  /**
   * Escape hook for the surrounding surface, fired after the draft is reverted
   * and the field released. Lets a pane treat Escape as one gesture — abandon
   * the edit and drop the selection — instead of needing a second press.
   */
  onEscape?: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => name);
  useEffect(() => {
    setDraft(name);
  }, [name]);

  const commit = () => {
    if (draft !== name) onRename(draft);
  };

  return (
    <div className="bp-name-editor" role="group" aria-label={ariaLabel}>
      <span className="bp-name-editor__title">{title}</span>
      <span className="bp-name-editor__label">{t('panels:bpNameEditor.label', 'Name')}</span>
      <input
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
            onEscape?.();
          }
        }}
      />
    </div>
  );
}
