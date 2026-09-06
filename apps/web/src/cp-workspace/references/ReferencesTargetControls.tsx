import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { IconButton } from '../../components/ui/IconButton';
import type { ReferencesTarget } from '../../store/workspaceStore/types';
import type { ReferencesCandidateResult } from './referencesResults';

/**
 * What the toolbar says while one vertex or crease is picked: which one, which
 * of ReferenceFinder's answers is showing, how good it is — and the way back.
 *
 * The way back is the reason this is a component rather than three spans. A
 * pick used to be dismissed only by clicking bare paper, which nothing said and
 * nobody guessed; the workspace has two modes and the one you are in has to
 * carry its own exit. `Escape` does the same thing from the keyboard.
 */
export interface ReferencesTargetControlsProps {
  target: ReferencesTarget;
  candidateCount: number;
  activeCandidate: number;
  active: ReferencesCandidateResult | null;
  onPreviousCandidate: () => void;
  onNextCandidate: () => void;
  onClear: () => void;
  /** From the action catalog, so the keymap and the menu agree with these. */
  previousLabel: string;
  nextLabel: string;
  previousDisabled: boolean;
  nextDisabled: boolean;
}

export const ReferencesTargetControls = memo(function ReferencesTargetControls({
  target,
  candidateCount,
  activeCandidate,
  active,
  onPreviousCandidate,
  onNextCandidate,
  onClear,
  previousLabel,
  nextLabel,
  previousDisabled,
  nextDisabled,
}: ReferencesTargetControlsProps) {
  const { t } = useTranslation();
  return (
    <div className="references-target">
      <Badge tone="accent">
        {target.kind === 'vertex'
          ? t('panels:references.meta.vertex', 'Vertex')
          : t('panels:references.meta.crease', 'Crease')}
      </Badge>
      {candidateCount > 0 && (
        <span className="references-target__candidates">
          <IconButton
            size="sm"
            variant="toolbar"
            title={previousLabel}
            disabled={previousDisabled}
            onClick={onPreviousCandidate}
          >
            <ChevronsLeft size={14} />
          </IconButton>
          <span className="references-target__readout">
            {t('panels:references.meta.solution', 'Solution {{n}} of {{total}}', {
              n: activeCandidate + 1,
              total: candidateCount,
            })}
          </span>
          <IconButton
            size="sm"
            variant="toolbar"
            title={nextLabel}
            disabled={nextDisabled}
            onClick={onNextCandidate}
          >
            <ChevronsRight size={14} />
          </IconButton>
        </span>
      )}
      {active && (
        <span className="references-target__readout">
          {t('panels:references.card.folds', {
            defaultValue_one: '{{count}} fold',
            defaultValue_other: '{{count}} folds',
            count: active.solution.steps.length + active.solution.freeDiagonals.length,
          })}
        </span>
      )}
      {active && (
        <Badge tone={active.solution.exact ? 'accent' : 'neutral'}>
          {active.solution.exact
            ? t('panels:references.exact', 'Exact')
            : t('panels:references.card.error', 'err {{value}}', {
                value: active.solution.err.toExponential(1),
              })}
        </Badge>
      )}
      <button type="button" className="references-target__exit" onClick={onClear}>
        <X size={12} aria-hidden="true" />
        {t('panels:references.backToPattern', 'Back to the whole pattern')}
      </button>
    </div>
  );
});
