import type { ReactNode } from 'react';

/**
 * The label-left / control-right row every options pane is built from.
 *
 * One shell for the `control-row` idiom, so the panes stop re-declaring it:
 * `CpViewControlsPanel`, `SimulatorViewControlsPanel` and `InspectorPanel` each
 * carried private `ToggleRow` / `NumberRow` copies that agreed by accident. The
 * row is a `div`, never a `<label>` wrapping its control: a Radix switch inside
 * a label is clicked twice and toggles back, and a stepper button inside one
 * also moves the field's draft. The label element is a `<label htmlFor>` only
 * when the control is a native input that can take it.
 */
export type FieldRowValueKind = 'toggle' | 'input' | 'select' | 'slider' | 'color' | 'segmented' | 'text';

export function FieldRow({
  label,
  htmlFor,
  kind,
  disabled = false,
  title,
  className,
  children,
}: {
  label: string;
  /** Set when the control is a native input the label can point at. */
  htmlFor?: string;
  kind: FieldRowValueKind;
  disabled?: boolean;
  /** Why the row is disabled, shown on hover; the row itself carries it, not the control. */
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const rowClass = ['control-row', className].filter(Boolean).join(' ');
  return (
    <div className={rowClass} data-disabled={disabled || undefined} title={title}>
      {htmlFor ? (
        <label className="control-row__label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="control-row__label">{label}</span>
      )}
      <div className={`control-row__value control-row__value--${kind}`}>{children}</div>
    </div>
  );
}
