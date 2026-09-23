import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLandingSectionViewedEvents, useLandingViewedEvent } from '../analytics';
import { FileDropOverlay } from '../components/FileDropOverlay';
import {
  FIRST_LANDING_SECTION_ID,
  LANDING_SECTIONS,
  trackCta,
  WelcomeLanding,
} from '../components/landing/WelcomeLanding';
import { WelcomeScrollCue } from '../components/landing/WelcomeScrollCue';
import { StartScreen } from '../components/StartScreen';
import { useFileDropTarget } from '../hooks/useFileDropTarget';
import type { DropTargetPolicy } from '../lib/fileDrop';
import { OPEN_PROJECT_DIALOG } from '../lib/fileFormats';
import { humanizeError } from '../lib/toastMessages';
import { getFileService } from '../platform/fileService';
import { useIsPhoneSurface } from '../platform/mobileSurface';
import { SiteFooter } from '../site/SiteFooter';
import { useSettingsStore } from '../store/settingsStore';
import {
  loadedWorkspace,
  prefetchWorkspace,
  startActions,
  type StartOutcome,
} from './workspaceGateway';

/**
 * The start screen only ever opens. The Edit canvas is always-live, so a crease
 * pattern can still be loaded while sitting here — but "merge into the document
 * you are not looking at" is not a choice worth offering.
 */
const WELCOME_DROP_POLICY: DropTargetPolicy = 'open-only';

/**
 * The `/welcome` route: a landing page led by the start screen.
 *
 * It renders without the editor. A start action loads the workspace through
 * `workspaceGateway` — already warming by then, from the pointer or focus reaching
 * an action — waits for its engine, and navigates to the workspace that now owns
 * the document. Until one is chosen nothing here depends on the editor, so the
 * actions are ready from the first paint.
 *
 * Every device gets the same page. The stylesheet stacks the hero and the three
 * actions into one column below 680px.
 *
 * Whether a cold start lands here or straight in Edit is decided by the router's
 * index redirect (the "Show welcome on startup" preference), not this component —
 * so returning here intentionally (File › New) always shows the start screen.
 */
export function WelcomeRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pageRef = useRef<HTMLElement | null>(null);
  // Only for `data-surface`, which the landing sections below read. The page
  // itself no longer branches on it.
  const phone = useIsPhoneSurface();
  const showWelcomeOnStartup = useSettingsStore((state) => state.showWelcomeOnStartup);
  const setShowWelcomeOnStartup = useSettingsStore((state) => state.setShowWelcomeOnStartup);
  const [preparing, setPreparing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useLandingViewedEvent(phone ? 'phone' : 'desktop');
  useLandingSectionViewedEvents(pageRef, LANDING_SECTIONS);

  // Arriving here clears transient project state — once the workspace exists. On a
  // first visit there is nothing to clear, and asking would load it.
  useEffect(() => {
    loadedWorkspace()?.resetForStartScreen();
  }, []);

  const run = useCallback(
    async (action: () => Promise<StartOutcome>) => {
      setPreparing(true);
      setErrorMessage(null);
      try {
        const outcome = await action();
        if (outcome.kind === 'navigate') navigate(outcome.path);
        else if (outcome.kind === 'error') setErrorMessage(outcome.message);
      } catch (error) {
        setErrorMessage(humanizeError(error, t));
      } finally {
        setPreparing(false);
      }
    },
    [navigate, t]
  );

  const handleOpenFile = useCallback(() => {
    // Opened here, inside the click: a browser shows a file picker only for a user
    // gesture, and the workspace that will read the file may still be loading.
    const picked = getFileService().openTextFile(OPEN_PROJECT_DIALOG);
    // Observed now so a failed pick is not reported unhandled before the workspace reads it.
    picked.catch(() => undefined);
    void run(() => startActions.openPicked(picked));
  }, [run]);

  const onDropFiles = useCallback(
    (files: File[]) => void run(() => startActions.dropFiles(files)),
    [run]
  );
  const { dropTargetProps, isDragActive } = useFileDropTarget({
    policy: WELCOME_DROP_POLICY,
    onDropFiles,
  });
  const { onDragEnter } = dropTargetProps;
  const warmThenDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      prefetchWorkspace();
      onDragEnter(event);
    },
    [onDragEnter]
  );

  return (
    <div
      className="app-layout app-layout--start file-drop-region"
      data-surface={phone ? 'phone' : undefined}
      {...dropTargetProps}
      onDragEnter={warmThenDragEnter}
    >
      <main className="welcome-page" ref={pageRef}>
        <StartScreen
          preparing={preparing}
          errorMessage={errorMessage}
          onIntent={prefetchWorkspace}
          onCreateCreasePattern={() => void run(startActions.createCreasePattern)}
          onCreateDesign={() => void run(startActions.createDesign)}
          onOpenFile={handleOpenFile}
          showWelcomeOnStartup={showWelcomeOnStartup}
          onToggleShowWelcomeOnStartup={setShowWelcomeOnStartup}
        />
        <WelcomeLanding />
        {/*
          The landing's links to the rest of the site. Here rather than inside
          `WelcomeLanding`, which stays a pure block of copy with no router
          dependency; the prerender's `StaticLanding` places it the same way.
        */}
        <SiteFooter />
      </main>
      {/*
        The cue exists to say "there is more below the first screenful". With no
        hero there is no first screenful to get past — the landing is already
        the top of the page — so on a phone it would point at what is on screen.
      */}
      <WelcomeScrollCue
        scrollerRef={pageRef}
        targetId={FIRST_LANDING_SECTION_ID}
        onActivate={() => trackCta('scroll')}
      />
      <FileDropOverlay visible={isDragActive} policy={WELCOME_DROP_POLICY} />
    </div>
  );
}
