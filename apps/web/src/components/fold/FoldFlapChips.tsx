import { useTranslation } from 'react-i18next';
import { CircleAlert } from 'lucide-react';
import type { FoldFlapChip } from '../../fold/tools/crossSection';
import { Chip } from '../ui/Chip';
import styles from './FoldFlapChips.module.css';

/**
 * A chip per flap at the fold line, pressed while the seed picks it: the
 * keyboard and touch path to picking flaps (plan D14), beside the layer
 * picker that shows where they lie. "Flap 2 · 2 layers", numbered as the
 * picker and the refusal's fixes number them. A flap a refusal says is in the
 * way carries the alert mark the notice explains.
 *
 * Space presses a chip; Enter is the workspace's, which commits the fold
 * (`data-fold-layer-pick`, `focusLeavesEnterToFold`), as the picker leaves it.
 */
export function FoldFlapChips({
  chips,
  disabled = false,
  onToggle,
  onHover,
}: {
  chips: readonly FoldFlapChip[];
  disabled?: boolean;
  onToggle: (flap: number) => void;
  onHover?: (flap: number | null) => void;
}) {
  const { t } = useTranslation();
  if (chips.length === 0) return null;
  return (
    <div
      className={styles.chips}
      role="group"
      aria-label={t('tools:fold.flap.groupLabel', 'Flaps to fold')}
      data-fold-layer-pick=""
    >
      {chips.map((chip) => (
        <Chip
          key={chip.flap}
          aria-pressed={chip.pressed}
          aria-label={chip.label}
          disabled={disabled}
          data-flap={chip.flap}
          onClick={() => onToggle(chip.flap)}
          onMouseEnter={() => onHover?.(chip.flap)}
          onMouseLeave={() => onHover?.(null)}
        >
          <span className={styles.content}>
            {chip.needed && <CircleAlert size={12} className={styles.needed} aria-hidden="true" />}
            <span>{chip.name}</span>
            <span className={styles.detail}>{chip.detail}</span>
          </span>
        </Chip>
      ))}
    </div>
  );
}
