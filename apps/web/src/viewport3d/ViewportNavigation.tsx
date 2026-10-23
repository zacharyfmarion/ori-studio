import { Move, Scan } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Toolbar } from '../components/ui/Toolbar';
import { IconButton } from '../components/ui/IconButton';
import styles from './ViewportNavigation.module.css';

export function ViewportNavigation({
  pan,
  onPan,
  onFit,
  disabled = false,
}: {
  pan: boolean;
  onPan: (pan: boolean) => void;
  onFit: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Toolbar className={styles.controls} aria-label={t('panels:viewport3d.navigation', 'View navigation')}>
      <IconButton
        size="sm"
        disabled={disabled}
        aria-pressed={pan}
        onClick={() => onPan(!pan)}
        aria-label={t('panels:viewport3d.pan', 'Pan view')}
        title={t('panels:viewport3d.pan', 'Pan view')}
      >
        <Move size={16} />
      </IconButton>
      <IconButton
        size="sm"
        disabled={disabled}
        onClick={onFit}
        aria-label={t('panels:viewport3d.fit', 'Fit view')}
        title={t('panels:viewport3d.fit', 'Fit view')}
      >
        <Scan size={16} />
      </IconButton>
    </Toolbar>
  );
}
