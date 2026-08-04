/**
 * Step through the fold-angle solutions for a vertex, and apply one.
 *
 * Shown only while the solve is in review — which is whenever there is a choice
 * to make. A single isolated answer is applied on the third pick and never
 * reaches here.
 *
 * The counter is deliberately absent for a family: "1 of 1" would say the answer
 * is unique when it is one point on a curve of equally valid ones. That case
 * gets a sentence instead.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/ui/Button';
import type { VertexSolveReview } from './vertexSolveReview';

export interface CpVertexSolveStepperProps {
  review: VertexSolveReview;
  steppable: boolean;
  onStep: (delta: number) => void;
  onApply: () => void;
  onCancel: () => void;
}

export function CpVertexSolveStepper({
  review,
  steppable,
  onStep,
  onApply,
  onCancel,
}: CpVertexSolveStepperProps) {
  const { t } = useTranslation(['tools', 'common']);
  return (
    <div className="cp-context-panel__group">
      <div className="cp-context-panel__group-title">
        {t('tools:cpContext.solveAngles.title', 'Fold angles')}
      </div>
      <div className="cp-vertex-solve__row">
        {steppable ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('tools:cpContext.solveAngles.previous', 'Previous solution')}
              onClick={() => onStep(-1)}
            >
              <ChevronLeft size={14} aria-hidden />
            </Button>
            <span className="cp-vertex-solve__count">
              {t('tools:cpContext.solveAngles.count', '{{index}} of {{total}}', {
                index: review.index + 1,
                total: review.count,
              })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('tools:cpContext.solveAngles.next', 'Next solution')}
              onClick={() => onStep(1)}
            >
              <ChevronRight size={14} aria-hidden />
            </Button>
          </>
        ) : (
          <span className="cp-vertex-solve__count">
            {t('tools:cpContext.solveAngles.single', 'One solution')}
          </span>
        )}
        <Button size="sm" variant="primary" onClick={onApply}>
          {t('tools:cpContext.solveAngles.apply', 'Apply')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('common:cancel', 'Cancel')}
        </Button>
      </div>
      {review.isCurrent ? (
        <p className="cp-vertex-solve__note">
          {t(
            'tools:cpContext.solveAngles.current',
            'This is what the vertex already does — step to see the alternative.'
          )}
        </p>
      ) : null}
      {review.isFamily ? (
        <p className="cp-vertex-solve__note">
          {t(
            'tools:cpContext.solveAngles.family',
            'These three creases leave one degree of freedom, so this is one of infinitely many answers — pick a different third crease for a definite one.'
          )}
        </p>
      ) : null}
    </div>
  );
}
