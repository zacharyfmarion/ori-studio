import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileDropOverlay } from '../components/FileDropOverlay';
import { DesktopOnlyNotice } from '../components/landing/DesktopOnlyNotice';
import {
  FIRST_LANDING_SECTION_ID,
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
 * The `/welcome` route: a landing page whose first screenful is either the start
 * screen or, on a phone, the notice saying why there isn't one.
 *
 * The start screen only ever opens. Creating or opening a document establishes it
 * in the store, then navigates to the workspace that owns it. Arriving here
 * clears transient project state (a discarded dirty flag, a stale error/message)
 * so the start screen is a clean slate.
 *
 * A phone gets no start screen, no drop target and no "show welcome on startup"
 * toggle — every one of them offers a way into a workspace it cannot reach. The
 * landing below the fold is the same for both.
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
          <DesktopOnlyNotice onOpenAnyway={() => setPhoneOverride(true)} />
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
      <WelcomeScrollCue scrollerRef={pageRef} targetId={FIRST_LANDING_SECTION_ID} />
      {blocked ? null : <FileDropOverlay visible={isDragActive} policy={WELCOME_DROP_POLICY} />}
    </div>
  );
}
