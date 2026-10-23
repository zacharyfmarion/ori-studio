import { useId, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { Select, SelectContent, SelectItem, SelectValue } from '../Select';
import { FieldRow, FieldRowSelectTrigger } from './FieldRow';

export interface SelectRowOption {
  id: string;
  label: string;
  /** Offered as no choice: there, dimmed, not picked. */
  disabled?: boolean;
  /** A line under it in the list: why it is disabled, say. */
  description?: string;
}

/**
 * A dropdown in a row. `value: null` is the mixed state — nothing checked and
 * the placeholder shown — which Radix expresses as the empty string (a
 * `SelectItem` may never carry one, so it cannot collide with an option).
 * `contentProps` reaches the portalled menu, for a caller that has to mark the
 * portal as its own surface (the Properties pane's companion attribute).
 */
export function SelectRow({
  label,
  value,
  options,
  placeholder,
  disabled,
  nested,
  title,
  help,
  divider,
  note,
  onChange,
  onReset,
  contentProps,
}: {
  label: string;
  value: string | null;
  options: readonly SelectRowOption[];
  placeholder?: string;
  disabled?: boolean;
  /** A step in, for an option that qualifies the one above it (`FieldRow.nested`). */
  nested?: boolean;
  title?: string;
  /** What the row means, behind a help mark beside its label: reachable by keyboard and touch, where a title is not. */
  help?: string;
  /** The rule under the row (`FieldRow.divider`). */
  divider?: boolean;
  /** Why what it is set to shows nothing, under its label, read with it (`FieldRow.note`). */
  note?: string;
  onChange: (value: string) => void;
  onReset?: () => void;
  contentProps?: Omit<ComponentPropsWithoutRef<typeof SelectContent>, 'children'>;
}) {
  const noteId = useId();
  // A list whose options carry a description line is held to the row's width as it opens — in a tool
  // window, the window's — so a long reason wraps under its option rather than stretching the list.
  const described = options.some((option) => option.description);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const measure = (open: boolean) => {
    if (!open || !described) return;
    const row = trigger.current?.closest('[data-field-row]');
    if (row) setRowWidth(row.getBoundingClientRect().width);
  };
  return (
    <FieldRow
      label={label}
      kind="select"
      disabled={disabled}
      nested={nested}
      title={title}
      help={help}
      divider={divider}
      noteId={noteId}
      note={note}
      onReset={onReset}
    >
      <Select value={value ?? ''} onValueChange={onChange} disabled={disabled} onOpenChange={measure}>
        <FieldRowSelectTrigger ref={trigger} aria-label={label} aria-describedby={note === undefined ? undefined : noteId}>
          <SelectValue placeholder={placeholder} />
        </FieldRowSelectTrigger>
        <SelectContent {...(described && rowWidth !== null ? { maxWidth: rowWidth } : {})} {...contentProps}>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id} disabled={option.disabled} description={option.description}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldRow>
  );
}
