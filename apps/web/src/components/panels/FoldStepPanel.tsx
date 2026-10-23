import { FoldRepeatControls } from '../fold/repeat/FoldRepeatControls';
import { FoldImportSpread } from '../fold/orders/FoldImportSpread';
import { useTranslation } from 'react-i18next';
import { useFoldSequenceView } from '../../fold/sequence/useFoldSequenceView';
import { useFoldStepPane } from '../../fold/sequence/useFoldStepPane';
import { useFoldStepSpread } from '../../fold/sequence/useFoldStepSpread';
import { useFoldSession } from '../../fold/session/useFoldSession';
import { FoldCollapseControls } from '../fold/collapse/FoldCollapse';
import { FoldReturnControls } from '../fold/return/FoldReturnControls';
import { FoldStepPane } from '../fold/FoldStepPane';
import { Notice } from '../ui/Notice';
import styles from './FoldStepPanel.module.css';

/**
 * Fold's Step pane: what the step on show does — its kind, its layers, its
 * crease-pattern diff and its sentence — how its picture spreads its layers,
 * then the fold a tool is making (`implementation-plans/fold-workspace.md`,
 * D14).
 *
 * A composition site: the rows are `FoldStepPane`'s, their data
 * `useFoldStepPane`'s, from the same view of the sequence the strip and the
 * grid read. It reads the session without holding it — the Fold panel holds
 * it — and offers a retry when the replay stopped short.
 */
export function FoldStepPanel() {
  const { t } = useTranslation();
  const session = useFoldSession({ retain: false });
  const view = useFoldSequenceView();
  const pane = useFoldStepPane(view);
  const spread = useFoldStepSpread(view.entries[view.cursor]?.id ?? null, 'step_pane');
  return (
    <section className="panel-shell" aria-label={t('panels:sidePane.step', 'Step')}>
      <div className={`panel-body ${styles.body}`}>
        {view.failed && (
          <div className={styles.notice}>
            <Notice
              tone="danger"
              actions={[{ id: 'retry', label: t('panels:fold.sequence.retry', 'Try again'), run: session.retry }]}
            >
              {t('panels:fold.sequence.replayFailed', 'The steps could not all be folded.')}
            </Notice>
          </div>
        )}
        <FoldCollapseControls />
        <FoldReturnControls />
        <FoldRepeatControls />
        <FoldImportSpread atSheet={session.cursorId === null} />
        <FoldStepPane
          step={pane.step}
          pending={pane.pending}
          startSide={view.paper.startSide}
          branch={pane.branch}
          fixes={pane.fixes}
          spread={spread}
        />
      </div>
    </section>
  );
}
