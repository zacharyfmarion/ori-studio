import { useTranslation } from 'react-i18next';
import { stepById } from '../../diagram/document/diagramDocument';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { isDiagramAnnotating } from '../../store/workspaceStore/diagramState';
import { DiagramLayers } from '../diagram/DiagramLayers';
import styles from './DiagramLayersPanel.module.css';

/**
 * The Layers pane (Zach, 2026-10-05): what is drawn on the step open in
 * Annotate and the selected one's controls, a tab beside Step and Page — the
 * Diagram's Properties, brought forward when a mark is selected
 * (`useDiagramPaneReveal`).
 *
 * A composition site (AGENTS.md › Panel components): it finds the step and
 * hands it to `DiagramLayers`. Out of Annotate it says so, in one line.
 */
export function DiagramLayersPanel() {
  const { t } = useTranslation();
  const step = useWorkspaceStore((state) =>
    state.diagram && state.diagramSelectedStepId !== null && isDiagramAnnotating(state)
      ? stepById(state.diagram, state.diagramSelectedStepId)
      : null
  );

  return (
    <section className="panel-shell">
      {step ? (
        <div className="panel-body">
          <DiagramLayers step={step} />
        </div>
      ) : (
        <div className={`panel-body ${styles.empty}`}>
          <p className={styles.emptyNote}>
            {t('panels:diagram.layers.empty', 'Open a step in Annotate to see its layers.')}
          </p>
        </div>
      )}
    </section>
  );
}
