import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { FlipHorizontal2, RotateCcw, RotateCw, Undo2, type LucideIcon } from 'lucide-react';
import type {
  DiagramPoseAction,
  DiagramPoseActionId,
} from '../../diagram/actions/diagramPoseActions';
import type { DiagramLinkedPoseAction } from '../../diagram/actions/diagramLinkedPoseActions';
import { useOpenLinkedPose } from '../../diagram/capture/openLinkedPose';
import { isLockedStep, type DiagramStep } from '../../diagram/document/diagramDocument';
import { useKeepFocusWithin } from '../../hooks/useKeepFocusWithin';
import { Button } from '../ui/Button';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { FieldRow, NumberRow } from '../ui/fieldRows';
import { LINKED_POSE_ICONS } from './DiagramLinkedPoseControls';
import styles from './DiagramStepPose.module.css';

const ICONS: Record<DiagramPoseActionId, LucideIcon> = {
  'rotate-left': RotateCcw,
  'rotate-right': RotateCw,
  flip: FlipHorizontal2,
  'turn-over': FlipHorizontal2,
  reset: Undo2,
};

/** A verb as the section shows it: named, with its icon, waiting for a capture or not. */
interface PoseVerb {
  id: string;
  label: string;
  icon: LucideIcon;
  disabled: boolean;
  /** A capture of the step is running: refused, but holding the focus. */
  waiting?: boolean;
  hint?: string;
  run: () => void;
}

/**
 * The Step pane's Pose section, while the step is open in Pose (D13): how the
 * step's picture is posed, and the verbs that pose it — the same ones as the
 * detail's toolbar, with their names.
 *
 * - **An upload:** its turn and whether it is flipped.
 * - **A step sent from References:** which side of the paper it shows.
 * - **A linked pattern:** for a crease pattern or a flat fold, its turn as a
 *   field (D5's angle field), a flat fold's side and layer order. How it is
 *   shown is the Picture section's Show as row, in Pose or not (D19). Its verbs are the open step's own pose controller's
 *   (`useOpenLinkedPose`): one capture session per step, whichever surface
 *   the verb is pressed on.
 *
 * In a section of its own, or nothing for a step with nothing to pose.
 */
export function DiagramStepPose({
  step,
  actions,
}: {
  step: DiagramStep;
  /** An upload's or a References step's pose verbs (`useDiagramPoseActions`). */
  actions: readonly DiagramPoseAction[];
}) {
  const { t } = useTranslation();
  const [verbsRef, keepFocus] = useKeepFocusWithin<HTMLDivElement>();
  const linkedPose = useOpenLinkedPose(step.id);
  if (isLockedStep(step)) return null;
  const section = (body: ReactNode) => (
    <CollapsibleSection title={t('panels:diagram.stepPane.pose', 'Pose')}>
      <div className={styles.pose}>{body}</div>
    </CollapsibleSection>
  );

  const named = (action: DiagramPoseAction): PoseVerb => ({ ...action, icon: ICONS[action.id] });
  const verbs = (list: readonly PoseVerb[]) => (
    <div ref={verbsRef} className={styles.verbs}>
      {list.map((verb) => (
        <Button
          key={verb.id}
          size="sm"
          variant="ghost"
          disabled={verb.disabled}
          aria-disabled={verb.waiting || undefined}
          title={verb.hint}
          onClick={() => keepFocus(verb.run)}
        >
          <verb.icon size={14} aria-hidden="true" />
          {verb.label}
        </Button>
      ))}
    </div>
  );

  const { source } = step;
  if (source?.kind === 'upload') {
    return section(
      <>
        <FieldRow label={t('panels:diagram.pose.rotation', 'Rotation')} kind="text">
          {t('panels:diagram.pose.degrees', '{{degrees}}° clockwise', {
            degrees: source.rotationQuarterTurns * 90,
          })}
        </FieldRow>
        <FieldRow label={t('panels:diagram.pose.flipped', 'Flipped')} kind="text">
          {source.mirrored ? t('panels:diagram.pose.yes', 'Yes') : t('panels:diagram.pose.no', 'No')}
        </FieldRow>
        {verbs(actions.map(named))}
      </>
    );
  }

  if (source?.kind === 'references-step' && step.picture?.kind === 'step-diagram') {
    return section(
      <>
        <FieldRow label={t('panels:diagram.pose.side', 'Side')} kind="text">
          {sideName(step.picture.mirrored ? 'back' : 'front', t)}
        </FieldRow>
        {verbs(actions.map(named))}
      </>
    );
  }

  if (source?.kind !== 'cp' || !linkedPose) return null;
  const { render } = source;
  const linked = linkedPose.actions;
  const posing = linked
    .filter((action) => action.id !== 'show-crease-pattern' && action.id !== 'show-folded')
    .map((action): PoseVerb => ({ ...action, icon: LINKED_POSE_ICONS[action.id]! }));
  const turnable = render.mode !== 'folded-3d';
  const turnHeld = linked.find((action: DiagramLinkedPoseAction) => action.id === 'rotate-left')?.disabled ?? true;
  const waiting = linked.some((action) => action.waiting);
  return section(
    <>
      {turnable && (
        <NumberRow
          // A new field for each turn the step lands on: a draft never outlives it.
          key={render.rotationDeg}
          label={t('panels:diagram.pose.rotation', 'Rotation')}
          value={render.rotationDeg}
          min={0}
          max={359}
          step={15}
          suffix="°"
          // Held as the turn verbs are: on a diagram that cannot change, or while a capture runs.
          disabled={turnHeld || waiting}
          normalize={(degrees) => ((Math.round(degrees) % 360) + 360) % 360}
          onCommit={linkedPose.rotateTo}
        />
      )}
      {render.mode === 'folded-flat' && (
        <>
          <FieldRow label={t('panels:diagram.pose.side', 'Side')} kind="text">
            {sideName(render.side, t)}
          </FieldRow>
          <FieldRow label={t('panels:diagram.pose.layerOrder', 'Layer order')} kind="text">
            {render.foldCase}
          </FieldRow>
        </>
      )}
      {verbs(posing)}
    </>
  );
}

function sideName(side: 'front' | 'back', t: TFunction): string {
  return side === 'back'
    ? t('panels:diagram.pose.sideBack', 'From the back')
    : t('panels:diagram.pose.sideFront', 'From the front');
}
