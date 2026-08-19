import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { track, type LandingFeatureId } from '../../analytics';
import { carouselKeyTarget } from './carouselKeys';
import { LandingFigure } from './LandingFigure';
import { usePointerDrag } from './usePointerDrag';

/** How long the track must sit still before the landed-on slide is reported. */
const SETTLE_MS = 350;

/**
 * How far a drag has to travel to commit to the next slide: the smaller of this
 * fraction of the track and {@link COMMIT_MAX_PX}.
 *
 * The cap is what matters on a desktop. A fraction alone scales with the track,
 * so a 1120px carousel would want 168px of drag at 15% — a long way to move a
 * mouse for one step. The cap keeps it to a flick on any width, while the
 * fraction keeps it proportionate on a phone.
 */
const COMMIT_FRACTION = 0.15;
const COMMIT_MAX_PX = 64;

export interface LandingSwipeItem {
  /** Reported to analytics, so keep it stable. */
  id: LandingFeatureId;
  title: string;
  body: string;
  /** Base filename under `public/landing/`, without the theme suffix. */
  figure: string;
  figureAlt: string;
}

export interface LandingSwipeCarouselProps {
  /** Names the control for screen readers, e.g. "Design methods". */
  label: string;
  items: readonly LandingSwipeItem[];
  /**
   * Whether to show the row of title buttons above the track.
   *
   * Off on a phone, where they cost a row (sometimes two) of vertical space to
   * duplicate what a swipe already does, and where the dots plus each slide's
   * own heading say the same thing in less room.
   */
  showTabs?: boolean;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A carousel you can actually swipe: the slides live in a horizontal
 * scroll-snap track, so touch gets the platform's own momentum, rubber-banding
 * and snap physics for nothing, and a mouse gets them through a small drag shim
 * over the same `scrollLeft`.
 *
 * Scroll-snap rather than a transform-driven slider is the load-bearing choice.
 * A slider has to reimplement momentum, fling velocity, over-scroll and snap
 * feel, per platform, and will be worse at all four. Here the browser does it and
 * the component only has to answer "which slide is showing".
 *
 * Which it answers by arithmetic, not an observer: the slides are exactly one
 * track wide, so the index is `scrollLeft / clientWidth` rounded. That updates
 * live during a swipe — the labels track your thumb rather than snapping over
 * once you let go — and needs neither `scrollend` (still missing on older
 * Safari) nor an `IntersectionObserver` per slide.
 *
 * Kept separate from `LandingFeatureList`, which stays a disclosure list beside
 * its figure. Its four items have long titles and descriptions that read as a
 * list; these three are short and benefit from being swiped. The two share the
 * parts worth sharing — `LandingFigure` — and nothing else.
 */
export function LandingSwipeCarousel({ label, items, showTabs = true }: LandingSwipeCarouselProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState(0);

  const tabId = (index: number) => `${baseId}-tab-${items[index].id}`;
  const slideId = (index: number) => `${baseId}-slide-${items[index].id}`;

  /** The only thing that writes scroll position. */
  const goTo = useCallback((index: number, focus = false) => {
    const element = trackRef.current;
    if (element) {
      element.scrollTo({
        left: index * element.clientWidth,
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
    setActive(index);
    if (focus) tabRefs.current[index]?.focus();
  }, []);

  // Follow the track while it moves, from any source: a tab press, a key, a
  // thumb. Reading it here rather than in each of those keeps one source of
  // truth, and means a swipe the component never initiated still updates the
  // labels.
  useEffect(() => {
    const element = trackRef.current;
    if (!element) return;
    const onScroll = () => {
      const width = element.clientWidth;
      if (width <= 0) return;
      const index = Math.round(element.scrollLeft / width);
      setActive((current) => (current === index ? current : index));
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, []);

  // Report where it came to rest, not every slide it passed through. A fast
  // swipe across three slides is one decision, and the timer restarting on each
  // change is what collapses it into one event. The mount pass is skipped so the
  // first slide is not reported as opened by someone who never touched it.
  const reported = useRef<number | null>(null);
  useEffect(() => {
    if (reported.current === null) {
      reported.current = active;
      return;
    }
    if (reported.current === active) return;
    const timer = setTimeout(() => {
      reported.current = active;
      track('landing feature opened', { feature: items[active].id });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [active, items]);

  // Where a mouse drag lets go, land on a slide rather than between two.
  //
  // Measured from where the gesture *started*, not from the nearest slide to
  // where it stopped. Rounding to nearest means a drag has to cross half a
  // slide to count — 560px on a 1120px track — which feels like the carousel is
  // refusing to move. A short, decisive flick should commit.
  const settleFromDrag = useCallback(
    (startScroll: number) => {
      const element = trackRef.current;
      const width = element?.clientWidth ?? 0;
      if (!element || width <= 0) return;

      const from = Math.round(startScroll / width);
      const travelled = element.scrollLeft - startScroll;
      const threshold = Math.min(width * COMMIT_FRACTION, COMMIT_MAX_PX);

      // Past the threshold, move at least one slide — more if the drag actually
      // covered more, so a long drag is not throttled to a single step.
      const steps =
        Math.abs(travelled) < threshold
          ? 0
          : Math.sign(travelled) * Math.max(1, Math.round(Math.abs(travelled) / width));

      goTo(Math.min(Math.max(from + steps, 0), items.length - 1));
    },
    [goTo, items.length],
  );

  const dragHandlers = usePointerDrag(trackRef, { onSettle: settleFromDrag });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = carouselKeyTarget(event.key, active, items.length);
    if (next === null) return;
    event.preventDefault();
    goTo(next, true);
  };

  return (
    <div className="landing-swipe">
      {showTabs ? (
        <div
          className="landing-swipe__tabs"
          role="tablist"
          aria-label={label}
          onKeyDown={onKeyDown}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={tabId(index)}
              className="landing-swipe__tab"
              aria-selected={index === active}
              aria-controls={slideId(index)}
              tabIndex={index === active ? 0 : -1}
              onClick={() => goTo(index)}
            >
              {item.title}
            </button>
          ))}
        </div>
      ) : null}

      <div className="landing-swipe__viewport">
        <div
          className="landing-swipe__track"
          ref={trackRef}
          {...dragHandlers}
          // Without the tab list there is nothing to describe the track, and it
          // is a scroll container a keyboard can land on — so it names itself.
          {...(showTabs ? {} : { role: 'group', 'aria-label': label, tabIndex: 0 })}
        >
          {items.map((item, index) => (
            <div
              key={item.id}
              className="landing-swipe__slide"
              id={slideId(index)}
              // With tabs this is the panel they control. Without them there is
              // no tablist, so calling it a tabpanel would be a lie — it is one
              // slide of a group, and it carries its own heading instead.
              {...(showTabs
                ? { role: 'tabpanel', 'aria-labelledby': tabId(index) }
                : { role: 'group', 'aria-roledescription': 'slide' })}
              // The off-screen slides stay in the DOM — that is what makes the
              // track scrollable — but they are not content anyone is shown.
              aria-hidden={index === active ? undefined : true}
            >
              <LandingFigure name={item.figure} alt={item.figureAlt} />
              {showTabs ? null : <h3 className="landing-swipe__slide-title">{item.title}</h3>}
              <p className="landing-swipe__body">{item.body}</p>
            </div>
          ))}
        </div>

        {/*
          Overlaid on the figure, not the whole slide: the wrapper carries the
          same 16:9 as `LandingFigure`, so the arrows sit on the screenshot's
          centre line rather than being dragged low by the paragraph under it.

          They clamp at the ends rather than wrapping, because the track has real
          ends — it is a scroll container, not a loop, and a "next" that scrolls
          the whole way back is a jump, not a step. The arrow *keys* still wrap;
          that is the tab-list convention and costs no visible travel.
        */}
        <div className="landing-swipe__nav">
          <button
            type="button"
            className="landing-swipe__arrow"
            aria-label={t('landing:carousel.previous', 'Previous')}
            disabled={active === 0}
            onClick={() => goTo(active - 1)}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="landing-swipe__arrow"
            aria-label={t('landing:carousel.next', 'Next')}
            disabled={active === items.length - 1}
            onClick={() => goTo(active + 1)}
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/*
        Buttons, not decoration. They read as controls, so they have to behave
        like them — a dot you can point at and cannot press is worse than no dot.
      */}
      <div className="landing-swipe__dots">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className="landing-swipe__dot"
            data-active={index === active || undefined}
            aria-label={item.title}
            aria-current={index === active || undefined}
            onClick={() => goTo(index)}
          />
        ))}
      </div>
    </div>
  );
}
