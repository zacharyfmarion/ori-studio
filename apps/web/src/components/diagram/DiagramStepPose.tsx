import { useTranslation } from 'react-i18next';
import { FlipHorizontal2, RotateCcw, RotateCw, Undo2, type LucideIcon } from 'lucide-react';
import type {
  DiagramPoseAction,
  DiagramPoseActionId,
} from '../../diagram/actions/diagramPoseActions';
import type { UploadPose } from '../../diagram/document/diagramDocument';
import { useKeepFocusWithin } from '../../hooks/useKeepFocusWithin';
import { Button } from '../ui/Button';
import { FieldRow } from '../ui/fieldRows';
import styles from './DiagramStepPose.module.css';

const ICONS: Record<DiagramPoseActionId, LucideIcon> = {
  'rotate-left': RotateCcw,
  'rotate-right': RotateCw,
  flip: FlipHorizontal2,
  reset: Undo2,
};

/**
 * The Step pane's Pose section, while the step is open in detail (D13): how
 * the uploaded picture is turned, and the verbs that turn it — the same ones
 * as the detail's toolbar, with their names.
 */
export function DiagramStepPose({
  pose,
  actions,
}: {
  pose: UploadPose;
  actions: readonly DiagramPoseAction[];
}) {
  const { t } = useTranslation();
  const [verbsRef, keepFocus] = useKeepFocusWithin<HTMLDivElement>();
  return (
    <div className={styles.pose}>
      <FieldRow label={t('panels:diagram.pose.rotation', 'Rotation')} kind="text">
        {t('panels:diagram.pose.degrees', '{{degrees}}° clockwise', {
          degrees: pose.rotationQuarterTurns * 90,
        })}
      </FieldRow>
      <FieldRow label={t('panels:diagram.pose.flipped', 'Flipped')} kind="text">
        {pose.mirrored ? t('panels:diagram.pose.yes', 'Yes') : t('panels:diagram.pose.no', 'No')}
      </FieldRow>
      <div ref={verbsRef} className={styles.verbs}>
        {actions.map((action) => {
          const Icon = ICONS[action.id];
          return (
            <Button
              key={action.id}
              size="sm"
              variant="ghost"
              disabled={action.disabled}
              title={action.hint}
              onClick={() => keepFocus(action.run)}
            >
              <Icon size={14} aria-hidden="true" />
              {action.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
