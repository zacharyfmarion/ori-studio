import { useId, useState } from 'react';
import { track, type LandingFeatureId } from '../../analytics';
import { LandingFigure } from './LandingFigure';

export interface LandingFeatureItem {
  /** Reported to analytics, so keep it stable. */
  id: LandingFeatureId;
  title: string;
  body: string;
  /** Base filename under `public/landing/`, without the theme suffix. */
  figure: string;
  figureAlt: string;
}

export interface LandingFeatureListProps {
  /** Names the list for screen readers, e.g. "Crease-pattern features". */
  label: string;
  items: readonly LandingFeatureItem[];
}

/**
 * A list of features beside a screenshot of whichever one is open.
 *
 * Built as a disclosure list rather than the tab pattern it started as, because
 * the description now sits **under its own item** instead of under the image.
 * Three things came out of that:
 *
 * - The left column fills. Four titles against a 16:9 panel left a third of the
 *   column empty, and centring the list in that space only moved the gap to
 *   both ends of it.
 * - The description is next to the thing that reveals it. Under the image it
 *   was as far from its own title as the layout allowed.
 * - Each title is its own tab stop, which is what a disclosure list should be.
 *   The tab pattern's single roving stop is right when the panel is one region;
 *   here every item owns a region of its own.
 *
 * The screenshot follows the open item rather than being a panel of its own —
 * it illustrates, and its `alt` changes with it.
 */
export function LandingFeatureList({ label, items }: LandingFeatureListProps) {
  const baseId = useId();
  const [openIndex, setOpenIndex] = useState(0);

  const open = items[openIndex] ?? items[0];
  const bodyId = (index: number) => `${baseId}-body-${items[index].id}`;

  const openItem = (index: number) => {
    setOpenIndex(index);
    track('landing feature opened', { feature: items[index].id });
  };

  return (
    <div className="landing-features">
      <ul className="landing-features__list" aria-label={label}>
        {items.map((item, index) => {
          const isOpen = index === openIndex;
          return (
            <li key={item.id} className="landing-features__item" data-open={isOpen || undefined}>
              <h3 className="landing-features__heading">
                <button
                  type="button"
                  className="landing-features__trigger"
                  aria-expanded={isOpen}
                  aria-controls={bodyId(index)}
                  onClick={() => openItem(index)}
                >
                  {item.title}
                </button>
              </h3>
              {/*
                Kept mounted and hidden rather than unmounted, so the collapsed
                descriptions are still found by in-page search.
              */}
              <div className="landing-features__body" id={bodyId(index)} hidden={!isOpen}>
                <p>{item.body}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="landing-features__figure">
        <LandingFigure key={open.figure} name={open.figure} alt={open.figureAlt} />
      </div>
    </div>
  );
}
