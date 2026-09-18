import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/Badge';
import type { ReferencesAnalysis, ReferencesAnalysisLine } from './referencesAnalysis';
import type { PrecreaseFinding } from './precreaseSequence';
import type { ReferencesPlanComponent, ReferencesPlanRecord } from './referencesResults';

/**
 * The two lists that are not a sequence: the lines a plan could not construct,
 * and the CP-wide analysis's verdict per line.
 *
 * Both exist because the honest answer to "how do I fold this?" is sometimes
 * "not this line". A finding is a line the plan left unfolded — nothing exact
 * or close enough reached it, or the run was stopped before it got there — with
 * ReferenceFinder's closest construction and its error beside it; a refused
 * sheet says why the planner would not take it. Selecting a row frames it on
 * the view, which is the only way to see *which* line is meant without naming
 * coordinates at the reader.
 */

export interface ReferencesFindingsListProps {
  record: ReferencesPlanRecord | null;
  analysis: ReferencesAnalysis | null;
  activeFinding: number | null;
  onSelectFinding: (index: number | null) => void;
}

/**
 * The plan's findings across its components, each with its approximation if
 * one was found — from the sheets whose findings were searched for one.
 */
function planFindings(record: ReferencesPlanRecord | null) {
  return (
    record?.components
      .filter((entry) => !stoppedShort(entry))
      .flatMap((entry) =>
        entry.result.sequence.findings.map((finding, index) => ({
          finding,
          approximate: entry.result.approximate.find((a) => a.finding === index) ?? null,
        }))
      ) ?? []
  );
}

/**
 * A sheet whose plan stopped rather than approximate more lines than a
 * sequence can carry. Its findings were never searched for a closest
 * construction — the search would have taken minutes to describe folds the
 * plan had already decided not to make — so a row per line would only say
 * nothing was found. The modal has already said why the plan stopped; the
 * rail lists nothing for such a sheet.
 */
function stoppedShort(entry: ReferencesPlanComponent): boolean {
  return entry.result.stopReason === 'too_many_approximations';
}

/**
 * Whether the list would draw anything at all. The rail mounts its notes only
 * then: a plan that constructed every line has nothing to report, and an
 * empty box under the cards read as a dead area.
 */
export function hasReferencesFindings(
  record: ReferencesPlanRecord | null,
  analysis: ReferencesAnalysis | null
): boolean {
  return (
    planFindings(record).length > 0 || (record?.refused.length ?? 0) > 0 || analysis !== null
  );
}

export const ReferencesFindingsList = memo(function ReferencesFindingsList({
  record,
  analysis,
  activeFinding,
  onSelectFinding,
}: ReferencesFindingsListProps) {
  const { t } = useTranslation();
  const findings = planFindings(record);
  const refused = record?.refused ?? [];

  return (
    <>
      {findings.length > 0 && (
        <section className="references-findings">
          <h3 className="references-findings__title">
            {t('panels:references.findings.title', 'Lines with no exact fold')}
          </h3>
          <p className="references-findings__note">
            {t(
              'panels:references.findings.note',
              'Not folded: no construction reached these within the plan\'s tolerance, or the plan stopped first. Beside each is the closest construction found.'
            )}
          </p>
          <ul className="references-findings__list" role="listbox">
            {findings.map(({ finding, approximate }, index) => (
              <li key={index}>
                <button
                  type="button"
                  role="option"
                  aria-selected={activeFinding === index}
                  className={`references-finding${activeFinding === index ? ' references-finding--active' : ''}`}
                  onClick={() => onSelectFinding(activeFinding === index ? null : index)}
                >
                  <span className="references-finding__title">{findingTitle(t, finding)}</span>
                  <span className="references-finding__meta">
                    {approximate
                      ? t(
                          'panels:references.findings.approximation',
                          'closest: {{folds}} folds, off by {{err}}',
                          {
                            folds: approximate.foldCount,
                            err: approximate.err.toExponential(1),
                          }
                        )
                      : t('panels:references.findings.noApproximation', 'no construction found')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {refused.length > 0 && (
        <section className="references-findings">
          <h3 className="references-findings__title">
            {t('panels:references.findings.refusedTitle', 'Sheets left out')}
          </h3>
          <ul className="references-findings__list">
            {refused.map((entry) => (
              <li key={entry.component} className="references-finding references-finding--static">
                <span className="references-finding__title">
                  {t('panels:references.breakdown.sheetId', 'Sheet {{n}}', {
                    n: entry.component + 1,
                  })}
                </span>
                <span className="references-finding__meta">{refusalText(t, entry.kind)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {analysis && (
        <section className="references-findings">
          <h3 className="references-findings__title">
            {t('panels:references.analysis.title', 'Reference analysis')}
          </h3>
          <p className="references-findings__note">
            {t(
              'panels:references.analysis.summary',
              '{{closure}} of {{lines}} lines fold from the sheet itself; {{queried}} needed a search.',
              {
                closure: analysis.summary.closure,
                lines: analysis.summary.lines,
                queried:
                  analysis.summary.exact + analysis.summary.approximate + analysis.summary.unsolved,
              }
            )}
          </p>
          <ul className="references-findings__list">
            {analysis.lines
              .filter((line) => line.verdict.kind !== 'closure')
              .map((line, index) => (
                <li key={index} className="references-finding references-finding--static">
                  <span className="references-finding__title">
                    {t('panels:references.analysis.line', 'Line {{n}}', { n: index + 1 })}
                  </span>
                  <span className="references-finding__meta">{verdictText(t, line)}</span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </>
  );
});

type Translate = ReturnType<typeof useTranslation>['t'];

function findingTitle(t: Translate, finding: PrecreaseFinding): string {
  return finding.reason === 'off_lattice'
    ? t('panels:references.findings.offLattice', 'Off the lattice')
    : t('panels:references.findings.unsolved', 'No construction found');
}

function refusalText(t: Translate, kind: string | null): string {
  switch (kind) {
    case 'non_rectangular':
      return t('panels:references.nonRectangular', 'This sheet is not a rectangle. References can only be found on rectangular sheets for now.');
    case 'open_outline':
      return t('panels:references.openOutline', 'The border creases around this pick do not close into a sheet.');
    default:
      return t('panels:references.refusedSheet', 'The sheet around this pick could not be read as a rectangle.');
  }
}

function verdictText(t: Translate, line: ReferencesAnalysisLine): string {
  switch (line.verdict.kind) {
    case 'closure':
      return t('panels:references.analysis.closure', 'folds from the sheet itself');
    case 'exact':
      return t('panels:references.analysis.exact', 'exact at rank {{rank}}, {{folds}} folds', {
        rank: line.verdict.rank,
        folds: line.verdict.foldCount,
      });
    case 'approximate':
      return t('panels:references.analysis.approximate', 'approximate, off by {{err}}', {
        err: line.verdict.err.toExponential(1),
      });
    case 'error':
      return line.verdict.message;
    default:
      return t('panels:references.analysis.unsolved', 'no construction found');
  }
}

/** The analysis summary strip, beside the plan's own. */
export function ReferencesAnalysisBadge({ analysis }: { analysis: ReferencesAnalysis }) {
  const { t } = useTranslation();
  const hard = analysis.summary.approximate + analysis.summary.unsolved;
  return (
    <Badge tone={hard > 0 ? 'neutral' : 'accent'}>
      {t('panels:references.analysis.badge', '{{closure}}/{{lines}} from the sheet', {
        closure: analysis.summary.closure,
        lines: analysis.summary.lines,
      })}
    </Badge>
  );
}
