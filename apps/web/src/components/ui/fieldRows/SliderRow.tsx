import { GestureSlider } from '../GestureSlider';
import { FieldRow } from './FieldRow';

/**
 * A slider with a readout in a row, recording one undo entry per drag through
 * {@link GestureSlider}. A caller with nothing to record (an app-wide
 * preference) omits the gesture callbacks; the protocol stays uniform so a
 * renderer never has to know which rows are document edits.
 */
export function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  title,
  format,
  onChange,
  onGestureStart,
  onGestureCommit,
  commitLabel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  title?: string;
  /** The readout beside the thumb; defaults to the value with the step's decimals. */
  format?: (value: number) => string;
  onChange: (value: number) => void;
  onGestureStart?: () => void;
  onGestureCommit?: (label: string) => void;
  commitLabel?: string;
}) {
  return (
    <FieldRow label={label} kind="slider" disabled={disabled} title={title}>
      <GestureSlider
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={onChange}
        onGestureStart={onGestureStart ?? noop}
        onGestureCommit={onGestureCommit ?? noop}
        commitLabel={commitLabel ?? ''}
      />
      <span className="control-row__readout">{(format ?? defaultFormat(step))(value)}</span>
    </FieldRow>
  );
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
