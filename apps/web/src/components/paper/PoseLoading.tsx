import { useTranslation } from 'react-i18next';
import { PictureLoading } from '../ui/PictureLoading';
import styles from './PoseLoading.module.css';

/** Covers only the model during startup, leaving step navigation available. */
export function PoseLoading() {
  const { t } = useTranslation();
  return (
    <div className={styles.veil} onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()} data-pose-loading="">
      <div className={styles.label} role="status">
        <PictureLoading />
        <span>{t('panels:diagram.pose.preparing', 'Preparing pose…')}</span>
      </div>
    </div>
  );
}
