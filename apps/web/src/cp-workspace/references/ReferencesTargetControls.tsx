import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import type { ReferencesCandidateResult } from './referencesResults';

/**
 * What the row under the tabs says while one vertex or crease is picked: how
 * many folds the answer takes, at the left; which of ReferenceFinder's answers
 * is showing, how good it is, and the way back, at the right. Not *what* was
 * picked — a "Vertex" badge said nothing the mark on the sheet does not.
 *
 * The way back is the reason this is a component rather than three spans. A
 * pick used to be dismissed only by clicking bare paper, which nothing said and
 * nobody guessed; the workspace has two modes and the one you are in has to
 * carry its own exit. `Escape` does the same thing from the keyboard.
 */
export interface ReferencesTargetControlsProps {
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
  /**
   * One line where there is room for little else — a phone: the readout is
   * the numbers alone, and the way out is its icon with the words as its
   * name.
   */
  compact?: boolean;
}

export const ReferencesTargetControls = memo(function ReferencesTargetControls({
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
  compact = false,
}: ReferencesTargetControlsProps) {
  const { t } = useTranslation();
  const backLabel = t('panels:references.backToPattern', 'Back to the whole pattern');
  return (
    <div className="references-target">
      {active && (
        <span className="references-target__readout references-target__count">
          {t('panels:references.card.folds', {
            defaultValue_one: '{{count}} fold',
            defaultValue_other: '{{count}} folds',
            // The folds, not the steps: a mark is made by folding nothing.
            count: active.solution.foldCount,
          })}
        </span>
      )}
      <span className="references-target__actions">
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
              {compact
              ? t('panels:references.meta.solutionShort', '{{n}} / {{total}}', {
                  n: activeCandidate + 1,
                  total: candidateCount,
                })
              : t('panels:references.meta.solution', 'Solution {{n}} of {{total}}', {
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
          <Badge tone={active.solution.exact ? 'accent' : 'neutral'}>
            {active.solution.exact
              ? t('panels:references.exact', 'Exact')
              : t('panels:references.card.error', 'err {{value}}', {
                  value: active.solution.err.toExponential(1),
                })}
          </Badge>
        )}
        {/* The accent, not a quiet outline: this is the one way out of a pick,
          and it went unnoticed beside the badges it matched. */}
        <Button
        size="sm"
        variant="primary"
        onClick={onClear}
        aria-label={compact ? backLabel : undefined}
        title={compact ? backLabel : undefined}
      >
        <X size={12} aria-hidden="true" />
        {!compact && backLabel}
      </Button>
      </span>
    </div>
  );
});
