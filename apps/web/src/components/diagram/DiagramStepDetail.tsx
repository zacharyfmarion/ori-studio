import { useEffect, useMemo, useRef, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FlipHorizontal2,
  ImagePlus,
  Lock,
  RotateCcw,
  RotateCw,
  Undo2,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import type {
  DiagramPoseAction,
  DiagramPoseActionId,
} from '../../diagram/actions/diagramPoseActions';
import {
  isLockedStep,
  type DiagramAsset,
  type DiagramStep,
  type DiagramStyle,
} from '../../diagram/document/diagramDocument';
import { stepPictureSource } from '../../diagram/pictures/paintDiagramStep';
import { stepPictureUrl } from '../../diagram/pictures/useStepPictureUrl';
import type { DiagramLinkedPose } from '../../diagram/capture/useDiagramLinkedPose';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Toolbar } from '../ui/Toolbar';
import { useKeepFocusWithin } from '../../hooks/useKeepFocusWithin';
import { DiagramHistoryButtons } from './DiagramHistoryButtons';
import { DiagramLinkedPoseControls } from './DiagramLinkedPoseControls';
import { DiagramPose3dView } from './DiagramPose3dView';
import styles from './DiagramStepDetail.module.css';

const POSE_ICONS: Record<DiagramPoseActionId, LucideIcon> = {
  'rotate-left': RotateCcw,
  'rotate-right': RotateCw,
  flip: FlipHorizontal2,
  'turn-over': FlipHorizontal2,
  reset: Undo2,
};

/**
 * One step, large: the step detail (Pose, for an upload).
 *
 * The top bar leads back to the list and walks the steps; the picture fills
 * what is left, posed by the toolbar under it. A step with no picture says so
 * and offers the ways to give it one; a newer build's step says it cannot be
 * shown here.
 *
 * Takes focus when it opens, so the keys that follow — Escape back to the
 * list, the arrows and `[` / `]` to the next step — have somewhere to start,
 * and a screen reader announces where it is.
 */
export function DiagramStepDetail({
  step,
  assets,
  style,
  number,
  count,
  readOnly,
  poseActions,
  linkedPose,
  onBack,
  onStep,
  onUpload,
  dropping,
  drawerSlot,
}: {
  step: DiagramStep;
  assets: Readonly<Record<string, DiagramAsset>>;
  /** The pens a captured picture is painted in. */
  style: DiagramStyle;
  /** 1-based. */
  number: number;
  count: number;
  readOnly: boolean;
  poseActions: readonly DiagramPoseAction[];
  /** A linked step's Pose: its verbs, and its live 3D view once folded. Null for any other step. */
  linkedPose: DiagramLinkedPose | null;
  onBack: () => void;
  /** Open the step before (-1) or after (1) this one. */
  onStep: (direction: -1 | 1) => void;
  /** Pick a picture for this step. Called from the click itself. */
  onUpload: () => void;
  /** A picture is being dragged over the Diagram. */
  dropping: boolean;
  /**
   * Where the touch layer seats the Step pane's pill (`viewDrawerSlot`): the
   * detail replaces the header that seats it in the list.
   */
  drawerSlot: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement | null>(null);
  const [poseRef, keepPoseFocus] = useKeepFocusWithin<HTMLDivElement>();
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  const locked = isLockedStep(step);
  const source = useMemo(() => stepPictureSource(step, assets), [step, assets]);
  const url = useMemo(() => (source ? stepPictureUrl(source, style) : null), [source, style]);
  const linked = !locked && step.source?.kind === 'cp' ? step.source : null;
  const picture = url && <img className={styles.picture} src={url} alt="" draggable={false} />;
  const title = t('panels:diagram.detail.title', 'Step {{number}} of {{total}}', { number, total: count });

  return (
    <div ref={root} className={styles.detail} role="region" aria-label={title} tabIndex={-1}>
      <div className={`panel-toolbar ${styles.bar}`}>
        <div className="panel-toolbar__group">
          <Button size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true" />
            {t('panels:diagram.detail.back', 'Steps')}
          </Button>
          <IconButton
            size="sm"
            title={t('panels:diagram.detail.previous', 'Previous Step')}
            disabled={number <= 1}
            onClick={() => onStep(-1)}
          >
            <ChevronLeft size={15} />
          </IconButton>
          <span className={styles.position}>{title}</span>
          <IconButton
            size="sm"
            title={t('panels:diagram.detail.next', 'Next Step')}
            disabled={number >= count}
            onClick={() => onStep(1)}
          >
            <ChevronRight size={15} />
          </IconButton>
        </div>
        <div className="panel-toolbar__group">
          <DiagramHistoryButtons />
          <Button size="sm" variant="primary" onClick={onBack}>
            {t('panels:diagram.detail.done', 'Done')}
          </Button>
          <div className="panel-toolbar__pills" ref={drawerSlot} />
        </div>
      </div>
      <div
        className={styles.stage}
        data-picture={(url !== null && !locked) || undefined}
        data-drop-target={dropping || undefined}
      >
        {locked ? (
          <div className={styles.message}>
            <Lock size={22} aria-hidden="true" />
            <p>
              {t(
                'panels:diagram.detail.locked',
                'This step was made with a newer Ori Studio and cannot be shown here.'
              )}
            </p>
          </div>
        ) : url || linkedPose ? (
          <>
            {linked?.render.mode === 'folded-3d' && linkedPose?.spatial ? (
              <DiagramPose3dView
                view={linkedPose.spatial}
                camera={linked.render.camera}
                style={style}
                onCamera={linkedPose.onCamera}
                fallback={url && picture}
              />
            ) : url ? (
              picture
            ) : (
              <div className={styles.message}>
                <p>
                  {t(
                    'panels:diagram.detail.notCaptured',
                    'Not captured yet: choose how to show its pattern below.'
                  )}
                </p>
              </div>
            )}
            <Toolbar
              ref={poseRef}
              className={styles.pose}
              aria-label={t('panels:diagram.detail.pose', 'Pose')}
            >
              {linkedPose ? (
                <DiagramLinkedPoseControls actions={linkedPose.actions} keep={keepPoseFocus} />
              ) : (
                poseActions.map((action) => {
                  const Icon = POSE_ICONS[action.id];
                  return (
                    <IconButton
                      key={action.id}
                      size="sm"
                      title={action.disabled && action.hint ? action.hint : action.label}
                      aria-label={action.label}
                      disabled={action.disabled}
                      onClick={() => keepPoseFocus(action.run)}
                    >
                      <Icon size={15} />
                    </IconButton>
                  );
                })
              )}
            </Toolbar>
          </>
        ) : (
          <div className={styles.message}>
            <ImagePlus size={22} aria-hidden="true" />
            <p>{t('panels:diagram.detail.noPicture', 'This step has no picture yet.')}</p>
            <Button size="sm" variant="secondary" disabled={readOnly} onClick={onUpload}>
              <Upload size={14} aria-hidden="true" />
              {t('panels:diagram.actions.uploadPicture', 'Upload Picture…')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
