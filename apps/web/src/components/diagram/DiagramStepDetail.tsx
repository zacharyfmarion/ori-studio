import { useEffect, useMemo, useRef, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Compass,
  ImagePlus,
  Link2,
  Lock,
  PenTool,
  RotateCcw,
  RotateCw,
  RotateCcwSquare,
  Undo2,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import type {
  DiagramPoseAction,
  DiagramPoseActionId,
} from '../../diagram/actions/diagramPoseActions';
import {
  annotationsOutOfStep,
  isLockedStep,
  type DiagramAsset,
  type DiagramStep,
  type DiagramStyle,
} from '../../diagram/document/diagramDocument';
import { stepPictureSource } from '../../diagram/pictures/paintDiagramStep';
import { storedScene } from '../../diagram/pictures/pictureFrame';
import { annotatedStepUrl } from '../../diagram/pictures/useStepPictureUrl';
import type { AnnotateTool } from '../../diagram/annotate/annotateTools';
import type { DiagramDetailMode } from '../../store/workspaceStore/types';
import { useIsPhoneLayout } from '../../platform/phoneLayout';
import { knownCreasesOf } from '../../diagram/capture/captureCreases';
import type { DiagramLinkedPose } from '../../diagram/capture/useDiagramLinkedPose';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Toolbar } from '../ui/Toolbar';
import { useKeepFocusWithin } from '../../hooks/useKeepFocusWithin';
import { DiagramHistoryButtons } from './DiagramHistoryButtons';
import { DiagramLinkedPoseControls } from './DiagramLinkedPoseControls';
import { DiagramWayChooser } from './DiagramWayChooser';
import type { ReferencesStepWayChoice } from '../../diagram/references/useReferencesStepWays';
import { DiagramPose3dView } from './DiagramPose3dView';
import { DiagramPoseSimulatedView } from './DiagramPoseSimulatedView';
import type { DiagramPoseAnnotations } from './DiagramPoseStage';
import { DiagramAnnotateCanvas } from './DiagramAnnotateCanvas';
import { DiagramAnnotateRail } from './DiagramAnnotateRail';
import styles from './DiagramStepDetail.module.css';

const POSE_ICONS: Record<DiagramPoseActionId, LucideIcon> = {
  'rotate-left': RotateCcw,
  'rotate-right': RotateCw,
  // The sheet with a turn arrow Edit's folded figures flip with (`foldedFigureActionIcons`):
  // turning the paper over is not mirroring its shape.
  flip: RotateCcwSquare,
  'turn-over': RotateCcwSquare,
  reset: Undo2,
};

/** How much of an annotation shows in Pose: a ghost of where it is (D8). */
const POSE_ANNOTATION_OPACITY = 0.3;

