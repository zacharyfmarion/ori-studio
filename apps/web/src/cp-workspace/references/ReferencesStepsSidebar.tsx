import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListOrdered } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import type { ReferencesCandidate, ReferencesRun, ReferencesTarget } from '../../store/workspaceStore/types';
import { candidateDiagram, stepDiagram } from './referenceFinderDiagramToPrimitives';
import { ReferencesBreakdownList } from './ReferencesBreakdownList';
import { ReferencesFindingsList } from './ReferencesFindingsList';
import type { ReferencesAnalysis } from './referencesAnalysis';
import type { ReferencesCandidateResult, ReferencesResults } from './referencesResults';
import { describeStep } from './referencesStepSentences';
import { StepDiagram } from './StepDiagram';
import type { ReferencesBreakdownController } from './useReferencesBreakdown';

/**
 * The References workspace's left sidebar, in its two modes.
 *
 * **Target mode**, after a vertex or crease pick: ReferenceFinder's ranked
 * answers as cards, and the selected candidate's steps as sentences with a
 * small diagram each.
 *
 * **Whole-pattern mode**, which it falls back to when nothing is picked: the
 * breakdown — rounds as sections, each round's steps collapsed by direction,
 * axiom and input pattern into one row with a count chip — followed by the
 * lines no exact fold reaches and the sheets the planner would not take.
 *
 * Fixed and non-draggable inside the panel, on the simulator's segments-sidebar
 * shape. Presentation only: what is shown and which row is active are props,
 * and a row press reports back.
 */
export interface ReferencesStepsSidebarProps {
  target: ReferencesTarget | null;
  candidates: readonly ReferencesCandidate[] | null;
  /** The constructions behind the cards, when they describe the current geometry. */
  results: ReferencesResults | null;
  activeCandidate: number;
  activeStep: number;
  status: ReferencesRun['status'];
  hint: string;
  warnings: readonly string[];
  onSelectCandidate: (index: number) => void;
  onSelectStep: (index: number) => void;
  /** Whole-pattern mode. */
  breakdown: ReferencesBreakdownController;
  analysis: ReferencesAnalysis | null;
}

