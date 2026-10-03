import { useTranslation } from 'react-i18next';
import { useDiagramStepLink } from '../../diagram/capture/useStepLink';
import { useDiagramPoseActions, useDiagramStepActions } from '../../diagram/useDiagramActions';
import { isLockedStep, stepAsset, stepIndex } from '../../diagram/document/diagramDocument';
import type { SanitizeNotice } from '../../diagram/upload/svgSanitize';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { isDiagramAnnotating } from '../../store/workspaceStore/diagramState';
import { DiagramPatternPicker } from '../diagram/DiagramPatternPicker';
import { DiagramStepAnnotations } from '../diagram/DiagramStepAnnotations';
import { DiagramStepHeader } from '../diagram/DiagramStepHeader';
import { DiagramStepPicture } from '../diagram/DiagramStepPicture';
import { DiagramStepPose } from '../diagram/DiagramStepPose';
import { DiagramStepShowAs } from '../diagram/DiagramStepShowAs';
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
 * about (D19). In Annotate, Annotate's own section leads (D13): the tool in
 * hand, the list, and the selected annotation's controls; elsewhere the
 * Annotations section between the picture and the instruction counts them
 * and leads in.
 */
export function DiagramStepPanel() {
  const { t } = useTranslation();
  const stepId = useWorkspaceStore((state) => state.diagramSelectedStepId);
  const step = useWorkspaceStore((state) =>
    state.diagram && stepId !== null
      ? (state.diagram.steps.find((candidate) => candidate.id === stepId) ?? null)
      : null
  );
  const index = useWorkspaceStore((state) =>
    state.diagram && stepId !== null ? stepIndex(state.diagram, stepId) : -1
  );
  const count = useWorkspaceStore((state) => state.diagram?.steps.length ?? 0);
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

  if (!step || index < 0) {
    return (
      <section className="panel-shell">
        <div className={`panel-body ${styles.empty}`}>
          <p className={styles.emptyNote}>
            {count === 0
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
        number={index + 1}
        count={count}
        readOnly={readOnly}
        actions={actions}
        onMoveTo={(position) => moveStep(step.id, position - 1)}
        onStep={(direction) => {
          const next = useWorkspaceStore.getState().diagram?.steps[index + direction];
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
        {!locked && <DiagramStepShowAs actions={actions} />}
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
