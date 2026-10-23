import { memo, useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { IconButton } from '../ui/IconButton';
import { useVerticalSwipe } from '../../hooks/useVerticalSwipe';
import styles from './StepFilmstrip.module.css';

/**
 * Which of a card's ways it shows, when it offers more than one: the ways
 * References can fold one step, or the branches a folding sequence takes at
 * one step. Either way the card is one of `count`, and `index` is the one on
 * screen.
 */
export interface StepFilmstripWays {
  count: number;
  index: number;
}

/**
 * What a card is. `fold` makes a crease and is numbered; the other two are
 * steps the folder performs without creasing (turning the paper over) or the
 * sequence's end, and carry a badge in the number's place.
 */
export type StepFilmstripCardKind = 'fold' | 'turn-over' | 'done';

/**
 * Where a card stands, for a sequence being built rather than read:
 *
 * - `preview`: the step the reader is about to commit, not yet part of the
 *   sequence;
 * - `blocked`: a step that cannot be made as asked;
 * - `new-branch`: a step that, committed, starts a branch rather than
 *   continuing the one on screen;
 * - `imported`: a state taken from a crease pattern rather than folded;
 * - `changed`: a step that folds to another state than the one it was saved
 *   at — the software changed, not the step;
 * - `locked`: a step a newer build wrote, kept as it came and never folded;
 * - `pending`: a step whose state is still being worked out.
 *
 * A look only. Say it in words too, in the badge and the sentence: a frame's
 * colour is no help to a screen reader, or to a reader who cannot tell it.
 */
export type StepFilmstripCardState =
  | 'preview'
  | 'blocked'
  | 'new-branch'
  | 'imported'
  | 'changed'
  | 'locked'
  | 'pending';

/** One card: a picture, its chrome, and the sentence under the strip when it is active. */
export interface StepFilmstripCard {
  key: string;
  kind: StepFilmstripCardKind;
  /** What the card is numbered; null for a step that is not a fold. */
  number: number | null;
  /**
   * The badge: in the number's place on a card that is not a fold, in the
   * opposite corner on one that is. Empty for none.
   */
  badge: string;
  sentence: string;
  /** Its ways, when it offers more than one; null otherwise. */
  ways: StepFilmstripWays | null;
  /** Where it stands; absent for a committed step, which is all References has. */
  state?: StepFilmstripCardState;
  /**
   * A word ahead of the sentence while the card is active — "Next", "Jump" —
   * for what the sentence describes as against what is on the canvas. Absent
   * or empty for none.
   */
  tag?: string;
}

/**
 * A sequence of steps as a diagram: one numbered card per step, a chevron at
 * each end, and the active step's sentence underneath — the shape a printed
 * origami diagram uses, so a sequence reads left to right as instructions
 * rather than as a list of rows.
 *
 * Selecting a step scrolls *the strip*, never the camera.
 *
 * **Windowed.** A card's picture can be as costly as the pattern it shows —
 * References measured a strip of every card at 705,595 SVG elements and 2.66 s
 * at its corpus p99, for a strip of which a dozen cards are ever on screen. So
 * only the cards in view are mounted, and the rest cost nothing until they are
 * scrolled to.
 *
 * Presentation only: the cards, their pictures (`renderThumbnail`), which one is
 * active, what a press means and every string are the caller's.
 */
export interface StepFilmstripProps<Card extends StepFilmstripCard> {
  steps: readonly Card[];
  /**
   * The card's picture, drawn into a square slot under its chrome. Called only
   * for the cards in view; a stable function, so the strip does not redraw
   * every picture when it re-renders.
   */
  renderThumbnail: (step: Card) => ReactNode;
  /** The strip's accessible name, as a list. */
  label: string;
  activeStep: number;
  onSelectStep: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  /** Shown in place of the sentence when there are no steps yet. */
  placeholder: string;
  /** A standing note under the caption about the whole sequence, or empty. */
  note?: string;
  /**
   * The chevrons' labels — the caller's action catalog's, so the strip, the
   * context menu and the keymap cannot name one verb three ways.
   */
  previousLabel: string;
  nextLabel: string;
  /**
   * Whether the chevrons are here at all. On the phone they are not — a touch
   * target either side of a 375px strip left room for barely one card — and
   * the caller leads its floating bar with the stepping instead. The strip is
   * then the cards alone, edge to edge.
   */
  navigation?: boolean;
  /**
   * Smaller cards, for a phone whose canvas is under the strip: the pictures
   * are still there to read and to tap, and the paper keeps the height.
   */
  compact?: boolean;
  /** Whether each chevron is dead, from the same catalog the labels come from. */
  previousDisabled: boolean;
  nextDisabled: boolean;
  /**
   * The verbs that switch the active card between its ways, labelled and gated
   * by the caller's catalog like the chevrons. The row under the sentence is
   * drawn only for a card that offers more than one way.
   */
  onPreviousWay?: () => void;
  onNextWay?: () => void;
  /**
   * A vertical swipe's verb: step the card at `index` one way on (1, a swipe
   * up) or back (-1). A swipe on a card switches that card, selecting it
   * first; one on the sentence or the readout switches the active card.
   *
   * On the phone this is the switcher: a thumb-sized pair of chevrons costs a
   * row the screen cannot spare, so there they are hidden from sight and kept
   * for a screen reader alone.
   */
  onShiftWay?: (index: number, delta: -1 | 1) => void;
  previousWayLabel?: string;
  nextWayLabel?: string;
  previousWayDisabled?: boolean;
  nextWayDisabled?: boolean;
  /** The ways row's accessible name ("Ways to fold this step"). */
  waysLabel: string;
  /**
   * A card's ways in words: "Way 2 of 3" for a card's accessible name and the
   * row's readout, and the `short` form ("2 / 3") for the phone's row.
   */
  wayReadout: (ways: StepFilmstripWays, short: boolean) => string;
  /**
   * Without the chevrons (`navigation` off), a tap on the readout: the active
   * card's next way, the first after the last — the one control a phone's row
   * has, beside the swipe. Without it the readout is only read.
   */
  onCycleWay?: () => void;
  cycleWayLabel?: string;
  cycleWayDisabled?: boolean;
}

/**
 * A card's width plus the gap after it, in CSS pixels — the module's
 * `--card-size` and `.item`'s trailing padding.
 *
 * Only the estimate: every mounted card is measured, so this decides the
 * scrollbar before the first measurement and nothing after it.
 */
const CARD_STRIDE_PX = 136;
/** The same, for a `compact` strip: its `--card-size` and the trailing gap. */
const COMPACT_CARD_STRIDE_PX = 96;

function StepFilmstripView<Card extends StepFilmstripCard>({
  steps,
  renderThumbnail,
  label,
  activeStep,
  onSelectStep,
  onPrevious,
  onNext,
  placeholder,
  note,
  previousLabel,
  navigation = true,
  compact = false,
  nextLabel,
  previousDisabled,
  nextDisabled,
  onPreviousWay,
  onNextWay,
  previousWayLabel = '',
  nextWayLabel = '',
  previousWayDisabled = true,
  nextWayDisabled = true,
  onShiftWay,
  waysLabel,
  wayReadout,
  onCycleWay,
  cycleWayLabel = '',
  cycleWayDisabled = true,
}: StepFilmstripProps<Card>) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // React Compiler cannot memoize a component that uses `useVirtualizer`, so
  // this one re-renders on every scroll frame. Nothing below it is expensive as
  // long as `renderThumbnail` draws something pure and keyed by step.
  //
  // The rule's real warning is about handing this API's functions to memoized
  // children, which would keep a stale one. None leaves this component:
  // `measureElement` goes to a card's own `div` as its ref, and the rest are
  // called here — as `CpDiagnosticHud` and `useVirtualStepRows` note for
  // their own virtualizers.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    horizontal: true,
    count: steps.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => (compact ? COMPACT_CARD_STRIDE_PX : CARD_STRIDE_PX),
    // By step key, not index: a recompute reorders the strip, and a card that
    // is still the same step should not be remounted — and so redrawn — just
    // because the steps before it changed.
    getItemKey: (index) => steps[index]?.key ?? index,
    overscan: 4,
  });

  // Keep the active card in view however it was selected — a card press, a
  // chevron, a chord, or a transport strip.
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
      .querySelector<HTMLButtonElement>('[role="listitem"] > button[aria-current="step"]')
      ?.focus({ preventScroll: true });
  }, [activeStep, steps, virtualizer]);

  const active = steps[activeStep] ?? null;
  const swipe = useVerticalSwipe((direction, target) => {
    const index = swipedCard(target, activeStep);
    if (!onShiftWay || index === null || !steps[index]?.ways) return;
    if (index !== activeStep) onSelectStep(index);
    onShiftWay(index, direction === 'up' ? 1 : -1);
  });

  return (
    <div
      className={styles.filmstrip}
      data-ways={active?.ways ? true : undefined}
      data-compact={compact || undefined}
      {...swipe}
    >
      <div className={styles.strip} data-bare={navigation ? undefined : true}>
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
        <div ref={listRef} className={styles.list}>
          <div
            className={styles.track}
            role="list"
            aria-label={label}
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
                  data-swipe-target="card"
                  ref={virtualizer.measureElement}
                  className={styles.item}
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
                    className={styles.card}
                    data-kind={step.kind}
                    data-state={step.state}
                    data-ways={step.ways ? true : undefined}
                    onClick={() => onSelectStep(item.index)}
                    // Named by its number, described by its sentence: `title`
                    // loses the accessible-name competition to the visible
                    // number and becomes the description, which is what a
                    // screen reader should read second. The sentence itself is
                    // on screen in the caption.
                    title={step.sentence}
                  >
                    {step.number !== null && <span className={styles.number}>{step.number}</span>}
                    {step.badge !== '' && <span className={styles.badge}>{step.badge}</span>}
                    {step.ways && (
                      // One dot per way, the one showing filled: a card left
                      // on a way other than the first reads so in the strip.
                      // Named in words for the card's accessible name.
                      <span
                        className={styles.dots}
                        role="img"
                        aria-label={wayReadout(step.ways, false)}
                      >
                        {Array.from({ length: step.ways.count }, (_, way) => (
                          <span
                            key={way}
                            className={styles.dot}
                            data-shown={way === step.ways?.index ? true : undefined}
                          />
                        ))}
                      </span>
                    )}
                    <span className={styles.thumb}>{renderThumbnail(step)}</span>
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
      <p className={styles.caption} data-swipe-target="active">
        {active ? (
          <>
            {active.tag && (
              <span className={styles.captionTag}>
                <Badge tone="accent">{active.tag}</Badge>
              </span>
            )}
            {active.number !== null && (
              <span className={styles.captionNumber}>{active.number}.</span>
            )}{' '}
            {active.sentence}
          </>
        ) : (
          <span className={styles.captionEmpty}>{placeholder}</span>
        )}
        {note && <span className={styles.note}>{note}</span>}
      </p>
      {active?.ways && onPreviousWay && onNextWay && (
        <div
          className={styles.ways}
          data-readout-only={navigation ? undefined : true}
          data-swipe-target="active"
          role="group"
          aria-label={waysLabel}
        >
          {!navigation && onCycleWay ? (
            // The phone's row: the readout is the switch, its chevrons hidden from sight.
            <button
              type="button"
              className={styles.waysReadout}
              data-cycle=""
              title={cycleWayLabel}
              disabled={cycleWayDisabled}
              onClick={onCycleWay}
            >
              <span aria-live="polite">{wayReadout(active.ways, true)}</span>
              <ChevronsUpDown size={12} aria-hidden="true" />
            </button>
          ) : (
            <span className={styles.waysReadout} aria-live="polite">
              {wayReadout(active.ways, !navigation)}
            </span>
          )}
          <IconButton
            size="sm"
            variant="toolbar"
            title={previousWayLabel}
            disabled={previousWayDisabled}
            onClick={onPreviousWay}
          >
            <ChevronUp size={14} />
          </IconButton>
          <IconButton
            size="sm"
            variant="toolbar"
            title={nextWayLabel}
            disabled={nextWayDisabled}
            onClick={onNextWay}
          >
            <ChevronDown size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}

/** `memo` erases the type parameter; this puts it back. */
export const StepFilmstrip = memo(StepFilmstripView) as <Card extends StepFilmstripCard>(
  props: StepFilmstripProps<Card>
) => ReactElement;

/**
 * The card a swipe that began on `target` switches: the one under the finger,
 * or the active one when it began on its sentence or readout. Null anywhere
 * else — the strip's own chevrons are buttons, not cards.
 */
function swipedCard(target: EventTarget, activeStep: number): number | null {
  if (!(target instanceof Element)) return null;
  const about = target.closest<HTMLElement>('[data-swipe-target]');
  if (!about) return null;
  return about.dataset.swipeTarget === 'card' ? Number(about.dataset.index) : activeStep;
}
