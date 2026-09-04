/**
 * An annotation's opacity, as **one undo entry per adjustment**.
 *
 * That protocol is the whole reason this is a component rather than a `<Slider>`
 * at each call site: the first `input` of a drag snapshots the pre-state, and the
 * native `change` event — fired once on release, or per keyboard step, and which
 * a pointer-up on a range thumb can otherwise swallow — commits it. Written twice
 * it would be right in one place and forty-entries-per-drag in the other, with
 * nothing to show for it until someone pressed undo.
 *
 * `label` is the only thing callers differ on, because they differ on where the
 * control sits: `AnnotationActions` puts it on a floating toolbar with a visible
 * "Opacity" caption and a percentage beside it, while a dropdown item has room
 * for neither and needs the caption to be the accessible name instead.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Slider } from '../components/ui/Slider';

export interface AnnotationOpacitySliderProps {
  /** 0–1, as the annotation stores it. The slider itself works in percent. */
  opacity: number;
  onOpacity: (value: number) => void;
  onGestureStart: () => void;
  /** Closes the snapshot. Takes the label so the caller names the edit. */
  onGestureCommit: (label: string) => void;
  /** History label for the whole drag. */
  commitLabel: string;
  /** Accessible name, for a caller with no visible caption of its own. */
  label?: string;
  className?: string;
}

export function AnnotationOpacitySlider({
  opacity,
  onOpacity,
  onGestureStart,
  onGestureCommit,
  commitLabel,
  label,
  className,
}: AnnotationOpacitySliderProps) {
  const sliderRef = useRef<HTMLInputElement | null>(null);
  const sessionRef = useRef(false);
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
      if (!sessionRef.current) return;
      sessionRef.current = false;
      latest.current.onGestureCommit(latest.current.commitLabel);
    };
    el.addEventListener('change', onCommit);
    return () => el.removeEventListener('change', onCommit);
  }, []);

  const handleInput = useCallback(
    (percent: number) => {
      if (!sessionRef.current) {
        onGestureStart();
        sessionRef.current = true;
      }
      onOpacity(percent / 100);
    },
    [onGestureStart, onOpacity]
  );

  return (
    <Slider
      ref={sliderRef}
      className={className}
      min={0}
      max={100}
      value={Math.round(opacity * 100)}
      onChange={handleInput}
      aria-label={label}
    />
  );
}
