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
  // it, so it has to go out with the button. A convertible flipped out of tablet
  // mode reports `fine` from that moment on, which unmounts this and leaves a
  // latch nobody can see or reach — every click on that fine-pointer session
  // additive, with no Shift key held. Same close-on-flip `useCpToolsTrigger`
  // does, and the teardown `resetShiftLatch` was written for.
  useEffect(() => resetShiftLatch, []);

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
