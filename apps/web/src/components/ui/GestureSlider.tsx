/**
 * A slider whose drag is **one undo entry**.
 *
 * That protocol is the whole reason this is a component rather than a `<Slider>`
 * at each call site: the first `input` of a drag opens the gesture (the caller
 * snapshots its pre-state), and the native `change` event — fired once on
 * release, or per keyboard step, and which a pointer-up on a range thumb can
 * otherwise swallow — commits it. Written twice it would be right in one place
 * and forty-entries-per-drag in the other, with nothing to show for it until
 * someone pressed undo.
 *
 * It is unit-agnostic: `value`, `min`, `max` and `step` are whatever the caller
 * shows, and the caller converts (an annotation's 0–1 opacity is a 0–100 drag).
 * It began life as `AnnotationOpacitySlider`; the annotation toolbars, the
 * region chip's image menu and the Properties pane's rows all use this one.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Slider } from './Slider';

export interface GestureSliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  /** Per pointer move; the caller writes state and records nothing. */
  onChange: (value: number) => void;
  /**
   * Opens the caller's undo bracket. Answering `false` refuses the drag —
   * another surface holds the layer — and no value is written until the
   * next press; a caller that returns nothing is taken as consenting.
   */
  onGestureStart: () => boolean | void;
  /** Closes the snapshot. Takes the label so the caller names the edit. */
  onGestureCommit: (label: string) => void;
  /** History label for the whole drag. */
  commitLabel: string;
  disabled?: boolean;
  /** Accessible name, for a caller with no visible caption of its own. */
  'aria-label'?: string;
  className?: string;
}

export function GestureSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  onGestureStart,
  onGestureCommit,
  commitLabel,
  disabled = false,
  'aria-label': ariaLabel,
  className,
}: GestureSliderProps) {
  const sliderRef = useRef<HTMLInputElement | null>(null);
  const sessionRef = useRef(false);
  /** A press whose begin was refused writes nothing until the next press. */
  const refusedRef = useRef(false);
  // Held in a ref so the `change` listener below is attached once, on mount,
  // rather than re-attached whenever the caller passes a fresh closure — which
  // it does on every render, since these are usually inline arrows.
  const latest = useRef({ onGestureCommit, commitLabel });
  useEffect(() => {
    latest.current = { onGestureCommit, commitLabel };
  });

  useEffect(() => {
    const el = sliderRef.current;
    if (!el) return;
    const onCommit = () => {
      refusedRef.current = false;
      if (!sessionRef.current) return;
      sessionRef.current = false;
      latest.current.onGestureCommit(latest.current.commitLabel);
    };
    el.addEventListener('change', onCommit);
    return () => el.removeEventListener('change', onCommit);
  }, []);

  const handleInput = useCallback(
    (next: number) => {
      if (!sessionRef.current) {
        if (refusedRef.current) return;
        if (onGestureStart() === false) {
          // Refused for the rest of this press; the thumb snaps back to the
          // prop on the next render, and the native `change` on release
          // clears the refusal so the next press asks again.
          refusedRef.current = true;
          return;
        }
        sessionRef.current = true;
      }
      onChange(next);
    },
    [onGestureStart, onChange]
  );

  return (
    <Slider
      ref={sliderRef}
      className={className}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={handleInput}
      aria-label={ariaLabel}
    />
  );
}
