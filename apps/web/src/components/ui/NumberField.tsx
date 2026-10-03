import { useEffect, useId, useState } from 'react';
import { flushSync } from 'react-dom';
import { Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from './NumberField.module.css';

/**
 * A number input that holds a draft and commits it on blur, flanked by − / +
 * step buttons. The three are one control: a frame with a line between each
 * button and the number, and the unit, if there is one, inside it after the
 * number.
 *
 * The draft is what keeps a half-typed number out of the engine: clearing the
 * field to type `16` would otherwise send an empty value and a grid resize per
 * keystroke. But it also made the native `type="number"` spinners lie — a click
 * on one moved the draft and nothing else, so the value did not change until the
 * field was blurred or took an Enter. The step buttons commit on the click, and
 * Arrow Up/Down is routed through them so the keyboard does the same thing.
 *
 * `steppers={false}` is for callers with no room for two more buttons — the grid
 * scale formula puts three fields and two operators on one line. Those still
 * lose the native spinners, and still commit on Arrow Up/Down.
 *
 * Its look is its own (`NumberField.module.css`): a screen that wants it
 * different asks through a prop, and places it through `className`, which lands
 * on the root (`docs/styling.md`). The input carries `data-number-field`, so a
 * screen's own rules for inputs can leave it alone.
 */
export function NumberField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  steppers = true,
  disabled = false,
  normalize,
  variant,
  minChars = 2,
  className,
  onCommit,
}: {
  id?: string;
  /** Accessible name for the field, and the noun the step buttons are named after. */
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** The unit, read-only inside the field after the number, and read after the value. */
  suffix?: string;
  steppers?: boolean;
  /** For a row whose subject is absent — no selection, nothing folded yet. */
  disabled?: boolean;
  /** Caller's own clamp — applied to typed and stepped values alike. */
  normalize?: (value: number) => number;
  /**
   * `card`: Settings ▸ Paper's pen cards, a measurement on a card: on the
   * settings well, the control scale's 28px, and the number centred in the
   * mono face.
   */
  variant?: 'card';
  /**
   * The fewest digits the number makes room for (2). A shorter number is
   * centred in that room, and a longer one widens the field. A caller whose
   * values run longer passes their length, so the field keeps one width.
   */
  minChars?: number;
  /** Placement only — a width, a margin, a grid cell. Lands on the root. */
  className?: string;
  onCommit: (value: number) => void;
}) {
  const { t } = useTranslation();
  const suffixId = useId();
  const [draft, setDraft] = useState(() => formatNumber(value));

  useEffect(() => {
    setDraft(formatNumber(value));
  }, [value]);

  const clamp = (next: number): number => {
    const normalized = normalize ? normalize(next) : next;
    if (min !== undefined && normalized < min) return min;
    if (max !== undefined && normalized > max) return max;
    return normalized;
  };

  // Step from what the field shows rather than from the committed value, so a
  // number typed but not yet blurred out of still steps from where it was left.
  const numberIn = (raw: string): number => {
    const parsed = Number(raw);
    return raw.trim() !== '' && Number.isFinite(parsed) ? parsed : value;
  };

  // Fractional steps accumulate float noise (0.1 + 0.2), and a settings field is
  // not the place to show it.
  const stepped = (from: number, direction: 1 | -1): number =>
    clamp(Number((from + direction * step).toFixed(6)));

  const shown = numberIn(draft);

  const commit = (next: number): void => {
    setDraft(formatNumber(next));
    // A no-op commit is not free: grid size round-trips through the engine and
    // the grid rows write an undo entry.
    if (next !== value) onCommit(next);
  };

  const stepBy = (direction: 1 | -1): void => {
    commit(stepped(shown, direction));
  };

  const commitDraft = (): void => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(formatNumber(value));
      return;
    }
    commit(clamp(parsed));
  };

  const stepButton = (direction: 1 | -1) => (
    <button
      type="button"
      className={styles.step}
      data-direction={direction === 1 ? 'up' : 'down'}
      // Out of the tab order on purpose: Arrow Up/Down on the field already does
      // this, and an options pane of these rows would otherwise carry two tab
      // stops per row. Still named, so voice control and a screen reader's
      // virtual cursor can reach them.
      tabIndex={-1}
      aria-label={
        direction === 1
          ? t('common:numberField.increase', 'Increase {{label}}', { label })
          : t('common:numberField.decrease', 'Decrease {{label}}', { label })
      }
      disabled={disabled || stepped(shown, direction) === shown}
      // Keep focus in the field so stepping does not fire a blur commit of the
      // value that is already there.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => stepBy(direction)}
    >
      {direction === 1 ? <Plus size={11} aria-hidden="true" /> : <Minus size={11} aria-hidden="true" />}
    </button>
  );

  const bare = !steppers && !suffix;

  const input = (
    <input
      id={id}
      className={
        bare
          ? ['control-row__input', styles.input, className].filter(Boolean).join(' ')
          : styles.input
      }
      data-number-field=""
      aria-label={label}
      aria-describedby={suffix ? suffixId : undefined}
      type="number"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          // The native step would move the draft only, which is the confusion
          // the buttons exist to fix.
          event.preventDefault();
          stepBy(event.key === 'ArrowUp' ? 1 : -1);
          return;
        }
        if (event.key === 'Enter') {
          event.currentTarget.blur();
          return;
        }
        if (event.key === 'Escape') {
          const field = event.currentTarget;
          // Land the revert before blurring, or the blur's commit still reads
          // the number Escape just discarded and writes it back.
          flushSync(() => setDraft(formatNumber(value)));
          field.blur();
        }
      }}
    />
  );

  if (bare) return input;

  return (
    <span
      className={[styles.field, className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-unit={suffix ? true : undefined}
      data-disabled={disabled || undefined}
    >
      {steppers && stepButton(-1)}
      {/* A label, so a click on the unit or beside the number lands in the
          input. No caller puts the field inside a label of its own: a click on
          a step button would reach the input through it. */}
      <label className={styles.value}>
        <span className={styles.number}>
          {/* Sets the number's width: see `.number` in the module. */}
          <span className={styles.sizer} aria-hidden="true">
            {draft.padStart(minChars, '0')}
          </span>
          {input}
        </span>
        {suffix ? (
          <span id={suffixId} className={styles.suffix}>
            {suffix}
          </span>
        ) : null}
      </label>
      {steppers && stepButton(1)}
    </span>
  );
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}
