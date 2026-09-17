import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Shapes } from 'lucide-react';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { SheetGrid, type SheetGridItem } from '../sheets/SheetGrid';
import { hasReferencesFindings, ReferencesFindingsList } from './ReferencesFindingsList';
import type { ReferencesAnalysis } from './referencesAnalysis';
import { sheetThumbnail, type ReferencesSheet } from './referencesSheets';
import type { PrecreaseComponent } from './sheetFrames';
import type { ReferencesBreakdownController } from './useReferencesBreakdown';

/**
 * The References workspace's left rail: which crease pattern the workspace is
 * working on, and what it has to say about it.
 *
 * The Simulate workspace's shape (`SimulatorSegmentsSidebar`) — a fixed,
 * non-draggable column of cards driving one selected id — because the question
 * is the same one: a document can hold several disjoint patterns and only one
 * of them is being folded right now. The cards themselves are shared
 * (`SheetGrid`); what this rail owns is its reading of the document into them.
 *
 * It stays mounted for a single sheet, where the simulator's hides itself: the
 * notes below have no other home, and a lone card still says which sheet the
 * workspace found and whether it can be planned.
 *
 * On a phone it is the whole screen rather than a rail: the list the reader
 * picks a pattern from, with the detail behind a press (`useReferencesPhoneFlow`).
 * Same component, because it is the same list — the header, the cards and the
 * notes — and the stylesheet's phone block is what stretches it to the width
 * and grows the cards (`theme.css`, `.references-sidebar` and `.sheet-grid`).
 *
 * Under the cards it carries notes, and only when there are any: what the
 * frames analysis warned about, the lines no exact fold reaches, and the
 * CP-wide analysis asked for from the menu. No hints — the lead under the
 * toolbar says how to ask and when the sequence is being worked out — and no
 * second view of the sequence: the filmstrip above the canvas is where the
 * steps are read, and a rail that also listed them made the workspace two
 * things at once. With nothing to note, the rail is the cards alone, as the
 * simulator's is.
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
  /** Whole-pattern mode's controller, for the findings and the active one. */
  breakdown: ReferencesBreakdownController;
  analysis: ReferencesAnalysis | null;
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
  warnings,
  onSelectFinding,
}: ReferencesSheetsSidebarProps) {
  const { t } = useTranslation();
  const findings = hasReferencesFindings(breakdown.record, analysis);
  // The rail's reading of the document, as the shared cards take it: a sheet's
  // component drawn into a thumbnail, and the refusal the planner gave it.
  const items = useMemo<SheetGridItem[]>(
    () =>
      geometry
        ? sheets.map((sheet) => {
            const component = components.find((entry) => entry.id === sheet.id) ?? null;
            return {
              id: sheet.id,
              thumbnail: component ? sheetThumbnail(geometry, component) : null,
              size: t('panels:references.sheets.creases', {
                defaultValue_one: '{{count}} crease',
                defaultValue_other: '{{count}} creases',
                count: sheet.creaseCount,
              }),
              refused: !sheet.plannable,
            };
          })
        : [],
    [sheets, components, geometry, t]
  );

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

      {items.length > 0 && <SheetGrid sheets={items} selected={selected} onSelect={onSelect} />}

      {/* No "work it out" button here: the sequence is planned the moment the
          workspace is switched to it (`useReferencesAutoPlan`), and the lead
          under the toolbar carries the button when a plan was stopped or
          failed. Recompute in the toolbar is the way to ask again. */}
      {(warnings.length > 0 || findings) && (
        <div className="references-sidebar__notes">
          {warnings.map((warning) => (
            <p key={warning} className="references-sidebar__warning">
              {warning}
            </p>
          ))}
          {findings && (
            <ReferencesFindingsList
              record={breakdown.record}
              analysis={analysis}
              activeFinding={breakdown.activeFinding}
              onSelectFinding={onSelectFinding}
            />
          )}
        </div>
      )}
    </aside>
  );
});
