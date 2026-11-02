import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { FieldRowHelp } from './FieldRow';
import styles from './StackedRow.module.css';

/**
 * A row whose fields stand under its label rather than beside it — prose
 * (`TextAreaRow`), or a list of fields (the title block's credits) — in the
 * rhythm of the `FieldRow`s round it: their padding, rule, label, help mark
 * and step in.
 *
 * The label is a `<label htmlFor>` where there is one field it names
 * (`labelFor`), and otherwise the row's name by its `labelId`, as a group's
 * `aria-labelledby` reads it.
 */
export function StackedRow({
  label,
  labelFor,
  labelId,
  labelHidden = false,
  help,
  aside,
  nested = false,
  disabled = false,
  title,
  ref,
  children,
  ...rest
}: {
  label: string;
  /** The one field the label names. */
  labelFor?: string;
  /** The label's id, for a group named by it. */
  labelId?: string;
  /** Keep the label for assistive technology only, where a section title already says it. */
  labelHidden?: boolean;
  /** What the row is for, behind a help mark after its label, as a `FieldRow`'s (`FieldRow.help`). */
  help?: string;
  /** A mark of the caller's own after the label and its help mark, as a `FieldRow`'s (`FieldRow.aside`). */
  aside?: ReactNode;
  /** A step in, for a row that belongs to the one above it (`FieldRow.nested`). */
  nested?: boolean;
  disabled?: boolean;
  /** Why the row is disabled, shown on hover. */
  title?: string;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'title'>) {
  const className = labelHidden ? styles.labelHidden : styles.label;
  const labelElement =
    labelFor !== undefined ? (
      <label id={labelId} className={className} htmlFor={labelFor}>
        {label}
      </label>
    ) : (
      <span id={labelId} className={className}>
        {label}
      </span>
    );
  return (
    <div
      {...rest}
      ref={ref}
      className={styles.row}
      data-nested={nested || undefined}
      data-disabled={disabled || undefined}
      title={title}
    >
      {help || aside ? (
        // Beside the label, not in it: a mark inside would join the field's name.
        <span className={styles.head}>
          {labelElement}
          {help && <FieldRowHelp help={help} />}
          {aside}
        </span>
      ) : (
        labelElement
      )}
      {children}
    </div>
  );
}
