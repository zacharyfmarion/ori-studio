import { useEffect, useId, useState } from 'react';
import { FieldRow } from './FieldRow';

/**
 * A text field in a row: commit on blur or Enter, Escape reverts, an empty or
 * unchanged draft commits nothing. `InspectorPanel`'s `EditableRow` semantics,
 * shared.
 */
export function TextRow({
  label,
  value,
  placeholder,
  disabled,
  title,
  onCommit,
  onReset,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  onCommit: (value: string) => void;
  onReset?: () => void;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };

  return (
    <FieldRow
      label={label}
      htmlFor={inputId}
      kind="text"
      disabled={disabled}
      title={title}
      onReset={onReset}
    >
      <input
        id={inputId}
        className="control-row__input"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
    </FieldRow>
  );
}
