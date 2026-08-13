import { useId, type ReactNode } from 'react';
import { Toggle } from '../ui/Toggle';

export interface SettingsToggleRowProps {
  label: ReactNode;
  /** Secondary line under the label. Omit it for a label-only row. */
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * One immediately-applied on/off preference: label, optional description, switch.
 *
 * Deliberately not a `<label>` wrapping the switch. The Radix switch is itself
 * the control, so a label around it delivers the click twice and the preference
 * toggles straight back; `aria-labelledby` ties the two instead.
 */
export function SettingsToggleRow({
  label,
  description,
  checked,
  onChange,
}: SettingsToggleRowProps) {
  const labelId = useId();
  const descriptionId = useId();

  return (
    <div
      className="settings-toggle-row"
      // Mouse convenience, replacing the hit target the `<label>` checkboxes
      // used to give the copy. Not focusable on purpose: the switch already is,
      // and a second tab stop would announce the same preference twice.
      onClick={() => onChange(!checked)}
    >
      <span className="settings-toggle-row__copy">
        <span className="settings-toggle-row__label" id={labelId}>
          {label}
        </span>
        {description !== undefined && (
          <span className="settings-toggle-row__desc" id={descriptionId}>
            {description}
          </span>
        )}
      </span>
      <Toggle
        checked={checked}
        onChange={onChange}
        aria-labelledby={labelId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        // The switch answers its own click. Letting it reach the row as well
        // would toggle twice and land back where it started.
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
