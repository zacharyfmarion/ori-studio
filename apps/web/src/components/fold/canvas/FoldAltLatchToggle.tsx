import { useTranslation } from 'react-i18next';
import { Crosshair } from 'lucide-react';
import { setFoldAltLatched, useFoldAltLatched } from '../../../fold/canvas/foldAltLatch';
import { LatchToggle } from '../../ui/LatchToggle';

/**
 * The on-screen half of the Fold canvas's Alt latch (`foldAltLatch`): on a
 * touch screen, the next points go down where the finger lifts rather than
 * snapping to a landmark. Named for what it does, as Edit's Shift latch is,
 * since "Alt" means nothing without a keyboard. Coarse pointers only
 * (`LatchToggle`): a keyboard already has the key.
 */
export function FoldAltLatchToggle({ fill = false }: { fill?: boolean }) {
  const { t } = useTranslation();
  const latched = useFoldAltLatched();
  return (
    <LatchToggle
      label={t('tools:fold.latch.freePoint', 'Free point')}
      icon={<Crosshair size={14} aria-hidden="true" />}
      latched={latched}
      onToggle={setFoldAltLatched}
      fill={fill}
      data={{ 'data-fold-alt-latch': '' }}
    />
  );
}
