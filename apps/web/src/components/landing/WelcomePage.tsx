import { useRef, type Ref, type RefObject } from 'react';
import type { FileDropTargetProps } from '../../hooks/useFileDropTarget';
import type { DropTargetPolicy } from '../../lib/fileDrop';
import { useIsPhoneSurface } from '../../platform/mobileSurface';
import { SiteFooter } from '../../site/SiteFooter';
import { FileDropOverlay } from '../FileDropOverlay';
import { StartScreen, type StartScreenProps } from '../StartScreen';
import { FIRST_LANDING_SECTION_ID, WelcomeLanding } from './WelcomeLanding';
import { WelcomeScrollCue } from './WelcomeScrollCue';

/**
 * The start screen only ever opens. The Edit canvas is always-live, so a crease
 * pattern can still be loaded while sitting here — but "merge into the document
 * you are not looking at" is not a choice worth offering.
 */
export const WELCOME_DROP_POLICY: DropTargetPolicy = 'open-only';

export interface WelcomePageProps extends StartScreenProps {
  pageRef?: RefObject<HTMLElement | null>;
  /** Absent in the prerender, which has nothing to handle a drop with. */
  dropTargetProps?: FileDropTargetProps;
  isDragActive?: boolean;
  onScrollCue?: () => void;
}

/**
 * The welcome page's markup, and nothing else: the start screen, the landing below it,
 * and the site footer.
 *
 * One component for both renders of it — `WelcomeRoute` in the browser, and the prerender
 * (`seo/StaticLanding.tsx`), whose copy is what a first visit paints before the app has
 * loaded. The two have to be pixel-identical or the swap between them shows, and sharing
 * the markup is what makes that true by construction rather than by care;
 * `scripts/static-paint-check.mjs` measures it.
 */
export function WelcomePage({
  pageRef,
  dropTargetProps,
  isDragActive = false,
  onScrollCue,
  ...startScreen
}: WelcomePageProps) {
  const ownRef = useRef<HTMLElement | null>(null);
  const scrollerRef = pageRef ?? ownRef;
  // Only for `data-surface`, which the landing sections below read. The page
  // itself no longer branches on it.
  const phone = useIsPhoneSurface();

  return (
    <div
      className="app-layout app-layout--start file-drop-region"
      data-surface={phone ? 'phone' : undefined}
      {...dropTargetProps}
    >
      <main className="welcome-page" ref={scrollerRef as Ref<HTMLElement>}>
        <StartScreen {...startScreen} />
        <WelcomeLanding />
        {/*
          The landing's links to the rest of the site. Here rather than inside
          `WelcomeLanding`, which stays a pure block of copy with no router
          dependency.
        */}
        <SiteFooter />
      </main>
      {/*
        The cue exists to say "there is more below the first screenful". With no
        hero there is no first screenful to get past — the landing is already
        the top of the page — so on a phone it would point at what is on screen.
      */}
      <WelcomeScrollCue
        scrollerRef={scrollerRef}
        targetId={FIRST_LANDING_SECTION_ID}
        onActivate={onScrollCue}
      />
      <FileDropOverlay visible={isDragActive} policy={WELCOME_DROP_POLICY} />
    </div>
  );
}
