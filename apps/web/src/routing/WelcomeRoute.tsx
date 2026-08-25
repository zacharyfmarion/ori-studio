import { useCallback, useEffect, useRef } from 'react';
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
import { useWorkspaceErrorText } from '../hooks/useWorkspaceErrorText';
import type { DropTargetPolicy } from '../lib/fileDrop';
import type { AppStatus } from '../lib/sampleProject';
import {
  useIsPhoneSurface,
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
 * It used to take a third argument, for a phone whose engine was never started —
 * writing `loading_engine` there would have announced a load that never
 * resolved. Every device boots the engine now, so the answer is the same one
 * everywhere.
 */
function resetStatus(engineReady: boolean): AppStatus {
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
 * Every device gets the same page. A phone used to get a compact masthead with a
 * single "Open App (unoptimized on mobile)" button instead, and the start screen
 * only appeared once you had clicked past it — so the three ways in and the
 * "Show welcome on startup" toggle were behind a warning. The stylesheet already
 * stacks the hero and the three actions into one column below 680px, which is
 * what that click revealed; it is the default now.
 *
 * Whether a cold start lands here or straight in Edit is decided by the router's
 * index redirect (the "Show welcome on startup" preference), not this component —
 * so returning here intentionally (File › New) always shows the start screen.
 */
export function WelcomeRoute() {
  const navigate = useNavigate();
  const pageRef = useRef<HTMLElement | null>(null);
  // Only for `data-surface`, which the landing sections below read. The page
  // itself no longer branches on it.
  const phone = useIsPhoneSurface();
  const status = useWorkspaceStore((state) => state.status);
  const errorText = useWorkspaceErrorText();
  const createNewCreasePattern = useWorkspaceStore((state) => state.createNewCreasePattern);
  const openProject = useWorkspaceStore((state) => state.openProject);
  const showWelcomeOnStartup = useSettingsStore((state) => state.showWelcomeOnStartup);
  const setShowWelcomeOnStartup = useSettingsStore((state) => state.setShowWelcomeOnStartup);
  const { dropTargetProps, isDragActive } = useFileDropTarget({ policy: WELCOME_DROP_POLICY });

  useLandingViewedEvent(phone ? 'phone' : 'desktop');
  useLandingSectionViewedEvents(pageRef, LANDING_SECTIONS);

  useEffect(() => {
    const state = useWorkspaceStore.getState();
    useWorkspaceStore.setState({
      dirty: false,
      error: null,
      projectMessage: null,
      status: resetStatus(state.engineReady),
    });
    useLayoutStore.getState().setActiveWorkspace('design');
  }, []);

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
      className="app-layout app-layout--start file-drop-region"
      data-surface={phone ? 'phone' : undefined}
      {...dropTargetProps}
    >
      <main className="welcome-page" ref={pageRef}>
        <StartScreen
          status={status}
          errorMessage={errorText}
          onCreateCreasePattern={() => void handleCreateCreasePattern()}
          onCreateDesign={() => void handleCreateDesign()}
          onOpenFile={() => void handleOpenFile()}
          showWelcomeOnStartup={showWelcomeOnStartup}
          onToggleShowWelcomeOnStartup={setShowWelcomeOnStartup}
        />
        <WelcomeLanding />
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
