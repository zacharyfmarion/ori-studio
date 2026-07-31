import { useId } from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
  value,
  onChange,
  onCommit,
  onClear,
  disabled = false,
  layout = 'stacked',
  className,
}: {
  label: string;
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
   * `stacked` puts the label above a full-width swatch, for the narrow grid
   * columns the folded-figure menu and the export dialog lay out. `row` is a
   * `control-row`: label left, small square swatch right, matching the sliders
   * and selects it sits between in an options pane.
   */
  layout?: 'stacked' | 'row';
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
      disabled={disabled}
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
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
      onBlur={onCommit}
    />
  );

  // Two elements rather than a wrapping <label>: the reset button has to sit
  // outside it, or clicking reset would also open the colour picker.
  return (
    <div className={layout === 'row' ? `control-row ${classes}` : classes}>
      <label
        className={layout === 'row' ? 'control-row__label' : 'color-field__name'}
        htmlFor={inputId}
      >
        {label}
      </label>
      <span className={layout === 'row' ? 'control-row__value color-field__value' : 'color-field__value'}>
        {swatch}
        {reset}
      </span>
    </div>
  );
}
