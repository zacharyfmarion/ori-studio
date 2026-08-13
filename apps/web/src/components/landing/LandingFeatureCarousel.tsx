import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { track, type LandingFeatureId } from '../../analytics';
import { carouselKeyTarget } from './carouselKeys';
import { LandingFigure } from './LandingFigure';

export interface LandingCarouselItem {
  /** Reported to analytics, so keep it stable. */
  id: LandingFeatureId;
  title: string;
  body: string;
  /** Base filename under `public/landing/`, without the theme suffix. */
  figure: string;
  figureAlt: string;
}

export interface LandingFeatureCarouselProps {
  /** Names the tab list for screen readers, e.g. "Crease-pattern features". */
  label: string;
  items: readonly LandingCarouselItem[];
}

/**
 * A feature list beside the screenshot of whichever feature is selected.
 *
 * Built as the ARIA tabs pattern rather than as a slideshow, which is what makes
 * it usable: the list is always visible, so someone can see everything on offer
 * and jump straight to the one they care about instead of waiting for it to come
 * round.
 *
 * For the same reason it does **not** auto-advance. Each panel carries a
 * paragraph, and moving it out from under someone mid-sentence to a schedule
 * they did not choose is hostile — the reason WCAG has a clause about it.
 *
 * Tab labels are the title alone; the body lives in the panel, next to the image
 * it describes. Putting the paragraph inside the tab would make its accessible
 * name a paragraph too.
 */
export function LandingFeatureCarousel({ label, items }: LandingFeatureCarouselProps) {
  const baseId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const active = items[activeIndex] ?? items[0];
  const tabId = (index: number) => `${baseId}-tab-${items[index].id}`;
  const panelId = `${baseId}-panel`;

  const select = (index: number, focus = false) => {
    setActiveIndex(index);
    if (focus) tabRefs.current[index]?.focus();
    track('landing feature opened', { feature: items[index].id });
  };

  // Roving tabindex. The mapping itself is `carouselKeyTarget`, shared with the
  // Design carousel: the two look nothing alike, but "which slide does this key
  // mean" has the same answer in both, and having it in one place is what stops
  // them drifting into different arrow behaviour.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = carouselKeyTarget(event.key, activeIndex, items.length);
    if (next === null) return;
    event.preventDefault();
    select(next, true);
  };

  return (
    <div className="landing-carousel">
      <div
        className="landing-carousel__tabs"
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
            className="landing-carousel__tab"
            aria-selected={index === activeIndex}
            aria-controls={panelId}
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => select(index)}
          >
            <span className="landing-carousel__tab-index" aria-hidden="true">
              {index + 1}
            </span>
            <span className="landing-carousel__tab-title">{item.title}</span>
          </button>
        ))}
      </div>

      <div
        className="landing-carousel__panel"
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(activeIndex)}
        // The panel is not focusable: everything in it is static, and the tab
        // list it belongs to is already in the tab order.
        tabIndex={-1}
      >
        <LandingFigure key={active.figure} name={active.figure} alt={active.figureAlt} />
        {/*
          Every body is rendered, stacked into one grid cell, with the inactive
          ones hidden. That keeps the panel as tall as the longest slide instead
          of growing and shrinking by a line as you switch — which otherwise
          re-centres the tab list beside it and shifts everything below.
        */}
        <div className="landing-carousel__bodies">
          {items.map((item, index) => (
            <p
              key={item.id}
              className="landing-carousel__body"
              data-active={index === activeIndex || undefined}
            >
              {item.body}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