/**
 * One step, large: the step detail, in Pose or Annotate.
 *
 * The top bar leads back to the list, walks the steps and switches between
 * Pose and Annotate. In Pose the picture fills what is left, its annotations
 * ghosted, posed by the toolbar under it; in Annotate it is the canvas,
 * Annotate's tools down its left (on a phone, a note to use a larger
 * screen). A step with no picture says so and offers the ways to give it
 * one; a newer build's step says it cannot be shown here.
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
  mode,
  onMode,
  annotateTool,
  onAnnotateTool,
  poseActions,
  linkedPose,
  ways = null,
  onBack,
  onStep,
  onUpload,
  patternOpen,
  onLink,
  onFromReferences,
  onGoToEdit,
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
  /** Pose or Annotate. */
  mode: DiagramDetailMode;
  onMode: (mode: DiagramDetailMode) => void;
  annotateTool: AnnotateTool;
  onAnnotateTool: (tool: AnnotateTool) => void;
  poseActions: readonly DiagramPoseAction[];
  /** A linked step's Pose: its verbs, and its live 3D view once folded. Null for any other step. */
  linkedPose: DiagramLinkedPose | null;
  /** A References step's ways to fold its card (D23), chosen in Pose's toolbar; null for none. */
  ways?: ReferencesStepWayChoice | null;
  onBack: () => void;
  /** Open the step before (-1) or after (1) this one. */
  onStep: (direction: -1 | 1) => void;
  /** Pick a picture for this step. Called from the click itself. */
  onUpload: () => void;
  /** A crease pattern is open, to link this step to or plan in References. */
  patternOpen: boolean;
  /** Choose this step's pattern: the picker, in the Step pane. */
  onLink: () => void;
  /** Ask References for this step's picture. */
  onFromReferences: () => void;
  /** Go to Edit, for a pattern to link to when none is open. */
  onGoToEdit: () => void;
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

  const phone = useIsPhoneLayout();
  const locked = isLockedStep(step);
  const source = useMemo(() => stepPictureSource(step, assets), [step, assets]);
  const { annotations } = step;
  const url = useMemo(
    () => (source ? annotatedStepUrl(source, annotations, style, POSE_ANNOTATION_OPACITY) : null),
    [source, annotations, style]
  );
  // Annotate needs a picture to draw on.
  const annotating = mode === 'annotate' && source !== null && !locked;
  // Over a live view (3D or simulated), the annotations drawn on its capture, while they are.
  const ghost = useMemo((): DiagramPoseAnnotations | null => {
    if (step.picture?.kind !== 'scene' || annotations.length === 0 || annotationsOutOfStep(step)) return null;
    const scene = storedScene(step.picture);
    return scene ? { annotations, bounds: scene.bounds } : null;
  }, [step, annotations]);
  const linked = !locked && step.source?.kind === 'cp' ? step.source : null;
  const picture = url && <img className={styles.picture} src={url} alt="" draggable={false} />;
  const title = t('panels:diagram.detail.title', 'Step {{number}} of {{total}}', { number, total: count });
  // The bar under the picture: a linked step's verbs, with `transport` (the
  // simulator's) between how it is shown and the rest, or an upload's.
  const poseToolbar = (transport: ReactNode) => (
    <Toolbar ref={poseRef} className={styles.pose} aria-label={t('panels:diagram.detail.pose', 'Pose')}>
      {linkedPose ? (
        <DiagramLinkedPoseControls actions={linkedPose.actions} layerOrder={linkedPose.layerOrder?.label ?? null} keep={keepPoseFocus}>
          {transport}
        </DiagramLinkedPoseControls>
      ) : (
        <>
          <DiagramWayChooser choice={ways} readOnly={readOnly} />
          {poseActions.map((action) => {
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
          })}
        </>
      )}
    </Toolbar>
  );

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
        <SegmentedControl<DiagramDetailMode>
          size="sm"
          aria-label={t('panels:diagram.detail.mode', 'Mode')}
          value={annotating ? 'annotate' : 'pose'}
          options={[
            { value: 'pose', label: t('panels:diagram.detail.pose', 'Pose') },
            {
              value: 'annotate',
              label: t('panels:diagram.detail.annotate', 'Annotate'),
              disabled: source === null || locked,
              // Why, as the step's own verb says it: a newer build's step is not changed here.
              tooltip: locked
                ? t(
                    'panels:diagram.actions.lockedEditHint',
                    'Made with a newer Ori Studio: it can be moved or deleted, not changed'
                  )
                : source === null
                  ? t('panels:diagram.detail.annotateNeedsPicture', 'Give the step a picture to annotate')
                  : undefined,
            },
          ]}
          onChange={onMode}
        />
        <div className="panel-toolbar__group">
          <DiagramHistoryButtons />
          <Button size="sm" variant="primary" onClick={onBack}>
            {t('panels:diagram.detail.done', 'Done')}
          </Button>
          <div className="panel-toolbar__pills" ref={drawerSlot} />
        </div>
      </div>
      {annotating ? (
        phone ? (
          <div className={styles.stage}>
            <div className={styles.message}>
              <p>{t('panels:diagram.annotate.largerScreen', 'Annotate on a larger screen: a tablet or a computer.')}</p>
            </div>
          </div>
        ) : (
          <div className={styles.annotate}>
            <DiagramAnnotateRail tool={annotateTool} readOnly={readOnly} onTool={onAnnotateTool} />
            <DiagramAnnotateCanvas step={step} assets={assets} style={style} readOnly={readOnly} />
          </div>
        )
      ) : (
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
        ) : linked?.render.mode === 'simulated' && linkedPose ? (
          <DiagramPoseSimulatedView
            // One simulator per step: another step loads its own.
            key={step.id}
            stepId={step.id}
            scope={linked.scope}
            known={knownCreasesOf(linked)}
            render={linked.render}
            style={style}
            annotations={ghost}
            onRest={linkedPose.simulate}
            wantsRest={linkedPose.wantsRest}
            fallback={picture}
            toolbar={poseToolbar}
          />
        ) : url || linkedPose ? (
          <>
            {linked?.render.mode === 'folded-3d' && linkedPose?.spatial ? (
              <DiagramPose3dView
                view={linkedPose.spatial}
                camera={linked.render.camera}
                style={style}
                onCamera={linkedPose.onCamera}
                ghost={ghost}
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
            {poseToolbar(null)}
          </>
        ) : (
          <div className={styles.message}>
            <ImagePlus size={22} aria-hidden="true" />
            <p>{t('panels:diagram.detail.noPicture', 'This step has no picture yet.')}</p>
            <div className={styles.sources}>
              <Button size="sm" variant="secondary" disabled={readOnly} onClick={onUpload}>
                <Upload size={14} aria-hidden="true" />
                {t('panels:diagram.actions.uploadPicture', 'Upload Picture…')}
              </Button>
              {patternOpen ? (
                <>
                  <Button size="sm" variant="secondary" disabled={readOnly} onClick={onLink}>
                    <Link2 size={14} aria-hidden="true" />
                    {t('panels:diagram.actions.linkPattern', 'Link Pattern…')}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={readOnly} onClick={onFromReferences}>
                    <Compass size={14} aria-hidden="true" />
                    {t('panels:diagram.actions.fromReferences', 'From References…')}
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={onGoToEdit}>
                  <PenTool size={14} aria-hidden="true" />
                  {t('panels:diagram.empty.goToEdit', 'Go to Edit')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
