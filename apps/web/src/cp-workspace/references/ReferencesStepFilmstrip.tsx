import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '../../components/ui/IconButton';
import type { ReferencesFilmstripStep } from './referencesFilmstrip';
import { StepDiagram } from './StepDiagram';

/**
 * The folding steps as a diagram, along the top of the workspace.
 *
 * One numbered card per step, a chevron at each end, and the active step's
 * sentence underneath — the shape ReferenceFinder's own app uses, and the shape
 * a printed origami diagram uses, which is the point: the sequence should read
 * left to right as instructions rather than as a list of rows.
 *
 * Selecting a step scrolls *the strip*, never the camera. Moving the crease
 * pattern under the reader on every step was the thing this replaced.
 *
 * Presentation only: the cards, which one is active and what a press means are
 * all props.
 */
export interface ReferencesStepFilmstripProps {
  steps: readonly ReferencesFilmstripStep[];
  activeStep: number;
  onSelectStep: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  /** Shown in place of the sentence when there are no steps yet. */
  placeholder: string;
  /**
   * A standing note under the caption, or empty.
   *
   * The sheet diagonals ReferenceFinder treats as free are the case this exists
   * for: they never appear as a step, but the folder still has to make them, so
   * a sequence that does not say so undercounts the folds.
   */
  note?: string;
  /**
   * The chevrons' labels, from the action catalog — the same strings the
   * context menu and the keymap show, so the three cannot name one verb three
   * ways.
   */
  previousLabel: string;
  nextLabel: string;
  /**
   * Whether each chevron is dead, from the same catalog the labels come from.
   *
   * Derived here once and it drifted: "is there a previous step" is one
   * question, and `buildReferencesActions` already answers it for the keymap and
   * the context menu (AGENTS.md > "One predicate per question").
   */
  previousDisabled: boolean;
  nextDisabled: boolean;
}

export const ReferencesStepFilmstrip = memo(function ReferencesStepFilmstrip({
  steps,
  activeStep,
  onSelectStep,
  onPrevious,
  onNext,
  placeholder,
  note,
  previousLabel,
  nextLabel,
  previousDisabled,
  nextDisabled,
}: ReferencesStepFilmstripProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLOListElement | null>(null);
  const activeRef = useRef<HTMLLIElement | null>(null);

  // Keep the active card in view however it was selected — a card press, a
  // chevron, the `references.nextStep` chord, or the transport strip.
  useEffect(() => {
    const card = activeRef.current;
    const list = listRef.current;
    if (!card || !list) return;
    // jsdom implements neither; the strip is correct without them.
    card.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [activeStep, steps]);

  const active = steps[activeStep] ?? null;

  return (
    <div className="references-filmstrip">
      <div className="references-filmstrip__strip">
        <IconButton
          size="sm"
          variant="toolbar"
          title={previousLabel}
          disabled={previousDisabled}
          onClick={onPrevious}
        >
          <ChevronLeft size={16} />
        </IconButton>
        <ol
          ref={listRef}
          className="references-filmstrip__list"
          aria-label={t('panels:references.filmstrip.label', 'Folding steps')}
        >
          {steps.map((step, index) => (
            <li
              key={step.key}
              ref={index === activeStep ? activeRef : undefined}
              className="references-filmstrip__item"
            >
              <button
                type="button"
                aria-current={index === activeStep ? 'step' : undefined}
                className={[
                  'references-card',
                  `references-card--${step.kind}`,
                  index === activeStep ? 'references-card--selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelectStep(index)}
                // Named by its number, described by its sentence: `title` loses
                // the accessible-name competition to the visible number and
                // becomes the description, which is what a screen reader should
                // read second. The sentence itself is on screen in the caption.
                title={step.sentence}
              >
                {step.number !== null && (
                  <span className="references-card__number">{step.number}</span>
                )}
                {step.badge !== '' && <span className="references-card__badge">{step.badge}</span>}
                <span className="references-card__thumb">
                  {step.diagram ? (
                    <StepDiagram diagram={step.diagram} size={100} />
                  ) : (
                    <StepDiagram primitives={step.primitives} size={100} mirrored={step.mirrored} />
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <IconButton
          size="sm"
          variant="toolbar"
          title={nextLabel}
          disabled={nextDisabled}
          onClick={onNext}
        >
          <ChevronRight size={16} />
        </IconButton>
      </div>
      <p className="references-filmstrip__caption">
        {active ? (
          <>
            {active.number !== null && (
              <span className="references-filmstrip__caption-number">{active.number}.</span>
            )}{' '}
            {active.sentence}
          </>
        ) : (
          <span className="references-filmstrip__caption-empty">{placeholder}</span>
        )}
        {note && <span className="references-filmstrip__note">{note}</span>}
      </p>
    </div>
  );
});
