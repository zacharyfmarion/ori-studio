import { useTranslation } from 'react-i18next';
import { useCreasePatternSide } from '../../diagram/capture/useCreasePatternSide';
import { useDiagramStepLink } from '../../diagram/capture/useStepLink';
import { useDiagramPoseActions, useDiagramStepActions, useDiagramTurn } from '../../diagram/useDiagramActions';
import {
  indexForStepNumber,
  isLockedStep,
  stepAsset,
  stepById,
  stepNumber,
  stepsOf,
} from '../../diagram/document/diagramDocument';
import type { SanitizeNotice } from '../../diagram/upload/svgSanitize';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { isDiagramAnnotating } from '../../store/workspaceStore/diagramState';
import { DiagramPatternPicker } from '../diagram/DiagramPatternPicker';
import { DiagramStepAnnotations } from '../diagram/DiagramStepAnnotations';
import { DiagramStepHeader } from '../diagram/DiagramStepHeader';
import { DiagramStepPicture } from '../diagram/DiagramStepPicture';
import { DiagramStepPose } from '../diagram/DiagramStepPose';
import { DiagramStepShowAs } from '../diagram/DiagramStepShowAs';
import { DiagramTurnPane } from '../diagram/DiagramTurnPane';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { TextAreaRow } from '../ui/fieldRows';
import { Notice } from '../ui/Notice';
import styles from './DiagramStepPanel.module.css';

/**
 * Longest instruction the field takes. A guard against a paste of something
 * that was never an instruction, not a format rule: a page shows five lines of
 * one, and a longer one is cut there with a notice (Phase 5).
 */
const INSTRUCTION_MAX_LENGTH = 1000;

const NO_NOTICES: readonly SanitizeNotice[] = [];

/**
 * The Step pane: the selected step's position, verbs and instruction.
 *
 * A composition site (AGENTS.md › Panel components): the verbs come from the
 * action catalog through `useDiagramStepActions`, and the rows are the shared
 * field rows. A linked step's Show as leads, the choice everything under it is
 * about (D19) — with, for a crease pattern, the side of the paper it is seen
 * from. In Annotate, Annotate's own section leads (D13): the Snap switch,
 * and a notice when the picture changed under the marks — the list and the
 * selected one's controls are the Layers pane's (`DiagramLayersPanel`);
 * elsewhere the Annotations section between the picture and the instruction
 * counts them and leads in.
 */
