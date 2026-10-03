import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registerPendingEditFlush } from '../../lib/pendingEdits';
import { isComposingKey } from '../ui/fieldRows/isComposingKey';
import styles from './DiagramTitleField.module.css';

/**
 * The diagram's title, edited where it is shown. Commits on blur or Enter,
 * and before a save or any question about unsaved work; Escape puts back what
 * was there. The title is what the page header prints
 * and what an export is named after.
 */
export function DiagramTitleField({
  title,
  disabled,
  onRename,
}: {
  title: string;
  disabled: boolean;
  onRename: (title: string) => void;
}) {
  const { t } = useTranslation();
  const placeholder = t('panels:diagram.header.titlePlaceholder', 'Untitled diagram');
  const [draft, setDraft] = useState(title);
  /**
   * What was typed and is neither committed nor discarded yet, or null. Every
   * way out of the field reads this, not a render's `draft`: Escape blurs the
   * field, and a blur handler from before Escape still holds the typed text.
   */
  const typed = useRef<string | null>(null);
  const rename = useRef(onRename);
  useEffect(() => {
    rename.current = onRename;
  });
  useEffect(() => {
    typed.current = null;
    setDraft(title);
  }, [title]);
  const commit = useCallback(() => {
    const value = typed.current;
    typed.current = null;
    if (value !== null) rename.current(value);
  }, []);
  // A save, or a question about unsaved work, takes what was typed.
  useEffect(() => registerPendingEditFlush(commit), [commit]);

  return (
    // As wide as the title it holds — or the placeholder, when it holds none:
    // an invisible copy of the words sizes the cell the field shares with it.
    <span className={styles.sizer} data-value={draft || placeholder}>
      <input
        className={styles.field}
        type="text"
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={t('panels:diagram.header.titleLabel', 'Diagram title')}
        size={1}
        onChange={(event) => {
        typed.current = event.target.value;
        setDraft(event.target.value);
      }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (isComposingKey(event)) return;
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            typed.current = null;
            setDraft(title);
            event.currentTarget.blur();
          }
        }}
      />
    </span>
  );
}
