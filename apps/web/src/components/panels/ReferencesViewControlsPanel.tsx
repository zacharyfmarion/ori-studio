import { useTranslation } from 'react-i18next';
import { REFERENCES_CANDIDATE_COUNTS } from '../../store/workspaceStore/slices/referencesSlice';
import { useReferencesSettings } from '../../cp-workspace/references/useReferencesSettings';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { SelectRow, ToggleRow } from '../ui/fieldRows';

/**
 * Options pane for the References workspace, mirroring the Edit and Simulate
 * workspaces' view panes. Every setting the workspace has is a visible control
 * here — there is no popover — and each writes straight through to the store,
 * so a change reaches a running workspace the way it always did: the
 * per-target settings on the next query, the plan-shaping ones by re-planning
 * (`useReferencesBreakdown`), and "landmarks first" at once, since both orders
 * were computed when the plan landed.
 *
 * Two groups, the split the popover drew: what to ask ReferenceFinder for a
 * picked vertex or crease — always from the bare sheet — and how the
 * whole-pattern sequence is made.
 */
export function ReferencesViewControlsPanel() {
  const { t } = useTranslation();
  const {
    settings,
    setSettings,
    landmarksFirst,
    toggleLandmarksFirst,
    hasDocument,
    autoPlayFolds,
    setAutoPlayFolds,
  } = useReferencesSettings();

  if (!hasDocument) {
    return (
      <section className="panel-shell references-view-controls-panel">
        <div className="panel-body references-view-controls-panel__empty">
          <span className="empty-note">
            {t(
              'panels:references.settings.emptyNote',
              'Open a crease pattern to adjust how its references are found.'
            )}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="panel-shell references-view-controls-panel">
      <div className="panel-body references-view-controls-panel__body">
        <CollapsibleSection title={t('panels:references.settings.candidates', 'Candidates')}>
          <SelectRow
            label={t('panels:references.settings.solutions', 'Solutions')}
            value={String(settings.candidateCount)}
            options={REFERENCES_CANDIDATE_COUNTS.map((count) => ({
              id: String(count),
              label: String(count),
            }))}
            onChange={(value) => setSettings({ candidateCount: Number(value) })}
          />
          <ToggleRow
            label={t(
              'panels:references.settings.includeApproximate',
              'Include approximate solutions'
            )}
            checked={settings.includeApproximate}
            onChange={(checked) => setSettings({ includeApproximate: checked })}
          />
        </CollapsibleSection>

        <CollapsibleSection title={t('panels:references.settings.sequence', 'Precreasing sequence')}>
          <ToggleRow
            label={t('panels:references.settings.landmarksFirst', 'Landmarks first')}
            checked={landmarksFirst}
            onChange={toggleLandmarksFirst}
          />
          <ToggleRow
            label={t('panels:references.settings.precreaseGrid', 'Precrease grid')}
            checked={settings.precreaseGrid}
            onChange={(checked) => setSettings({ precreaseGrid: checked })}
          />
          <ToggleRow
            label={t('panels:references.settings.gridWhereNeeded', 'Only where needed')}
            checked={settings.gridWhereNeeded}
            disabled={!settings.precreaseGrid}
            nested
            onChange={(checked) => setSettings({ gridWhereNeeded: checked })}
          />
          <ToggleRow
            label={t('panels:references.settings.allowDangling', 'Allow dangling folds')}
            help={t(
              'panels:references.settings.allowDanglingHelp',
              'A dangling fold is a crease with an end on blank paper — nothing to stop at. On, each crease starts from a reference (the paper’s edge or a crease already made) and runs to a second one only when that adds no more crease than the crease itself. Off, every crease runs from reference to reference, however much extra crease that takes.'
            )}
            checked={settings.allowDanglingFolds}
            onChange={(checked) => setSettings({ allowDanglingFolds: checked })}
          />
          <ToggleRow
            label={t('panels:references.settings.mergeSymmetric', 'Merge symmetric steps')}
            help={t(
              'panels:references.settings.mergeSymmetricHelp',
              'Two folds that mirror each other — the left corner to the centre and the right corner to the centre, say — are shown as one step with an arrow for each, the way a diagram folds them. Off, every fold is a step of its own.'
            )}
            checked={settings.mergeSymmetricSteps}
            onChange={(checked) => setSettings({ mergeSymmetricSteps: checked })}
          />
          <ToggleRow
            label={t('panels:references.settings.autoPlayFolds', 'Auto-play folds')}
            help={t(
              'panels:references.settings.autoPlayFoldsHelp',
              'Play a step’s fold as soon as its card is reached. Off, the fold plays when you press Play or Space, and plays back when you press again.'
            )}
            checked={autoPlayFolds}
            onChange={setAutoPlayFolds}
          />
        </CollapsibleSection>
      </div>
    </section>
  );
}
