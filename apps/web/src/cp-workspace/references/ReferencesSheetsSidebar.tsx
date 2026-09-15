import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Shapes } from 'lucide-react';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { ReferencesFindingsList } from './ReferencesFindingsList';
import { ReferencesSheetGrid } from './ReferencesSheetGrid';
import type { ReferencesAnalysis } from './referencesAnalysis';
import type { ReferencesSheet } from './referencesSheets';
import type { PrecreaseComponent } from './sheetFrames';
import type { ReferencesBreakdownController } from './useReferencesBreakdown';

/**
 * The References workspace's left rail: which crease pattern the workspace is
 * working on, and what it has to say about it.
 *
 * On the Simulate workspace's shape (`SimulatorSegmentsSidebar`) — a fixed,
 * non-draggable column of thumbnails driving one selected id — because the
 * question is the same one: a document can hold several disjoint patterns and
 * only one of them is being folded right now.
 *
 * It stays mounted for a single sheet, where the simulator's hides itself. This
 * rail is also where the run affordance and the notes live, so hiding it would
 * leave both homeless; a lone row still says which sheet the workspace found
 * and whether it can be planned.
 *
 * On a phone it is the whole screen rather than a rail: the list the reader
 * picks a pattern from, with the detail behind a press (`useReferencesPhoneFlow`).
 * Same component, because it is the same list — the header, the cards and the
 * notes — and the stylesheet's phone block is what stretches it to the width
 * and grows the cards (`theme.css`, `.references-sidebar`).
 *
 * Under the pattern list it carries only the notes: what the frames analysis
 * warned about, and the lines no exact fold reaches. It deliberately does *not*
 * carry a second view of the sequence — the filmstrip above the canvas is where
 * the steps are read, and a rail that also listed them made the workspace two
 * things at once.
 *
 * Presentation only: what to show and which row is active are props, and a
 * press reports back.
 */
export interface ReferencesSheetsSidebarProps {
  sheets: readonly ReferencesSheet[];
  components: readonly PrecreaseComponent[];
  geometry: CpGeometryTransport | null;
  selected: number | null;
  onSelect: (component: number) => void;
  /** Whole-pattern mode's controller, for the run button and the findings. */
  breakdown: ReferencesBreakdownController;
  analysis: ReferencesAnalysis | null;
  busy: boolean;
  /** There is a crease pattern to answer for; without one there is nothing to run. */
  hasDocument: boolean;
  /** A vertex or crease is picked, so the whole-pattern affordances do not apply. */
  targeted: boolean;
  hint: string;
  warnings: readonly string[];
  /** A press on a finding in the notes. */
  onSelectFinding: (index: number | null) => void;
}

export const ReferencesSheetsSidebar = memo(function ReferencesSheetsSidebar({
  sheets,
  components,
  geometry,
  selected,
  onSelect,
  breakdown,
  analysis,
  busy,
  hasDocument,
  targeted,
  hint,
  warnings,
  onSelectFinding,
}: ReferencesSheetsSidebarProps) {
  const { t } = useTranslation();
  const planned = breakdown.record !== null;

  return (
    <aside
      className="references-sidebar"
      aria-label={t('panels:references.sheets.label', 'Crease patterns')}
    >
      <div className="references-sidebar__header">
        <Shapes size={14} />
        <span className="panel-title">{t('panels:references.sheets.title', 'Patterns')}</span>
        {sheets.length > 0 && <span className="references-sidebar__count">{sheets.length}</span>}
      </div>

      {sheets.length > 0 && geometry && (
        <ReferencesSheetGrid
          sheets={sheets}
          components={components}
          geometry={geometry}
          selected={selected}
          onSelect={onSelect}
        />
      )}

      <div className="references-sidebar__notes">
        {/* No "work it out" button here: the sequence is planned the moment
            the workspace is switched to it (`useReferencesAutoPlan`), and the
            lead under the toolbar carries the button when a plan was stopped
            or failed. Recompute in the toolbar is the way to ask again. */}
        {hasDocument && !targeted && !planned && busy && (
          <p className="references-sidebar__hint">
            {t('panels:references.sidebar.planning', 'Working out the folding sequence…')}
          </p>
        )}
        {hint && (planned || targeted) && <p className="references-sidebar__hint">{hint}</p>}
        {warnings.map((warning) => (
          <p key={warning} className="references-sidebar__warning">
            {warning}
          </p>
        ))}
        {(planned || analysis !== null) && (
          <ReferencesFindingsList
            record={breakdown.record}
            analysis={analysis}
            activeFinding={breakdown.activeFinding}
            onSelectFinding={onSelectFinding}
          />
        )}
      </div>
    </aside>
  );
});
