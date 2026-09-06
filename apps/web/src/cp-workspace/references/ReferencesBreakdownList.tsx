import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import type { ReferencesBreakdownComponent } from './useReferencesBreakdown';
import {
  flatIndexOf,
  type ReferencesBreakdownRow,
  type ReferencesBreakdownSection,
  type ReferencesFlatStep,
} from './referencesBreakdown';
import { plannerGroupDiagram, plannerStepDiagram } from './plannerStepToPrimitives';
import {
  describeAxiom,
  describeBreakdownRow,
  describePlannerStep,
  plannerRefIndex,
} from './referencesStepSentences';
import { StepDiagram } from './StepDiagram';

/**
 * The whole-pattern breakdown, as rounds of collapsed rows.
 *
 * Presentation only: what to show is `useReferencesBreakdown`'s, the grouping
 * is the crate's (`order.rs` already merged consecutive steps of one round,
 * direction, axiom and input pattern), and this renders the result. A row
 * carries a count chip and expands to its individual steps; an auxiliary row
 * says what it unlocks and whether the crease it leaves will show.
 */

export interface ReferencesBreakdownListProps {
  components: readonly ReferencesBreakdownComponent[];
  /** Sequences parallel to `components`, for sentences and thumbnails. */
  flatSteps: readonly ReferencesFlatStep[];
  activeStep: number;
  expandedRow: string | null;
  onSelectStep: (flatIndex: number) => void;
  onSelectRow: (rowId: string | null, firstFlatIndex: number | null) => void;
}

export const ReferencesBreakdownList = memo(function ReferencesBreakdownList({
  components,
  flatSteps,
  activeStep,
  expandedRow,
  onSelectStep,
  onSelectRow,
}: ReferencesBreakdownListProps) {
  const { t } = useTranslation();
  const active = flatSteps[activeStep] ?? null;
  const many = components.length > 1;

  return (
    <div className="references-breakdown">
      {components.map((entry, componentIndex) => (
        <section key={entry.component} className="references-breakdown__sheet">
          {many && (
            <h3 className="references-breakdown__sheet-title">
              {t('panels:references.breakdown.sheet', 'Sheet {{n}}', { n: componentIndex + 1 })}
            </h3>
          )}
          {entry.sections.map((section) => (
            <BreakdownSection
              key={`${entry.component}-${section.id}`}
              component={entry}
              componentIndex={componentIndex}
              section={section}
              flatSteps={flatSteps}
              activeComponent={active?.component ?? -1}
              activeStepIndex={active?.step ?? -1}
              expandedRow={expandedRow}
              onSelectStep={onSelectStep}
              onSelectRow={onSelectRow}
            />
          ))}
        </section>
      ))}
    </div>
  );
});

interface BreakdownSectionProps {
  component: ReferencesBreakdownComponent;
  componentIndex: number;
  section: ReferencesBreakdownSection;
  flatSteps: readonly ReferencesFlatStep[];
  activeComponent: number;
  activeStepIndex: number;
  expandedRow: string | null;
  onSelectStep: (flatIndex: number) => void;
  onSelectRow: (rowId: string | null, firstFlatIndex: number | null) => void;
}

function BreakdownSection({
  component,
  componentIndex,
  section,
  flatSteps,
  activeComponent,
  activeStepIndex,
  expandedRow,
  onSelectStep,
  onSelectRow,
}: BreakdownSectionProps) {
  const { t } = useTranslation();
  const sequence = component.sequence;
  const refIndex = useMemo(() => plannerRefIndex(sequence), [sequence]);
  const title =
    section.kind === 'landmarks'
      ? t('panels:references.breakdown.landmarks', 'Landmarks')
      : t('panels:references.breakdown.round', 'Round {{n}}', { n: section.round });

  return (
    <div className="references-breakdown__section">
      <div className="references-breakdown__section-header">
        <span>{title}</span>
        <span className="references-breakdown__section-count">
          {t('panels:references.breakdown.sectionCount', '{{n}} folds', { n: section.stepCount })}
        </span>
      </div>
      <ul className="references-breakdown__rows" role="listbox" aria-label={title}>
        {section.rows.map((row) => {
          const rowId = `${component.component}-${row.id}`;
          const stepIndexes = row.stepIds
            .map((id) => sequence.steps.findIndex((step) => step.id === id))
            .filter((index) => index >= 0);
          const firstFlat =
            stepIndexes.length > 0
              ? flatIndexOf(flatSteps, componentIndex, stepIndexes[0])
              : null;
          const containsActive =
            activeComponent === componentIndex && stepIndexes.includes(activeStepIndex);
          const expanded = expandedRow === rowId;
          return (
            <li key={rowId} className="references-breakdown__row-item">
              <button
                type="button"
                role="option"
                aria-selected={containsActive}
                aria-expanded={row.count > 1 ? expanded : undefined}
                className={`references-breakdown__row${containsActive ? ' references-breakdown__row--active' : ''}`}
                onClick={() =>
                  onSelectRow(row.count > 1 && !expanded ? rowId : null, firstFlat ?? null)
                }
              >
                <span className="references-breakdown__row-chevron" aria-hidden="true">
                  {row.count > 1 ? (
                    expanded ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )
                  ) : null}
                </span>
                <StepDiagram
                  primitives={plannerGroupDiagram(sequence, row.stepIds)}
                  className="references-step__thumb"
                />
                <span className="references-breakdown__row-text">
                  <span className="references-breakdown__row-title">
                    {describeBreakdownRow(t, row)}
                  </span>
                  <span className="references-breakdown__row-meta">
                    {describeAxiom(t, row.axiom)}
                    {row.kind === 'aux' && row.unlocks.length > 0 && (
                      <>
                        {' · '}
                        {t('panels:references.breakdown.unlocks', 'unlocks {{n}} folds', {
                          n: row.unlocks.length,
                        })}
                      </>
                    )}
                  </span>
                </span>
                <RowBadges row={row} />
              </button>
              {expanded && (
                <ol className="references-breakdown__steps">
                  {stepIndexes.map((stepIndex) => {
                    const flat = flatIndexOf(flatSteps, componentIndex, stepIndex);
                    const isActive =
                      activeComponent === componentIndex && activeStepIndex === stepIndex;
                    return (
                      <li key={stepIndex} className="references-steps__item">
                        <button
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          className={`references-step${isActive ? ' references-step--active' : ''}`}
                          onClick={() => onSelectStep(flat)}
                        >
                          <span className="references-step__number" aria-hidden="true">
                            {sequence.steps[stepIndex].id}
                          </span>
                          <StepDiagram
                            primitives={plannerStepDiagram(sequence, stepIndex)}
                            className="references-step__thumb"
                          />
                          <span className="references-step__text">
                            {describePlannerStep(t, sequence, refIndex, stepIndex)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RowBadges({ row }: { row: ReferencesBreakdownRow }) {
  const { t } = useTranslation();
  return (
    <span className="references-breakdown__row-badges">
      {row.count > 1 && <span className="references-breakdown__chip">{row.count}</span>}
      {row.kind === 'aux' && (
        <Badge tone={row.visible ? 'accent' : 'neutral'}>
          {row.pinched
            ? t('panels:references.breakdown.pinch', 'Pinch')
            : row.visible
              ? t('panels:references.breakdown.visible', 'Shows')
              : t('panels:references.breakdown.aux', 'Landmark')}
        </Badge>
      )}
    </span>
  );
}
