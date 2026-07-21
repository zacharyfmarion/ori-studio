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
 */
export function BpNameEditor({
  title,
  name,
  placeholder,
  ariaLabel,
  onRename,
}: {
  title: string;
  name: string;
  placeholder?: string;
  ariaLabel: string;
  onRename: (name: string) => void;
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
          }
        }}
      />
    </div>
  );
}
