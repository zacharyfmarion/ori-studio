import { useTranslation } from 'react-i18next';
import { CANVAS_COMPANION_PROPS } from '../../cp-workspace/canvasObjects/canvasCompanionSurface';
import { useSelectedCanvasObject } from '../../cp-workspace/canvasObjects/useSelectedCanvasObject';

/**
 * The Properties pane: the editable properties of the selected canvas object,
 * as a tab beside the View pane.
 *
 * A composition site (see AGENTS.md): it resolves the selection through
 * `useSelectedCanvasObject`, and hands the target to the sheet host. Everything
 * about *what* a kind offers lives in that kind's catalog under
 * `cp-workspace/<concern>/`. With nothing selected it says so, in one line.
 *
 * The root carries the companion attribute so a press in here neither blurs a
 * focused simulation window nor ends a text edit session, and `tabIndex={-1}`
 * so a click on its empty background yields a `relatedTarget` for the text
 * editor's blur rule to read, rather than `null` — which it takes as leaving.
 */
export function CpPropertiesPanel() {
  const { t } = useTranslation();
  const target = useSelectedCanvasObject();

  return (
    <section className="panel-shell cp-properties-panel" tabIndex={-1} {...CANVAS_COMPANION_PROPS}>
      <div className="panel-body cp-properties-panel__body">
        {target ? (
          // Replaced by the sheet host once the registry lands (Phase C).
          <span className="empty-note">{target.kind}</span>
        ) : (
          <span className="empty-note">
            {t('panels:cpProperties.empty', 'Select an object on the canvas to edit its properties.')}
          </span>
        )}
      </div>
    </section>
  );
}
