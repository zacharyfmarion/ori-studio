import { useId } from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FieldRow } from './fieldRows/FieldRow';

/**
 * A labelled colour swatch.
 *
 * The native `input type="color"` inside a `<label>` was already the pattern in
 * two places — the folded-figure menu and the crease export dialog — as the same
 * ten lines with different class names. This is that pattern, once, so the third
 * caller does not become a third copy.
 *
 * `onClear` is what a nullable colour needs: several simulator colours default to
 * a theme token, and without a way back the first click on a swatch would pin
 * them permanently.
 */
export function ColorField({
  label,
  inputLabel,
  value,
  onChange,
  onCommit,
  onClear,
  disabled = false,
  clearDisabled = disabled,
  title,
  layout = 'stacked',
  showValue = false,
  divider = true,
  className,
}: {
  label: string;
  /**
   * Accessible name for the swatch, where the visible label is not enough on
   * its own: a pen card's heading reads "Mountain folds", but the control
   * under it is that pen's *colour*, among its width, cap and dash. Defaults
   * to {@link label}, which is right wherever the swatch is the whole row.
   */
  inputLabel?: string;
  /** The colour to show. A resolved default is fine when the setting is unset. */
  value: string;
  onChange: (value: string) => void;
  /**
   * End of one interaction, on blur.
   *
   * A colour input fires `change` per pointer move while its picker is open, so a
   * caller that records history needs a commit point or a single drag becomes
   * dozens of undo entries.
   */
  onCommit?: () => void;
  /** Offered as a reset affordance when the value can fall back to a default. */
  onClear?: () => void;
  disabled?: boolean;
  /**
   * Whether the reset is disabled; it follows {@link disabled} unless a caller
   * says otherwise, for a swatch that is moot while its pin still counts.
   */
  clearDisabled?: boolean;
  /** Why the field is disabled, shown on hover over the whole row. */
  title?: string;
  /**
   * `stacked` puts the label above a full-width swatch, for the narrow grid
   * columns the folded-figure menu and the export dialog lay out. `row` is a
   * `FieldRow`: label left, small square swatch right, matching the sliders
   * and selects it sits between in an options pane. `inline` is the same
   * arrangement without the pane chrome — no padding, no dividing rule — for
   * dialogs, where a boxed column of controls reads as a table when nothing
   * about it is tabular.
   */
  layout?: 'stacked' | 'row' | 'inline';
  /** For the `row` layout: the rule under it (`FieldRow.divider`). */
  divider?: boolean;
  /**
   * Show the hex alongside the swatch. Useful where the exact value is part of what is
   * being chosen — a colour that will be published, or one being matched to another —
   * and noise everywhere else, so it is opt-in.
   */
  showValue?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const classes = ['color-field', `color-field--${layout}`, className].filter(Boolean).join(' ');
  const reset = onClear && (
    <button
      type="button"
      className="color-field__clear"
      title={t('common:colorField.reset', 'Reset to default')}
      aria-label={t('common:colorField.resetNamed', 'Reset {{label}} to default', { label })}
      disabled={clearDisabled}
      onClick={onClear}
    >
      <RotateCcw size={11} />
    </button>
  );
  const swatch = (
    <input
      id={inputId}
      className="color-field__input"
      type="color"
      aria-label={inputLabel ?? label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
      onBlur={onCommit}
      // A swatch has nothing for Escape to undo, but as an input it holds the
      // key away from the dialog around it; letting go of focus hands it back,
      // as NumberField does after its revert.
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.currentTarget.blur();
      }}
    />
  );

  const content = (
    <>
      {showValue && <span className="color-field__hex">{value}</span>}
      {swatch}
      {reset}
    </>
  );

  // In an options pane the colour is a row like its neighbours: the row's
  // label, its value column, its rule. The reset stays the field's own clear
  // rather than the row's, so it reads the same in every layout.
  if (layout === 'row') {
    return (
      <FieldRow
        className={classes}
        label={label}
        htmlFor={inputId}
        kind="color"
        disabled={disabled}
        title={title}
        divider={divider}
      >
        {content}
      </FieldRow>
    );
  }

  // Two elements rather than a wrapping <label>: the reset button has to sit
  // outside it, or clicking reset would also open the colour picker.
  return (
    <div className={classes} data-disabled={disabled || undefined} title={title}>
      <label
        className={layout === 'inline' ? 'color-field__label' : 'color-field__name'}
        htmlFor={inputId}
      >
        {label}
      </label>
      <span className="color-field__value">{content}</span>
    </div>
  );
}
