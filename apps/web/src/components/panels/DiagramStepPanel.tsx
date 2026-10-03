import { useTranslation } from 'react-i18next';
import { useDiagramStepActions } from '../../diagram/useDiagramActions';
import { isLockedStep, stepIndex } from '../../diagram/document/diagramDocument';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { DiagramStepHeader } from '../diagram/DiagramStepHeader';
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

/**
 * The Step pane: the selected step's position, verbs and instruction.
 *
 * A composition site (AGENTS.md › Panel components): the verbs come from the
 * action catalog through `useDiagramStepActions`, and the rows are the shared
 * field rows. Later phases add the Picture, Render and Annotations sections
 * above the instruction as their features arrive, not as empty stubs.
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
  const actions = useDiagramStepActions(stepId);

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
