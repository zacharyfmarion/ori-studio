import { Grid3x3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';
import styles from './CpDetectGridSnapToggle.module.css';

/**
 * "Snap to grid" for a box-pleated detection.
 *
 * On, every crease of the pattern the dialog shows and adds that lies near the
 * grid lies exactly on it: the candidate's coordinates within a pixel and a
 * half of a grid line are moved onto it, and a solve that folds flat is
 * snapped only where it still folds flat. Offered only when the detection
 * reads a grid at all, so it never offers what it cannot do.
 *
 * A pressed toggle named with the grid it snaps to, so the reading can be
 * checked against the picture. `secondary`, like the buttons beside it,
 * because a pressed secondary button wears the accent fill and edge; `ghost`
 * gives `[data-active]` no look of its own, so on and off read the same.
 */
export function CpDetectGridSnapToggle({
  cells,
  snapping,
  disabled,
  onChange,
}: {
  /** Cells per paper edge of the grid the detection reads. */
  cells: number;
  snapping: boolean;
  disabled: boolean;
  onChange: (snapping: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      size="sm"
      variant="secondary"
      isActive={snapping}
      aria-pressed={snapping}
      disabled={disabled}
      onClick={() => onChange(!snapping)}
      data-cp-detect-grid-snap=""
    >
      <Grid3x3 size={14} aria-hidden="true" />
      {t('dialogs:cpDetectImport.snapToGrid', 'Snap to grid')}
      <span className={styles.size}>
        {t('dialogs:cpDetectImport.gridSize', '{{cells}} × {{cells}}', { cells })}
      </span>
    </Button>
  );
}
