import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip';
import styles from './DiagramPoseResumeButton.module.css';

/**
 * Pose's play button over a step shown as Simulated that was saved before its
 * solver settled (`useDiagramSimulatedPose`'s `held`): the model shows still,
 * where it was saved, and this lets the solver go on from there.
 */
export function DiagramPoseResumeButton({ onResume }: { onResume: () => void }) {
  const { t } = useTranslation();
  const label = t('panels:diagram.pose.resumeSimulation', 'Resume simulation');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={styles.button} aria-label={label} onClick={onResume}>
          <Play size={22} className={styles.icon} aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
