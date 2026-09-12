import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
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
 * **Windowed.** Each card draws every crease made up to its own step, so a
 * card costs about (its index / step count) of the whole pattern and the strip
 * as a whole costs about half of *steps × creases* — quadratic in plan length.
 * Measured over the corpus that is 219,617 SVG elements and 717 ms at p90, and
 * 705,595 elements and 2.66 s at p99, for a strip of which a dozen cards are
 * ever on screen. So only the cards in view are mounted, and the rest cost
 * nothing until they are scrolled to.
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
   * Whether the chevrons are here at all. On the phone they are not — a touch
   * target either side of a 375px strip left room for barely one card — and
   * the stepping leads the floating bar instead (`ReferencesViewportToolbar`).
   * The strip is then the cards alone, edge to edge.
   */
  navigation?: boolean;
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

/**
 * A card's width plus the gap after it, in CSS pixels — `.references-card`'s
 * own width and `.references-filmstrip__item`'s trailing padding.
 *
 * Only the estimate: every mounted card is measured, so this decides the
 * scrollbar before the first measurement and nothing after it.
 */
const CARD_STRIDE_PX = 136;

export const ReferencesStepFilmstrip = memo(function ReferencesStepFilmstrip({
  steps,
  activeStep,
  onSelectStep,
  onPrevious,
  onNext,
  placeholder,
  note,
  previousLabel,
  navigation = true,
  nextLabel,
  previousDisabled,
  nextDisabled,
}: ReferencesStepFilmstripProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);

  // React Compiler cannot memoize a component that uses `useVirtualizer`, so
  // this one re-renders on every scroll frame. Nothing below it is expensive:
  // a card is a `StepDiagram`, which is pure and keyed by step.
  const virtualizer = useVirtualizer({
    horizontal: true,
    count: steps.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => CARD_STRIDE_PX,
    // By step key, not index: a recompute reorders the strip, and a card that
    // is still the same step should not be remounted — and so redrawn — just
    // because the steps before it changed.
    getItemKey: (index) => steps[index]?.key ?? index,
    overscan: 4,
  });

  // Keep the active card in view however it was selected — a card press, a
  // chevron, the `references.nextStep` chord, or the transport strip.
  //
  // And keep DOM focus on it, so there is one highlighted card rather than two.
  // Clicking focuses a card as well as selecting it, while the arrow chords go
  // through the focus-independent shortcut runtime and only select — so the
  // browser's own focus ring stayed on the last card clicked while the
  // selection moved away from it, in a different colour. Worse than untidy: the
  // stale card was still the Enter/Space target, so activating it snapped the
  // selection backwards.
  //
  // Only when the strip already owns focus. Moving it unconditionally would
  // pull focus off the canvas every time the active step changes for a reason
  // that is not the reader's keystroke — a fresh plan resets it to 0.
  useEffect(() => {
    const list = listRef.current;
    if (!list || steps.length === 0) return;
    virtualizer.scrollToIndex(activeStep, { align: 'center' });
    if (!list.contains(document.activeElement)) return;
    // Found by its marker rather than held in a ref: windowed, the active card
    // may have been mounted by the line above and there was nothing to hold.
    // The scroll is already under way; `focus()` would jump-scroll first.
    list
      .querySelector<HTMLButtonElement>('button.references-card[aria-current="step"]')
      ?.focus({ preventScroll: true });
  }, [activeStep, steps, virtualizer]);

  const active = steps[activeStep] ?? null;

  return (
    <div className="references-filmstrip">
      <div
        className={
          navigation
            ? 'references-filmstrip__strip'
            : 'references-filmstrip__strip references-filmstrip__strip--bare'
        }
      >
        {navigation && (
          <IconButton
            size="sm"
            variant="toolbar"
            title={previousLabel}
            disabled={previousDisabled}
            onClick={onPrevious}
          >
            <ChevronLeft size={16} />
          </IconButton>
        )}
        <div ref={listRef} className="references-filmstrip__list">
          <div
            className="references-filmstrip__track"
            role="list"
            aria-label={t('panels:references.filmstrip.label', 'Folding steps')}
            style={{ width: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const step = steps[item.index];
              if (!step) return null;
              const selected = item.index === activeStep;
              return (
                <div
                  key={item.key}
                  role="listitem"
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="references-filmstrip__item"
                  style={{ transform: `translateX(${item.start}px)` }}
                >
                  <button
                    type="button"
                    aria-current={selected ? 'step' : undefined}
                    // The strip's real length, which assistive technology
                    // cannot count for itself once only the visible cards are
                    // mounted.
                    aria-setsize={steps.length}
                    aria-posinset={item.index + 1}
                    className={[
                      'references-card',
                      `references-card--${step.kind}`,
                      selected ? 'references-card--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => onSelectStep(item.index)}
                    // Named by its number, described by its sentence: `title`
                    // loses the accessible-name competition to the visible
                    // number and becomes the description, which is what a
                    // screen reader should read second. The sentence itself is
                    // on screen in the caption.
                    title={step.sentence}
                  >
                    {step.number !== null && (
                      <span className="references-card__number">{step.number}</span>
                    )}
                    {step.badge !== '' && (
                      <span className="references-card__badge">{step.badge}</span>
                    )}
                    <span className="references-card__thumb">
                      {step.diagram ? (
                        <StepDiagram
                          diagram={step.diagram}
                          size={100}
                          chrome={{ number: step.number, badge: step.badge }}
                        />
                      ) : (
                        <StepDiagram
                          primitives={step.primitives}
                          size={100}
                          mirrored={step.mirrored}
                          chrome={{ number: step.number, badge: step.badge }}
                        />
                      )}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        {navigation && (
          <IconButton
            size="sm"
            variant="toolbar"
            title={nextLabel}
            disabled={nextDisabled}
            onClick={onNext}
          >
            <ChevronRight size={16} />
          </IconButton>
        )}
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
