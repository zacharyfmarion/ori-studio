import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Shapes } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { ReferencesBreakdownList } from './ReferencesBreakdownList';
import { ReferencesFindingsList } from './ReferencesFindingsList';
import type { ReferencesAnalysis } from './referencesAnalysis';
import { sheetThumbnail, type ReferencesSheet } from './referencesSheets';
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
 * Under the pattern list it carries the sequence *outline* — the crate's own
 * grouping of consecutive steps that share a round, direction, axiom and input
 * pattern, so "seven parallel creases" is one row. The filmstrip above the
 * canvas shows every step in turn; this is the table of contents for it, and
 * the two drive the same active-step index.
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
  hint: string;
  warnings: readonly string[];
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
  hint,
  warnings,
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
        <ul
          className="references-sheets"
          role="listbox"
          aria-label={t('panels:references.sheets.label', 'Crease patterns')}
        >
          {sheets.map((sheet, index) => (
            <SheetCard
              key={sheet.id}
              sheet={sheet}
              index={index}
              component={components.find((entry) => entry.id === sheet.id) ?? null}
              geometry={geometry}
              selected={sheet.id === selected}
              onSelect={() => onSelect(sheet.id)}
            />
          ))}
        </ul>
      )}

      {planned && (
        <ReferencesBreakdownList
          components={breakdown.components}
          flatSteps={breakdown.flatSteps}
          activeStep={breakdown.activeStep}
          expandedRow={breakdown.expandedRow}
          onSelectStep={breakdown.selectStep}
          onSelectRow={breakdown.selectRow}
        />
      )}

      <div className="references-sidebar__notes">
        {!planned && (
          <div className="references-sidebar__hint">
            <p>
              {busy
                ? t('panels:references.sidebar.planning', 'Working out the folding sequence…')
                : t(
                    'panels:references.sheets.noPlan',
                    'Work out how to fold this pattern, or click a vertex or crease for one reference.'
                  )}
            </p>
            {!busy && (
              <Button variant="primary" size="sm" onClick={breakdown.run}>
                {t('panels:references.sidebar.plan', 'Work out the folds')}
              </Button>
            )}
          </div>
        )}
        {hint && planned && <p className="references-sidebar__hint">{hint}</p>}
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
            onSelectFinding={breakdown.selectFinding}
          />
        )}
      </div>
    </aside>
  );
});

interface SheetCardProps {
  sheet: ReferencesSheet;
  index: number;
  component: PrecreaseComponent | null;
  geometry: CpGeometryTransport;
  selected: boolean;
  onSelect: () => void;
}

function SheetCard({ sheet, index, component, geometry, selected, onSelect }: SheetCardProps) {
  const { t } = useTranslation();
  const thumbnail = useMemo(
    () => (component ? sheetThumbnail(geometry, component) : null),
    [component, geometry]
  );
  return (
    <li className="references-sheets__item">
      <button
        type="button"
        role="option"
        aria-selected={selected}
        className={`references-sheet${selected ? ' references-sheet--selected' : ''}${
          sheet.plannable ? '' : ' references-sheet--refused'
        }`}
        onClick={onSelect}
        title={t('panels:references.sheets.cardTitle', {
          defaultValue_one: 'Pattern {{n}}: {{count}} crease',
          defaultValue_other: 'Pattern {{n}}: {{count}} creases',
          n: index + 1,
          count: sheet.creaseCount,
        })}
      >
        <span className="references-sheet__thumb">
          {thumbnail && (
            <svg viewBox={thumbnail.viewBox} aria-hidden="true" className="references-sheet__svg">
              {thumbnail.strokes.map((stroke, i) => (
                <line
                  key={i}
                  className={`references-sheet__stroke references-sheet__stroke--${stroke.kind}`}
                  x1={stroke.x1}
                  y1={stroke.y1}
                  x2={stroke.x2}
                  y2={stroke.y2}
                />
              ))}
            </svg>
          )}
        </span>
        <span className="references-sheet__meta">
          <span className="references-sheet__index">{index + 1}</span>
          <span className="references-sheet__count">
            {t('panels:references.sheets.creases', {
              defaultValue_one: '{{count}} crease',
              defaultValue_other: '{{count}} creases',
              count: sheet.creaseCount,
            })}
          </span>
        </span>
      </button>
    </li>
  );
}
