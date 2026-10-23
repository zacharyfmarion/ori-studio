import { useTranslation } from 'react-i18next';
import { CopyPlus } from 'lucide-react';
import { LatchToggle } from '../../components/ui/LatchToggle';
import { setShiftLatched, useShiftLatched } from './shiftLatch';

/**
 * The on-screen half of {@link shiftLatch}.
 *
 * Named for what it does rather than for the key it stands in for. "Shift" is
 * meaningless on a device with no keyboard attached, and the one thing the latch
 * buys that a finger cannot otherwise have is a selection built from more than
 * one gesture — so that is what it says.
 *
 * Coarse-pointer only (`LatchToggle`), and there is no fine-pointer
 * counterpart: a keyboard already has this key, and a second way to hold it
 * would be one more piece of state that can disagree with the hardware.
 *
 * No teardown here on purpose. A convertible flipped out of tablet mode must
 * not leave a latch behind, but this component cannot be what notices: both of
 * its mount sites are coarse-gated too, so React removes it in the same commit
 * that would have told it the pointer changed. `isShiftLatched` owns that
 * invariant instead, and owns it for every reader rather than for whoever
 * happens to be mounted.
 */
export function CpShiftLatchToggle() {
  const { t } = useTranslation();
  const latched = useShiftLatched();
  return (
    <LatchToggle
      label={t('tools:cpRail.addToSelection', 'Add to selection')}
      icon={<CopyPlus size={14} aria-hidden="true" />}
      latched={latched}
      onToggle={setShiftLatched}
      fill
      data={{ 'data-shift-latch': '' }}
    />
  );
}
