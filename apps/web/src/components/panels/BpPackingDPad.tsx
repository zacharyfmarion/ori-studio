import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import type { BpPackingNudgeDirection } from '../../lib/bpPackingContextMenu';
import styles from './BpPackingDPad.module.css';

const BP_DPAD_INITIAL_REPEAT_MS = 750;
const BP_DPAD_REPEAT_MS = 150;

/**
 * The packing canvas's nudge pad: four buttons that move the selected flaps or
 * device a grid step at a time, repeating while held. Shown on a touch screen
 * while there is something to nudge (`enabled`); a keyboard has the arrows.
 */
export function BpPackingDPad({
  enabled,
  onNudge,
}: {
  enabled: boolean;
  onNudge: (direction: BpPackingNudgeDirection) => boolean;
}) {
  const { t } = useTranslation();
  const repeatTimerRef = useRef<number | null>(null);
  const clearRepeat = useCallback(() => {
    if (repeatTimerRef.current !== null) {
      window.clearTimeout(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
  }, []);
  const startNudge = useCallback(
    (direction: BpPackingNudgeDirection) => {
      if (!enabled) return;
      clearRepeat();
      onNudge(direction);
      const repeat = () => {
        onNudge(direction);
        repeatTimerRef.current = window.setTimeout(repeat, BP_DPAD_REPEAT_MS);
      };
      repeatTimerRef.current = window.setTimeout(repeat, BP_DPAD_INITIAL_REPEAT_MS);
    },
    [clearRepeat, enabled, onNudge]
  );

  useEffect(() => clearRepeat, [clearRepeat]);
  useEffect(() => {
    window.addEventListener('blur', clearRepeat);
    return () => window.removeEventListener('blur', clearRepeat);
  }, [clearRepeat]);

  return (
    <div className={styles.root} data-enabled={enabled || undefined} aria-hidden={!enabled}>
      <DPadButton
        className={styles.up}
        direction="up"
        label={t('panels:bpPacking.nudgeUp', 'Nudge BP selection up')}
        disabled={!enabled}
        onStart={startNudge}
        onStop={clearRepeat}
      >
        <ArrowUp size={15} />
      </DPadButton>
      <DPadButton
        className={styles.left}
        direction="left"
        label={t('panels:bpPacking.nudgeLeft', 'Nudge BP selection left')}
        disabled={!enabled}
        onStart={startNudge}
        onStop={clearRepeat}
      >
        <ArrowLeft size={15} />
      </DPadButton>
      <DPadButton
        className={styles.right}
        direction="right"
        label={t('panels:bpPacking.nudgeRight', 'Nudge BP selection right')}
        disabled={!enabled}
        onStart={startNudge}
        onStop={clearRepeat}
      >
        <ArrowRight size={15} />
      </DPadButton>
      <DPadButton
        className={styles.down}
        direction="down"
        label={t('panels:bpPacking.nudgeDown', 'Nudge BP selection down')}
        disabled={!enabled}
        onStart={startNudge}
        onStop={clearRepeat}
      >
        <ArrowDown size={15} />
      </DPadButton>
    </div>
  );
}

function DPadButton({
  className,
  direction,
  label,
  disabled,
  onStart,
  onStop,
  children,
}: {
  className: string;
  direction: BpPackingNudgeDirection;
  label: string;
  disabled: boolean;
  onStart: (direction: BpPackingNudgeDirection) => void;
  onStop: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={className}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        onStart(direction);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        onStop();
      }}
      onPointerCancel={onStop}
      onPointerLeave={onStop}
    >
      {children}
    </button>
  );
}
