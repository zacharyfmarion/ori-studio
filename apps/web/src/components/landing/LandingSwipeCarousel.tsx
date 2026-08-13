import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { track, type LandingFeatureId } from '../../analytics';
import { carouselKeyTarget } from './carouselKeys';
import { LandingFigure } from './LandingFigure';
import { usePointerDrag } from './usePointerDrag';

/** How long the track must sit still before the landed-on slide is reported. */
const SETTLE_MS = 350;

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
  /** Names the tab list for screen readers, e.g. "Design methods". */
  label: string;
  items: readonly LandingSwipeItem[];
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
 * Kept separate from `LandingFeatureCarousel`, which stays a vertical tab list
 * beside its panel. Its four slides have long titles that read as a list; these
 * three are short and benefit from being swiped. The two share the parts worth
 * sharing — `carouselKeyTarget`, `LandingFigure` — and nothing else.
 */
export function LandingSwipeCarousel({ label, items }: LandingSwipeCarouselProps) {
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
  const snapToNearest = useCallback(() => {
    const element = trackRef.current;
    if (!element || element.clientWidth <= 0) return;
    goTo(Math.round(element.scrollLeft / element.clientWidth));
  }, [goTo]);

  const dragHandlers = usePointerDrag(trackRef, { onSettle: snapToNearest });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = carouselKeyTarget(event.key, active, items.length);
    if (next === null) return;
    event.preventDefault();
    goTo(next, true);
  };

  return (
    <div className="landing-swipe">
      <div className="landing-swipe__tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
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

      <div className="landing-swipe__track" ref={trackRef} {...dragHandlers}>
        {items.map((item, index) => (
          <div
            key={item.id}
            className="landing-swipe__slide"
            role="tabpanel"
            id={slideId(index)}
            aria-labelledby={tabId(index)}
            // The off-screen slides stay in the DOM — that is what makes the
            // track scrollable — but they are not content anyone is being shown.
            aria-hidden={index === active ? undefined : true}
          >
            <LandingFigure name={item.figure} alt={item.figureAlt} />
            <p className="landing-swipe__body">{item.body}</p>
          </div>
        ))}
      </div>

      <div className="landing-swipe__dots" aria-hidden="true">
        {items.map((item, index) => (
          <span key={item.id} className="landing-swipe__dot" data-active={index === active || undefined} />
        ))}
      </div>
    </div>
  );
}
