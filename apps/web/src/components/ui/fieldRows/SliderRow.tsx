import { useRef, useState } from 'react';
import { GestureSlider } from '../GestureSlider';
import { FieldRow } from './FieldRow';
import styles from './SliderRow.module.css';

/**
 * How a slider row hands its value over. Either the caller follows the drag —
 * `onChange` on every move, its own undo bracket opened and closed by the
 * gesture callbacks — or the row holds the drag itself and hands over only
 * where it is let go (`onCommit`), once per drag and once per keyboard step:
 * for a value whose every change is costly, as a page setting that packs the
 * pages again is.
 */
type SliderRowValue =
  | {
      onChange: (value: number) => void;
      /** Opens the caller's undo bracket; `false` refuses the drag (see `GestureSlider`). */
      onGestureStart?: () => boolean | void;
      onGestureCommit?: (label: string) => void;
      commitLabel?: string;
      onCommit?: undefined;
    }
  | {
      /** The value where a drag was let go, or a key stepped it to; never the value it started at. */
      onCommit: (value: number) => void;
      onChange?: undefined;
      onGestureStart?: undefined;
      onGestureCommit?: undefined;
      commitLabel?: undefined;
    };

/**
 * A slider with a readout in a row, recording one undo entry per drag through
 * {@link GestureSlider}. A caller with nothing to record (an app-wide
 * preference) omits the gesture callbacks; the protocol stays uniform so a
 * renderer never has to know which rows are document edits.
 */
export function SliderRow({
  label,
  help,
  value,
  min,
  max,
  step = 1,
  disabled,
  nested,
  title,
  format,
  onChange,
  onGestureStart,
  onGestureCommit,
  commitLabel,
  onCommit,
  onReset,
  ariaLabel,
  valueText,
}: {
  label: string;
  /** What the setting does, behind a help mark beside its label (`FieldRow.help`). */
  help?: string;
  /** The slider's accessible name, when the row's label says less out of its section ("Amount"). */
  ariaLabel?: string;
  /** What a value means, read in place of the bare number: "5% of the model" for a 5. */
  valueText?: (value: number) => string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  /** A step in, for an option that qualifies the one above it (`FieldRow.nested`). */
  nested?: boolean;
  title?: string;
  /** The readout beside the thumb; defaults to the value with the step's decimals. */
  format?: (value: number) => string;
  onReset?: () => void;
} & SliderRowValue) {
  const held = useHeldDrag(value, onCommit);
  const shown = onCommit ? held.value : value;
  const formatted = format ?? defaultFormat(step);
  return (
    <FieldRow
      label={label}
      help={help}
      kind="slider"
      disabled={disabled}
      nested={nested}
      title={title}
      readout={
        // As wide as the wider of the slider's ends, whatever it shows, so a
        // value with more digits never moves the slider under a drag.
        <span className={styles.readout} data-min={formatted(min)} data-max={formatted(max)}>
          <span className={styles.readoutValue}>{formatted(shown)}</span>
        </span>
      }
      onReset={onReset}
    >
      <GestureSlider
        className={styles.slider}
        aria-label={ariaLabel ?? label}
        aria-valuetext={valueText?.(shown)}
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        onChange={onCommit ? held.move : (onChange ?? noop)}
        onGestureStart={onCommit ? held.start : (onGestureStart ?? noop)}
        onGestureCommit={onCommit ? held.end : (onGestureCommit ?? noop)}
        commitLabel={commitLabel ?? ''}
      />
    </FieldRow>
  );
}

/**
 * A drag the row holds until it is let go: the value it shows meanwhile, and
 * the gesture's three callbacks, the last handing the value over once —
 * unless it ends where it began. Inert for a row whose caller follows the drag.
 */
function useHeldDrag(value: number, onCommit: ((value: number) => void) | undefined) {
  const [moved, setMoved] = useState<number | null>(null);
  const latest = useRef<number | null>(null);
  return {
    value: moved ?? value,
    start() {
      latest.current = value;
    },
    move(next: number) {
      latest.current = next;
      setMoved(next);
    },
    end() {
      const next = latest.current;
      latest.current = null;
      setMoved(null);
      if (next !== null && next !== value) onCommit?.(next);
    },
  };
}

/** Show as many decimals as the step implies, so a 0.05 step does not read "0.7000000001". */
export function formatSliderValue(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return value.toFixed(decimals);
}

function defaultFormat(step: number): (value: number) => string {
  return (value) => formatSliderValue(value, step);
}

function noop(): void {}
