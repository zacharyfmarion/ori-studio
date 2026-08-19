import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { track, useLandingSectionViewedEvents, useLandingViewedEvent } from '../analytics';
import { FileDropOverlay } from '../components/FileDropOverlay';
import { MobileLandingHeader } from '../components/landing/MobileLandingHeader';
import {
  FIRST_LANDING_SECTION_ID,
  LANDING_SECTIONS,
  trackCta,
  WelcomeLanding,
} from '../components/landing/WelcomeLanding';
import { WelcomeScrollCue } from '../components/landing/WelcomeScrollCue';
import { StartScreen } from '../components/StartScreen';
import { useFileDropTarget } from '../hooks/useFileDropTarget';
import { useWorkspaceErrorText } from '../hooks/useWorkspaceErrorText';
import type { DropTargetPolicy } from '../lib/fileDrop';
import type { AppStatus } from '../lib/sampleProject';
import {
  setPhoneOverride,
  useIsPhoneSurface,
  useIsWorkspaceBlocked,
} from '../platform/mobileSurface';
import { useLayoutStore } from '../store/layoutStore';
import { useSettingsStore } from '../store/settingsStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { DESIGN_PATH, EDIT_PATH } from './paths';
import { currentWorkspacePath } from './landing';

/**
 * The start screen only ever opens. The Edit canvas is always-live, so a crease
 * pattern can still be loaded while sitting here — but "merge into the document
 * you are not looking at" is not a choice worth offering.
 */
const WELCOME_DROP_POLICY: DropTargetPolicy = 'open-only';

/**
 * The status to reset to on arrival.
 *
 * On a blocked phone the engine is never started, so writing `loading_engine`
 * here would announce a load that never resolves — leave whatever is there.
 */
function resetStatus(current: AppStatus, engineReady: boolean, blocked: boolean): AppStatus {
  if (blocked) return current;
  return engineReady ? 'ready' : 'loading_engine';
}

/**
 * The `/welcome` route: a landing page led by the start screen, or on a phone by
 * a compact masthead.
 *
 * The start screen only ever opens. Creating or opening a document establishes it
 * in the store, then navigates to the workspace that owns it. Arriving here
 * clears transient project state (a discarded dirty flag, a stale error/message)
 * so the start screen is a clean slate.
 *
 * A phone gets no start screen, no drop target, no "show welcome on startup"
 * toggle and no scroll cue — every one of them is about a workspace it cannot
 * reach, or a fold that is not there. It gets a masthead, one button out, and
 * then the landing. The landing itself is the same on both.
 *
 * Whether a cold start lands here or straight in Edit is decided by the router's
 * index redirect (the "Show welcome on startup" preference), not this component —
 * so returning here intentionally (File › New) always shows the start screen.
 */
export function WelcomeRoute() {
  const navigate = useNavigate();
  const pageRef = useRef<HTMLElement | null>(null);
  // Two questions, not one: `blocked` decides what the page leads with, `phone`
  // decides how it lays out. Taking the escape hatch changes the first and not
  // the second — the screen is still small.
  const blocked = useIsWorkspaceBlocked();
  const phone = useIsPhoneSurface();
  const status = useWorkspaceStore((state) => state.status);
  const errorText = useWorkspaceErrorText();
  const createNewCreasePattern = useWorkspaceStore((state) => state.createNewCreasePattern);
  const openProject = useWorkspaceStore((state) => state.openProject);
  const showWelcomeOnStartup = useSettingsStore((state) => state.showWelcomeOnStartup);
  const setShowWelcomeOnStartup = useSettingsStore((state) => state.setShowWelcomeOnStartup);
  const { dropTargetProps, isDragActive } = useFileDropTarget({ policy: WELCOME_DROP_POLICY });

  useLandingViewedEvent(blocked ? 'phone' : 'desktop');
  useLandingSectionViewedEvents(pageRef, LANDING_SECTIONS);

  useEffect(() => {
    if (blocked) track('mobile block shown', {});
  }, [blocked]);

  const handleOpenAnyway = useCallback(() => {
    // Ordered so the event describes the state it was fired about: the override
    // re-renders this component the moment it lands.
    track('mobile block bypassed', {});
    setPhoneOverride(true);
  }, []);

  useEffect(() => {
    const state = useWorkspaceStore.getState();
    useWorkspaceStore.setState({
      dirty: false,
      error: null,
      projectMessage: null,
      status: resetStatus(state.status, state.engineReady, blocked),
    });
    useLayoutStore.getState().setActiveWorkspace('design');
  }, [blocked]);

  const handleCreateCreasePattern = useCallback(async () => {
    await createNewCreasePattern();
    if (useWorkspaceStore.getState().status !== 'error') navigate(EDIT_PATH);
  }, [createNewCreasePattern, navigate]);

  const handleCreateDesign = useCallback(() => {
    // Enter the Design workspace on the method chooser (Circle-packed vs
    // Box-pleated) instead of creating a blank tree up front.
    useWorkspaceStore.getState().startNewDesign();
    navigate(DESIGN_PATH);
  }, [navigate]);

  const handleOpenFile = useCallback(async () => {
    const opened = await openProject();
    if (!opened) return;
    navigate(currentWorkspacePath());
  }, [navigate, openProject]);

  return (
    <div
      className={`app-layout app-layout--start${blocked ? '' : ' file-drop-region'}`}
      data-surface={phone ? 'phone' : undefined}
      {...(blocked ? {} : dropTargetProps)}
    >
      <main className="welcome-page" ref={pageRef}>
        {blocked ? (
          // A phone gets a masthead and a way in, not a screenful of apology:
          // the landing starts right under it. The full-screen "desktop only"
          // notice this replaced spent every pixel above the fold explaining
          // what you could not do.
          <MobileLandingHeader onOpenAnyway={handleOpenAnyway} />
        ) : (
          <StartScreen
            status={status}
            errorMessage={errorText}
            onCreateCreasePattern={() => void handleCreateCreasePattern()}
            onCreateDesign={() => void handleCreateDesign()}
            onOpenFile={() => void handleOpenFile()}
            showWelcomeOnStartup={showWelcomeOnStartup}
            onToggleShowWelcomeOnStartup={setShowWelcomeOnStartup}
          />
        )}
        <WelcomeLanding />
      </main>
      {/*
        The cue exists to say "there is more below the first screenful". With no
        hero there is no first screenful to get past — the landing is already
        the top of the page — so on a phone it would point at what is on screen.
      */}
      {blocked ? null : (
        <WelcomeScrollCue
          scrollerRef={pageRef}
          targetId={FIRST_LANDING_SECTION_ID}
          onActivate={() => trackCta('scroll')}
        />
      )}
      {blocked ? null : <FileDropOverlay visible={isDragActive} policy={WELCOME_DROP_POLICY} />}
    </div>
  );
}