export function DiagramStepPanel() {
  const { t } = useTranslation();
  const stepId = useWorkspaceStore((state) => state.diagramSelectedStepId);
  const step = useWorkspaceStore((state) =>
    state.diagram && stepId !== null
      ? (stepById(state.diagram, stepId) ?? null)
      : null
  );
  // Its number and how many steps there are: turns between them have none (D22).
  const number = useWorkspaceStore((state) =>
    state.diagram && stepId !== null ? (stepNumber(state.diagram, stepId) ?? 0) : 0
  );
  const count = useWorkspaceStore((state) => (state.diagram ? stepsOf(state.diagram).length : 0));
  const entryCount = useWorkspaceStore((state) => state.diagram?.steps.length ?? 0);
  const turn = useDiagramTurn(stepId);
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const loadId = useWorkspaceStore((state) => state.diagramLoadId);
  const setStepText = useWorkspaceStore((state) => state.setDiagramStepText);
  const moveStep = useWorkspaceStore((state) => state.moveDiagramStep);
  const selectStep = useWorkspaceStore((state) => state.selectDiagramStep);
  const asset = useWorkspaceStore((state) =>
    state.diagram && step ? stepAsset(state.diagram, step) : null
  );
  const notices = useWorkspaceStore((state) =>
    asset ? (state.diagramPictureNotices[asset.id] ?? NO_NOTICES) : NO_NOTICES
  );
  const actions = useDiagramStepActions(stepId);
  const detailOpen = useWorkspaceStore((state) => state.diagramDetail !== null);
  const annotating = useWorkspaceStore(isDiagramAnnotating);
  const poseActions = useDiagramPoseActions(detailOpen ? stepId : null);
  const { link, patternOpen, capture, picker } = useDiagramStepLink(step);
  // Shown as its crease pattern: the side of the paper it is seen from, under Show as.
  const side = useCreasePatternSide(step);

  if (turn) {
    return (
      <section className="panel-shell">
        <div className="panel-body">
          <DiagramTurnPane
            turn={turn.turn}
            between={turn.between}
            actions={turn.actions}
            readOnly={turn.readOnly}
            onSet={turn.set}
          />
        </div>
      </section>
    );
  }

  if (!step || number === 0) {
    return (
      <section className="panel-shell">
        <div className={`panel-body ${styles.empty}`}>
          <p className={styles.emptyNote}>
            {entryCount === 0
              ? t('panels:diagram.stepPane.noSteps', 'Add a step to write its instruction here.')
              : t('panels:diagram.stepPane.noSelection', 'Select a step to edit it.')}
          </p>
        </div>
      </section>
    );
  }

  const locked = isLockedStep(step);
  return (
    <section className="panel-shell">
      <DiagramStepHeader
        number={number}
        count={count}
        readOnly={readOnly}
        actions={actions}
        onMoveTo={(position) => {
          const diagram = useWorkspaceStore.getState().diagram;
          if (diagram) moveStep(step.id, indexForStepNumber(diagram, step.id, position));
        }}
        onStep={(direction) => {
          // The step before or after, turns passed over.
          const diagram = useWorkspaceStore.getState().diagram;
          const next = diagram ? stepsOf(diagram)[number - 1 + direction] : undefined;
          if (next) selectStep(next.id);
        }}
      />
      <div className="panel-body">
        {locked && (
          <div className={styles.notice}>
            <Notice>
              {t(
                'panels:diagram.stepPane.lockedNotice',
                'This step was made with a newer Ori Studio. It can be moved or deleted here, and is saved exactly as it came.'
              )}
            </Notice>
          </div>
        )}
        {annotating && !locked && (
          <CollapsibleSection title={t('panels:diagram.stepPane.annotate', 'Annotate')}>
            <DiagramStepAnnotations step={step} />
          </CollapsibleSection>
        )}
        {!locked && <DiagramStepShowAs actions={actions} side={side} />}
        {detailOpen && !annotating && <DiagramStepPose step={step} actions={poseActions} />}
        {!locked && (
          <CollapsibleSection title={t('panels:diagram.stepPane.picture', 'Picture')}>
            <DiagramStepPicture
              step={step}
              asset={asset}
              notices={notices}
              actions={actions}
              link={link}
              patternOpen={patternOpen}
              capture={capture}
              detailOpen={detailOpen}
              picker={
                picker && (
                  <DiagramPatternPicker
                    sheets={picker.sheets}
                    selectedId={picker.selectedId}
                    busy={picker.busy}
                    showAs={picker.showAs}
                    onShowAs={picker.setShowAs}
                    onPick={picker.pick}
                    onCancel={picker.cancel}
                  />
                )
              }
            />
          </CollapsibleSection>
        )}
        {!annotating && !locked && (step.picture !== null || step.annotations.length > 0) && (
          <CollapsibleSection title={t('panels:diagram.stepPane.annotations', 'Annotations')}>
            <DiagramStepAnnotations step={step} />
          </CollapsibleSection>
        )}
        <CollapsibleSection title={t('panels:diagram.stepPane.instruction', 'Instruction')}>
          <TextAreaRow
            // One field per step: a draft never carries over to the next one.
            key={step.id}
            label={t('panels:diagram.stepPane.instructionLabel', 'Instruction')}
            labelHidden
            value={step.text}
            placeholder={t('panels:diagram.stepPane.instructionPlaceholder', 'Describe this step…')}
            rows={4}
            maxLength={INSTRUCTION_MAX_LENGTH}
            disabled={readOnly || locked}
            onCommit={(text, session) => setStepText(step.id, text, { loadId, session })}
          />
        </CollapsibleSection>
      </div>
    </section>
  );
}
