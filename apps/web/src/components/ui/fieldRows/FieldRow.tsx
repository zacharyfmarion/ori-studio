import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import { Info, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SelectTrigger } from '../Select';
import { Tooltip, TooltipContent, TooltipTrigger } from '../Tooltip';
import styles from './FieldRow.module.css';

/**
 * The label-left / control-right row every options pane is built from.
 *
 * One shell for the pane-row idiom (it was the global `control-row`, and its
 * look is `FieldRow.module.css` now), so the panes stop re-declaring it:
 * `CpViewControlsPanel`, `SimulatorViewControlsPanel` and `InspectorPanel` each
 * carried private `ToggleRow` / `NumberRow` copies that agreed by accident. The
 * row is a `div`, never a `<label>` wrapping its control: a Radix switch inside
 * a label is clicked twice and toggles back, and a stepper button inside one
 * also moves the field's draft. The label element is a `<label htmlFor>` only
 * when the control is a native input that can take it.
 */
export type FieldRowValueKind =
  | 'toggle'
  | 'input'
  | 'select'
  | 'slider'
  | 'color'
  | 'segmented'
  | 'text'
  /** Text to read, not a control: the design inspector's facts and its actions' names. */
  | 'static';

export function FieldRow({
  label,
  help,
  htmlFor,
  noteId,
  overridable = false,
  kind,
  disabled = false,
  nested = false,
  title,
  className,
  divider = true,
  readout,
  onClick,
  onReset,
  children,
}: {
  label: string;
  /**
   * What the setting does, for one whose name cannot carry it: an info mark
   * after the label that explains on hover or focus.
   */
  help?: string;
  /** Set when the control is a native input the label can point at. */
  htmlFor?: string;
  /**
   * The id the "Overridden" note carries on a toggle, so the switch can name
   * it in `aria-describedby`.
   */
  noteId?: string;
  /**
   * A toggle that can be overridden, whether or not it is now. Its row keeps
   * the note's line under the label while the note is empty, so the row is
   * one height either way: a row that shrank as its override was cleared
   * would move the switch too, whenever its pane is scrolled to the end and
   * the scroller takes the lost height back from the top.
   */
  overridable?: boolean;
  kind: FieldRowValueKind;
  disabled?: boolean;
  /**
   * A step in, for an option that qualifies the one above it — "Only where
   * needed" under "Precrease grid" — so the pair reads as one setting.
   */
  nested?: boolean;
  /** Why the row is disabled, shown on hover; the row itself carries it, not the control. */
  title?: string;
  /** For placement, on the row's root; and for a component that is a row, its own root class. */
  className?: string;
  /**
   * The rule under the row. A pane's rows rule each other off; a row with
   * nothing under it that it separates from — the last of a group whose
   * container ends itself, or one inside a window that divides its own
   * sections — goes without.
   */
  divider?: boolean;
  /** A number beside the control, as the slider's value is: dimmed with the row. */
  readout?: ReactNode;
  /**
   * The whole row is the control: a button whose label names the action and
   * whose value says what it does, as the design inspector's actions are. Such
   * a row takes no `help` and no `onReset`, which would be buttons inside it.
   */
  onClick?: () => void;
  /**
   * Put the value back to its default. Rendered as the trailing affordance
   * `ColorField.onClear` has — a reset is a property edit like any other, so
   * it sits with the control rather than in a header.
   *
   * Except on a toggle. A button that comes and goes beside a switch moves the
   * switch each time it is flipped, so a quick second click lands on the reset
   * instead. A toggle says "Overridden" under its label while it has a reset,
   * and the switch itself is the way back: `ToggleRow` runs the reset when it
   * is switched to the value it would inherit.
   */
  onReset?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const overridden = kind === 'toggle' && onReset !== undefined;
  const noteLine = overridden || (kind === 'toggle' && overridable);
  const resetButton = kind !== 'toggle' && onReset !== undefined;
  const rootData = {
    'data-field-row': '',
    'data-nested': nested || undefined,
    'data-noted': noteLine || undefined,
    'data-disabled': disabled || undefined,
    'data-divider': divider ? undefined : 'none',
  };
  const rootClass = className ? `${styles.row} ${className}` : styles.row;

  if (onClick) {
    // Phrasing content throughout: a button may hold nothing else.
    return (
      <button
        type="button"
        className={rootClass}
        data-action=""
        {...rootData}
        title={title}
        disabled={disabled}
        onClick={onClick}
      >
        <span className={styles.label} data-field-label="">
          {label}
        </span>
        <span className={styles.value} data-field-value={kind}>
          {children}
        </span>
      </button>
    );
  }

  const helpMark = help && (
    // Prompt, unlike a toolbar's tooltips: nobody sweeps past an info mark by
    // accident, and the provider's 700 ms reads as nothing happening.
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button type="button" className={styles.help} data-field-help="" aria-label={help}>
          <Info size={13} aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{help}</TooltipContent>
    </Tooltip>
  );
  return (
    <div className={rootClass} {...rootData} title={title}>
      {htmlFor ? (
        <label className={styles.label} data-field-label="" htmlFor={htmlFor}>
          {label}
          {helpMark}
        </label>
      ) : (
        <span className={styles.label} data-field-label="">
          {label}
          {helpMark}
        </span>
      )}
      <div
        className={styles.value}
        data-field-value={kind}
        data-reset={resetButton || undefined}
      >
        {children}
        {readout !== undefined && (
          <span className={styles.readout} data-field-readout="">
            {readout}
          </span>
        )}
        {resetButton && (
          <button
            type="button"
            className={styles.reset}
            data-field-reset=""
            title={t('common:colorField.reset', 'Reset to default')}
            aria-label={t('common:colorField.resetNamed', 'Reset {{label}} to default', { label })}
            disabled={disabled}
            onClick={onReset}
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>
      {/* After the value, so it takes the grid's second line under the label
          and the line the switch sits on is the same with or without it. Empty
          rather than absent while nothing is overridden (see `overridable`). */}
      {noteLine && (
        <span className={styles.note} data-field-note="" id={noteId}>
          {overridden && t('common:fieldRow.overridden', 'Overridden')}
        </span>
      )}
    </div>
  );
}

/**
 * The trigger a row's select wears: the row's height, the column's width.
 *
 * A component rather than a class the select row sets, because the row is what
 * knows that size — and a module's class can be read only by the file that
 * imports it.
 */
export const FieldRowSelectTrigger = forwardRef<
  ElementRef<typeof SelectTrigger>,
  Omit<ComponentPropsWithoutRef<typeof SelectTrigger>, 'className'>
>(function FieldRowSelectTrigger(props, ref) {
  return <SelectTrigger ref={ref} className={styles.selectTrigger} {...props} />;
});
