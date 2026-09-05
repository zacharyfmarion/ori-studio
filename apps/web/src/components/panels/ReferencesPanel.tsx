import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';

/**
 * The References workspace's dock panel: a composition site for the toolbar,
 * the crease-pattern view, the sidebar and the transport strip.
 *
 * This is the shell only. The view, the sidebar and the shortcut executor land
 * in the next steps of `implementation-plans/reference-finder-integration.md`;
 * until then the body reports either the simulator-style empty state or that
 * the view is pending. No keyboard handling lives here — the `references`
 * shortcut scope is the route (AGENTS.md > "Panel components").
 */
export function ReferencesPanel() {
  const { t } = useTranslation();
  const hasCreasePattern = useWorkspaceStore((state) => state.oristudioCpDocument !== null);

  return (
    <section className="panel-shell references-panel">
      <div className="panel-toolbar">
        <div className="panel-toolbar__group">
          <Compass size={14} />
          <span className="panel-title">{t('panels:references.title', 'References')}</span>
        </div>
      </div>
      <div className="panel-body references-panel__body">
        {hasCreasePattern ? (
          <div className="status-row">
            {t('panels:references.viewPending', 'The reference view is being built.')}
          </div>
        ) : (
          <div className="references-panel__empty">
            <span>
              {t(
                'panels:references.empty',
                'No crease pattern. Open or draw one in Edit, then come back.'
              )}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
