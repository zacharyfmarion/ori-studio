import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileDropOverlay } from '../components/FileDropOverlay';
import { StartScreen } from '../components/StartScreen';
import { useFileDropTarget } from '../hooks/useFileDropTarget';
import { useWorkspaceErrorText } from '../hooks/useWorkspaceErrorText';
import type { DropTargetPolicy } from '../lib/fileDrop';
import type { AppStatus } from '../lib/sampleProject';
import { useIsWorkspaceBlocked } from '../platform/mobileSurface';
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
 * The `/welcome` route: the start screen. Creating or opening a document
 * establishes it in the store, then navigates to the workspace that owns it.
 * Arriving here clears transient project state (a discarded dirty flag, a stale
 * error/message) so the start screen is a clean slate.
 *
 * Whether a cold start lands here or straight in Edit is decided by the router's
 * index redirect (the "Show welcome on startup" preference), not this component —
 * so returning here intentionally (File › New) always shows the start screen.
 */
export function WelcomeRoute() {
  const navigate = useNavigate();
  const blocked = useIsWorkspaceBlocked();
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
      className="app-layout app-layout--start file-drop-region"
      {...dropTargetProps}
    >
      <main className="welcome-page">
        <StartScreen
          status={status}
          errorMessage={errorText}
          onCreateCreasePattern={() => void handleCreateCreasePattern()}
          onCreateDesign={() => void handleCreateDesign()}
          onOpenFile={() => void handleOpenFile()}
          showWelcomeOnStartup={showWelcomeOnStartup}
          onToggleShowWelcomeOnStartup={setShowWelcomeOnStartup}
        />
      </main>
      <FileDropOverlay visible={isDragActive} policy={WELCOME_DROP_POLICY} />
    </div>
  );
}
