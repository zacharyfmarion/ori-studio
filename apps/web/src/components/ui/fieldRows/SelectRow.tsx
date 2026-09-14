import type { ComponentPropsWithoutRef } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../Select';
import { FieldRow } from './FieldRow';

export interface SelectRowOption {
  id: string;
  label: string;
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
  title,
  onChange,
  contentProps,
}: {
  label: string;
  value: string | null;
  options: readonly SelectRowOption[];
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  onChange: (value: string) => void;
  contentProps?: Omit<ComponentPropsWithoutRef<typeof SelectContent>, 'children'>;
}) {
  return (
    <FieldRow label={label} kind="select" disabled={disabled} title={title}>
      <Select value={value ?? ''} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger aria-label={label} className="control-row__select">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent {...contentProps}>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldRow>
  );
}
