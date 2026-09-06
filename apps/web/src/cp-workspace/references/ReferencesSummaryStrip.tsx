import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/Badge';
import type { ReferencesPlanSummary } from '../../store/workspaceStore/types';

/**
 * The toolbar's summary of a breakdown: "N folds = M creases + K auxiliary
 * (J visible)", the lower bound, and what the exactness probe decided.
 *
 * The wording is load-bearing. The search is bounded, not exhaustive, so this
 * never says "minimum" and never implies one: it reports what was found, and
 * states the flat-sheet model's lower bound separately as the number a shorter
 * sequence would have to beat. When the two coincide it says so — "no
 * auxiliary folds needed" is a fact about this plan, not a claim about all
 * plans. (Implementation plan, "Honest statement".)
 */
export function ReferencesSummaryStrip({ summary }: { summary: ReferencesPlanSummary | null }) {
  const { t } = useTranslation();
  if (!summary) return null;
  const atLowerBound = summary.folds === summary.lowerBound;

  return (
    <span className="references-summary">
      <span className="references-summary__folds">
        {t(
          'panels:references.summary.folds',
          '{{folds}} folds = {{creases}} creases + {{aux}} auxiliary ({{visible}} visible)',
          {
            folds: summary.folds,
            creases: summary.cpLines,
            aux: summary.aux,
            visible: summary.visibleAux,
          }
        )}
      </span>
      <span className="references-summary__bound">
        {atLowerBound
          ? t('panels:references.summary.atLowerBound', 'no auxiliary folds needed')
          : t('panels:references.summary.lowerBound', 'lower bound {{n}}', {
              n: summary.lowerBound,
            })}
      </span>
      {summary.freeLines > 0 && (
        <span className="references-summary__free">
          {t('panels:references.summary.free', '{{n}} on the sheet edge', {
            n: summary.freeLines,
          })}
        </span>
      )}
      <ExactnessBadge summary={summary} />
      {summary.unsolved > 0 && (
        <Badge tone="neutral">
          {t('panels:references.summary.unsolved', '{{n}} not solved', { n: summary.unsolved })}
        </Badge>
      )}
      {summary.partial && summary.unsolved === 0 && (
        <Badge tone="neutral">{t('panels:references.summary.partial', 'Partial')}</Badge>
      )}
    </span>
  );
}

function ExactnessBadge({ summary }: { summary: ReferencesPlanSummary }) {
  const { t } = useTranslation();
  switch (summary.exactnessClass) {
    case 'snappable':
      return (
        <Badge tone="neutral">
          {t('panels:references.summary.snapped', 'Snapped, up to {{d}}', {
            d: summary.maxDisplacementModel.toPrecision(2),
          })}
        </Badge>
      );
    case 'off_lattice':
      return (
        <Badge tone="neutral">{t('panels:references.summary.offLattice', 'Off-lattice')}</Badge>
      );
    case 'exact':
      return <Badge tone="accent">{t('panels:references.exact', 'Exact')}</Badge>;
    default:
      return null;
  }
}