export const ReferencesStepsSidebar = memo(function ReferencesStepsSidebar({
  target,
  candidates,
  results,
  activeCandidate,
  activeStep,
  status,
  hint,
  warnings,
  onSelectCandidate,
  onSelectStep,
  breakdown,
  analysis,
}: ReferencesStepsSidebarProps) {
  const { t } = useTranslation();
  const active = results?.candidates[activeCandidate] ?? null;
  const targeted = target !== null && target.kind !== 'whole';
  const showCandidates = targeted && candidates !== null && candidates.length > 0;
  const showBreakdown = !targeted;

  return (
    <aside
      className="references-sidebar"
      aria-label={t('panels:references.sidebar.label', 'Folding references')}
    >
      <div className="references-sidebar__header">
        <ListOrdered size={14} />
        <span className="panel-title">
          {showBreakdown
            ? t('panels:references.sidebar.breakdownTitle', 'Folding sequence')
            : t('panels:references.sidebar.title', 'Steps')}
        </span>
        {showCandidates && <span className="references-sidebar__count">{candidates.length}</span>}
        {showBreakdown && breakdown.record && (
          <span className="references-sidebar__count">{breakdown.flatSteps.length}</span>
        )}
      </div>

      {showBreakdown && !breakdown.record && !analysis && (
        <div className="references-sidebar__hint">
          <p>
            {status === 'running'
              ? t('panels:references.sidebar.planning', 'Working out the folding sequence…')
              : t(
                  'panels:references.sidebar.noPlan',
                  'Work out how to fold the whole pattern, or click a vertex or crease for one reference.'
                )}
          </p>
          {status !== 'running' && (
            <Button variant="primary" size="sm" onClick={breakdown.run}>
              {t('panels:references.sidebar.plan', 'Work out the folds')}
            </Button>
          )}
          {warnings.map((warning) => (
            <p key={warning} className="references-sidebar__warning">
              {warning}
            </p>
          ))}
        </div>
      )}

      {showBreakdown && breakdown.record && (
        <ReferencesBreakdownList
          components={breakdown.components}
          flatSteps={breakdown.flatSteps}
          activeStep={breakdown.activeStep}
          expandedRow={breakdown.expandedRow}
          onSelectStep={breakdown.selectStep}
          onSelectRow={breakdown.selectRow}
        />
      )}

      {/* The analysis stands on its own: `cp.analyzeReferences` opens this
          workspace and runs it without a breakdown, and its findings are the
          whole answer in that case. */}
      {showBreakdown && (breakdown.record !== null || analysis !== null) && (
        <ReferencesFindingsList
          record={breakdown.record}
          analysis={analysis}
          activeFinding={breakdown.activeFinding}
          onSelectFinding={breakdown.selectFinding}
        />
      )}

      {targeted && !showCandidates && (
        <div className="references-sidebar__hint">
          <p>
            {status === 'running'
              ? t('panels:references.sidebar.searching', 'Finding references…')
              : status === 'idle' && candidates?.length === 0
                ? t(
                    'panels:references.sidebar.none',
                    'ReferenceFinder found no construction for this target at the current settings.'
                  )
                : hint}
          </p>
          {warnings.map((warning) => (
            <p key={warning} className="references-sidebar__warning">
              {warning}
            </p>
          ))}
        </div>
      )}

      {showCandidates && (
        <ul
          className="references-list"
          role="listbox"
          aria-label={t('panels:references.sidebar.candidates', 'Candidate constructions')}
        >
          {candidates.map((candidate, index) => (
            <CandidateCard
              key={`${candidate.rank}-${index}`}
              candidate={candidate}
              result={results?.candidates[index] ?? null}
              index={index}
              selected={index === activeCandidate}
              onSelect={() => onSelectCandidate(index)}
            />
          ))}
        </ul>
      )}

      {showCandidates && active && (
        <ol
          className="references-steps"
          role="listbox"
          aria-label={t('panels:references.sidebar.steps', 'Folding steps')}
        >
          {active.solution.steps.map((step, index) => {
            const diagram = stepDiagram(active.raw, active.solution, index);
            return (
              <li key={index} className="references-steps__item">
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeStep}
                  className={`references-step${index === activeStep ? ' references-step--active' : ''}`}
                  onClick={() => onSelectStep(index)}
                >
                  <span className="references-step__number" aria-hidden="true">
                    {index + 1}
                  </span>
                  {diagram && <StepDiagram diagram={diagram} className="references-step__thumb" />}
                  <span className="references-step__text">{describeStep(t, step)}</span>
                </button>
              </li>
            );
          })}
          {active.solution.freeDiagonals.length > 0 && (
            <li className="references-steps__note">
              {t(
                'panels:references.sidebar.freeDiagonals',
                'Also needs the sheet diagonal(s): {{names}}.',
                {
                  names: active.solution.freeDiagonals
                    .map((name) =>
                      name === 'sw_ne'
                        ? t('panels:references.ref.diagonalSwNe', 'the bottom-left to top-right diagonal')
                        : t('panels:references.ref.diagonalNwSe', 'the top-left to bottom-right diagonal')
                    )
                    .join(', '),
                }
              )}
            </li>
          )}
        </ol>
      )}
    </aside>
  );
});

interface CandidateCardProps {
  candidate: ReferencesCandidate;
  result: ReferencesCandidateResult | null;
  index: number;
  selected: boolean;
  onSelect: () => void;
}

function CandidateCard({ candidate, result, index, selected, onSelect }: CandidateCardProps) {
  const { t } = useTranslation();
  const diagram = result ? candidateDiagram(result.raw, result.solution) : null;
  return (
    <li className="references-list__item">
      <button
        type="button"
        role="option"
        aria-selected={selected}
        aria-pressed={selected}
        className={`references-card${selected ? ' references-card--selected' : ''}`}
        onClick={onSelect}
        title={t('panels:references.card.title', 'Candidate {{n}}: {{folds}} folds, rank {{rank}}', {
          n: index + 1,
          folds: candidate.foldCount,
          rank: candidate.rank,
        })}
      >
        <span className="references-card__thumb">
          {diagram && <StepDiagram diagram={diagram} />}
        </span>
        <span className="references-card__meta">
          <span className="references-card__rank">
            {t('panels:references.card.rank', '#{{n}}', { n: index + 1 })}
          </span>
          <span className="references-card__folds">
            {t('panels:references.card.folds', {
              defaultValue_one: '{{count}} fold',
              defaultValue_other: '{{count}} folds',
              count: candidate.foldCount,
            })}
          </span>
          <Badge tone={candidate.exact ? 'accent' : 'neutral'}>
            {candidate.exact
              ? t('panels:references.exact', 'Exact')
              : t('panels:references.approximate', 'Approx.')}
          </Badge>
          {!candidate.exact && (
            <span className="references-card__error">
              {t('panels:references.card.error', 'err {{value}}', {
                value: candidate.err.toExponential(1),
              })}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
