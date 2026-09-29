import type { ReactNode } from 'react';
import { Info, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '../Tooltip';

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
  help,
  htmlFor,
  noteId,
  overridable = false,
  kind,
  disabled = false,
  nested = false,
  title,
  className,
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
   * needed" under "Precrease grid" — so the pair reads as one setting, the way
   * `.context-menu__item--nested` does in a menu.
   */
  nested?: boolean;
  /** Why the row is disabled, shown on hover; the row itself carries it, not the control. */
  title?: string;
  className?: string;
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
  const rowClass = [
    'control-row',
    nested && 'control-row--nested',
    noteLine && 'control-row--noted',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const helpMark = help && (
    // Prompt, unlike a toolbar's tooltips: nobody sweeps past an info mark by
    // accident, and the provider's 700 ms reads as nothing happening.
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button type="button" className="control-row__help" aria-label={help}>
          <Info size={13} aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{help}</TooltipContent>
    </Tooltip>
  );
  return (
    <div className={rowClass} data-disabled={disabled || undefined} title={title}>
      {htmlFor ? (
        <label className="control-row__label" htmlFor={htmlFor}>
          {label}
          {helpMark}
        </label>
      ) : (
        <span className="control-row__label">
          {label}
          {helpMark}
        </span>
      )}
      <div
        className={[
          'control-row__value',
          `control-row__value--${kind}`,
          resetButton && 'control-row__value--reset',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
        {resetButton && (
          <button
            type="button"
            className="control-row__reset"
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
        <span className="control-row__note" id={noteId}>
          {overridden && t('common:fieldRow.overridden', 'Overridden')}
        </span>
      )}
    </div>
  );
}
