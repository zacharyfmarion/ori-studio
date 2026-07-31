import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { bpTreeSymmetryRole, type BpTreeSymmetryPair } from '../../lib/bpTreeSymmetry';

/**
 * Declaring how the selected flaps sit in the mirror.
 *
 * The optimizer will only mirror a layout once every flap is accounted for, and
 * geometric inference from current positions only means anything in view mode.
 * Random mode discards those positions, so pairs have to be declared — including
 * for flaps that sit *on* the axis, which have no partner to pair with and are
 * recorded as a pair with themselves.
 */
export function BpSymmetryPairing({
  selectedVertexIds,
  pairs,
  onPair,
  onClear,
}: {
  selectedVertexIds: readonly number[];
  pairs: BpTreeSymmetryPair[];
  onPair: (vertexIds: readonly number[]) => void;
  onClear: (vertexIds: readonly number[]) => void;
}) {
  const { t } = useTranslation();
  const count = selectedVertexIds.length;
  if (count === 0 || count > 2) return null;

  const roles = selectedVertexIds.map((id) => bpTreeSymmetryRole(pairs, id));
  const anyDeclared = roles.some((role) => role !== null);

  return (
    <div className="bp-symmetry-pairing" role="group" aria-label={t('panels:bpSymmetry.title', 'Mirror pairing')}>
      <span className="bp-symmetry-pairing__label">
        {count === 1 && roles[0] === 'on-axis'
          ? t('panels:bpSymmetry.isOnAxis', 'On the mirror axis')
          : count === 1 && roles[0] === 'paired'
            ? t('panels:bpSymmetry.isPaired', 'Mirrored with another flap')
            : t('panels:bpSymmetry.title', 'Mirror pairing')}
      </span>
      <div className="bp-symmetry-pairing__actions">
        {count === 2 ? (
          <Button size="sm" variant="ghost" onClick={() => onPair(selectedVertexIds)}>
            {t('panels:bpSymmetry.pair', 'Mirror these two')}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => onPair(selectedVertexIds)}>
            {t('panels:bpSymmetry.onAxis', 'Place on the axis')}
          </Button>
        )}
        {anyDeclared && (
          <Button size="sm" variant="ghost" onClick={() => onClear(selectedVertexIds)}>
            {t('panels:bpSymmetry.clear', 'Clear')}
          </Button>
        )}
      </div>
    </div>
  );
}
