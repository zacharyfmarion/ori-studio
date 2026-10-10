import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagramPoseAction } from '../../diagram/actions/diagramPoseActions';
import type { DiagramLinkedPoseAction } from '../../diagram/actions/diagramLinkedPoseActions';
import { useOpenLinkedPose } from '../../diagram/capture/openLinkedPose';
import { isLockedStep, type DiagramStep } from '../../diagram/document/diagramDocument';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { useReferencesStepWays } from '../../diagram/references/useReferencesStepWays';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { DiagramSpreadRows } from './DiagramSpreadRows';
import { DiagramWayRow } from './DiagramWayChooser';
import { IconButton } from '../ui/IconButton';
import { FieldRow, NumberRow, SegmentedRow } from '../ui/fieldRows';
import styles from './DiagramStepPose.module.css';

/** A side to show, and the verb that turns the picture over to the other one. */
interface SideChoice {
  side: 'front' | 'back';
  /** Turn Over: absent where the picture has no other side to show. */
  turnOver: { disabled: boolean; waiting?: boolean; hint?: string; run: () => void } | undefined;
}

/**
 * The Step pane's Pose section, while the step is open in Pose (D13): how the
 * step's picture is posed. The verbs that pose it are the detail's toolbar's;
 * here are the facts, and the two a field says better than a button:
 *
 * - **An upload:** its turn and whether it is flipped.
 * - **A step sent from References:** which side of the paper it shows, Front
 *   or Back.
 * - **A linked pattern:** for a crease pattern or a flat fold, its turn as a
 *   field (D5's angle field); a fold's side, Front or Back; a flat fold's
 *   layer order and its spread layers (Phase 13): on or off, and while on,
 *   by depth or affine and how. Its verbs are the open step's own pose controller's
 *   (`useOpenLinkedPose`): one capture session per step, whichever surface
 *   asks. How it is shown is Show as, at the top of the pane (D19).
 *
 * Enlarged is not Pose's (Zach's review of #436, 2026-10-08): Pose draws an
 * enlarged step's frame, and Annotate's Step pane turns it on and sets it
 * (`DiagramStepEnlarged`).
 *
 * In a section of its own, or nothing for a step with nothing to say here.
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
  const linkedPose = useOpenLinkedPose(step.id);
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  // A References step's ways to fold its card (D23).
  const ways = useReferencesStepWays(step);
  if (isLockedStep(step)) return null;
  const section = (body: ReactNode) => (
    <CollapsibleSection title={t('panels:diagram.stepPane.pose', 'Pose')}>
      <div className={styles.pose}>{body}</div>
    </CollapsibleSection>
  );
  const sideRow = ({ side, turnOver }: SideChoice) => (
    <SegmentedRow
      label={t('panels:diagram.pose.side', 'Side')}
      value={side}
      options={[
        { id: 'front', label: t('panels:diagram.pose.front', 'Front') },
        { id: 'back', label: t('panels:diagram.pose.back', 'Back') },
      ]}
      disabled={!turnOver || turnOver.disabled}
      title={turnOver?.hint}
      onChange={(next) => {
        // Waiting for a capture, the choice refuses, as the verb would.
        if (next !== side && turnOver && !turnOver.waiting) turnOver.run();
      }}
    />
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
      </>
    );
  }

  if (source?.kind === 'references-step' && step.picture?.kind === 'step-diagram') {
    return section(
      <>
        <DiagramWayRow choice={ways} readOnly={readOnly} />
        {sideRow({
          side: step.picture.mirrored ? 'back' : 'front',
          turnOver: actions.find((action) => action.id === 'turn-over'),
        })}
      </>
    );
  }

  if (source?.kind !== 'cp' || !linkedPose) return null;
  const { render } = source;
  const linked = linkedPose.actions;
  const turn = render.mode === 'crease-pattern' || render.mode === 'folded-flat' ? render.rotationDeg : null;
  const turnHeld = linked.find((action: DiagramLinkedPoseAction) => action.id === 'rotate-left')?.disabled ?? true;
  const waiting = linked.some((action) => action.waiting);
  const turnOver = linked.find((action) => action.id === 'turn-over');
  const side = render.mode === 'folded-flat' || render.mode === 'folded-3d' ? render.side : null;
  if (turn === null && side === null) return null;
  return section(
    <>
      {turn !== null && (
        <NumberRow
          // A new field for each turn the step lands on: a draft never outlives it.
          key={turn}
          label={t('panels:diagram.pose.rotation', 'Rotation')}
          value={turn}
          min={0}
          max={359.9}
          step={15}
          suffix="°"
          // Held as the turn verbs are: on a diagram that cannot change, or while a capture runs.
          disabled={turnHeld || waiting}
          // Any angle, to a tenth of a degree (Zach, 2026-10-05): a 22.5° design stands at 157.5°.
          normalize={(degrees) => ((Math.round(degrees * 10) / 10) % 360 + 360) % 360}
          onCommit={linkedPose.rotateTo}
        />
      )}
      {side !== null && sideRow({ side, turnOver })}
      {render.mode === 'folded-flat' && (
        // Any layer order found, back or on (D23), as Pose's own pager has them.
        <FieldRow label={t('panels:diagram.pose.layerOrder', 'Layer order')} kind="text">
          <span className={styles.pager}>
            {layerVerb(linked.find((action) => action.id === 'previous-solution'), ChevronLeft)}
            <span className={styles.pagerLabel}>{linkedPose.layerOrder?.count ?? render.foldCase}</span>
            {layerVerb(linked.find((action) => action.id === 'next-solution'), ChevronRight)}
          </span>
        </FieldRow>
      )}
      {render.mode === 'folded-flat' && (
        // Its layers spread apart (Phase 13): on or off, by depth or affine (13g), and how.
        <DiagramSpreadRows toggle={linked.find((action) => action.id === 'spread-layers')} spread={linkedPose.spread} />
      )}
    </>
  );
}

/**
 * One of a flat fold's layer order verbs, as a small button: refused rather
 * than disabled, while a capture runs or at either end, so it keeps the focus
 * a press gave it.
 */
function layerVerb(action: DiagramLinkedPoseAction | undefined, Icon: LucideIcon): ReactNode {
  if (!action) return null;
  return (
    <IconButton
      size="sm"
      aria-label={action.label}
      title={(action.disabled || action.waiting) && action.hint ? action.hint : action.label}
      aria-disabled={action.disabled || action.waiting || undefined}
      onClick={action.run}
    >
      <Icon size={14} />
    </IconButton>
  );
}
