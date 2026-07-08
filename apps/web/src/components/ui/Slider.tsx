interface SliderProps {
  id?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  'aria-label'?: string;
  className?: string;
}

/**
 * A range slider with an accent-colored fill up to the current value. Reads the
 * value synchronously in the change handler, so callers get a plain number
 * (no synthetic-event pooling pitfalls).
 */
export function Slider({
  id,
  min,
  max,
  step = 1,
  value,
  onChange,
  'aria-label': ariaLabel,
  className = '',
}: SliderProps) {
  const fillPercent = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      className={`ui-slider ${className}`.trim()}
      onChange={(event) => onChange(Number(event.target.value))}
      style={{
        background: `linear-gradient(to right, var(--accent-primary) 0% ${fillPercent}%, var(--border-subtle) ${fillPercent}% 100%)`,
      }}
    />
  );
}

Slider.displayName = 'Slider';
