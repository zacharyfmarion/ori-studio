import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyPlus } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';
import { resetShiftLatch, setShiftLatched, useShiftLatched } from './shiftLatch';

/**
 * The on-screen half of {@link shiftLatch}.
 *
 * Named for what it does rather than for the key it stands in for. "Shift" is
 * meaningless on a device with no keyboard attached, and the one thing the latch
 * buys that a finger cannot otherwise have is a selection built from more than
 * one gesture — so that is what it says.
 *
 * Coarse-pointer only, and there is no fine-pointer counterpart: a keyboard
 * already has this key, and a second way to hold it would be one more piece of
 * state that can disagree with the hardware.
 */
export function CpShiftLatchToggle() {
  const { t } = useTranslation();
  const coarsePointer = useIsCoarsePointerSurface();
  const latched = useShiftLatched();

  // The latch is module state and this button is the only thing that can clear
  // it, so a convertible flipped out of tablet mode must not leave one behind:
  // it reports `fine` from that moment on, and a latch nobody can see or reach
  // makes every click of that session additive with no Shift key held.
  //
  // Keyed on the flip, not on unmount. As an unmount cleanup this was correct on
  // a tablet, where the button lives in the rail for as long as the rail does,
  // and useless on a phone, where its only mount site is inside the tool sheet —
  // so closing the sheet cleared the latch and there was no path where it was on
  // while a finger was on the canvas. Measured: toggled on, closed via the X,
  // reopened, and it read `false` again.
  useEffect(() => {
    if (!coarsePointer) resetShiftLatch();
  }, [coarsePointer]);

  if (!coarsePointer) return null;

  return (
    <Button
      size="md"
      variant="ghost"
      className="cp-tool-rail__latch"
      aria-pressed={latched}
      isActive={latched}
      onClick={() => setShiftLatched(!latched)}
    >
      <CopyPlus size={14} aria-hidden="true" />
      {t('tools:cpRail.addToSelection', 'Add to selection')}
    </Button>
  );
}
