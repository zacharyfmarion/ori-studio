import { ChevronDown } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

/** Scroll distance past which the page is no longer "at the top". */
const AT_TOP_THRESHOLD_PX = 24;

interface WelcomeScrollCueProps {
  /** The welcome page's scroll container. */
  scrollerRef: RefObject<HTMLElement | null>;
  /** Section to scroll to; the first one below the fold. */
  targetId: string;
  onActivate?: () => void;
}

/**
 * The "there is more below" affordance, pinned to the bottom of the first
 * screenful.
 *
 * It is positioned against `.app-layout--start`, which does **not** scroll, so it
 * stays put over the visible viewport instead of riding the document down. It
 * hides as soon as the page moves, because past that point it is telling the user
 * something they have already worked out.
 */
export function WelcomeScrollCue({ scrollerRef, targetId, onActivate }: WelcomeScrollCueProps) {
  const { t } = useTranslation();
  const atTop = useAtScrollTop(scrollerRef);

  return (
    <div className="welcome-scroll-cue" data-hidden={!atTop || undefined}>
      <button
        type="button"
        className="welcome-scroll-cue__button"
        // Nothing is lost by not reaching it — the same content is a scroll away
        // — and a cue that steals a tab stop ahead of the start actions is worse
        // than one a keyboard user never sees.
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => {
          document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
          onActivate?.();
        }}
      >
        <span>{t('landing:scrollCue', 'See what it does')}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Whether `ref`'s element is scrolled to (or very near) its top. */
function useAtScrollTop(ref: RefObject<HTMLElement | null>): boolean {
  const [atTop, setAtTop] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setAtTop(element.scrollTop < AT_TOP_THRESHOLD_PX);
    update();
    element.addEventListener('scroll', update, { passive: true });
    return () => element.removeEventListener('scroll', update);
  }, [ref]);

  return atTop;
}
