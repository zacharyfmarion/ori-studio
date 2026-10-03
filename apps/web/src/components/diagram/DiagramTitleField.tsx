import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './DiagramTitleField.module.css';

/**
 * The diagram's title, edited where it is shown. Commits on blur or Enter;
 * Escape puts back what was there. The title is what the page header prints
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
  // Escape blurs the field, and the blur handler is this render's, which still
  // holds the typed draft: without this it would commit what Escape discards.
  const discarding = useRef(false);
  useEffect(() => {
    setDraft(title);
  }, [title]);

  return (
    <input
      className={styles.field}
      type="text"
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={t('panels:diagram.header.titleLabel', 'Diagram title')}
      // Wide enough for the title it holds — or the placeholder, when it holds
      // none — within the header's room.
      size={Math.min(40, (draft || placeholder).length + 1)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (discarding.current) {
          discarding.current = false;
          return;
        }
        if (draft !== title) onRename(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          discarding.current = true;
          setDraft(title);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
