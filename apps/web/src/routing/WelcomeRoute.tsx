import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { StartScreen } from '../components/StartScreen';
import { useLayoutStore } from '../store/layoutStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { DESIGN_PATH, EDIT_PATH } from './paths';
import { openedProjectPath } from './landing';

/**
 * The `/welcome` route: the start screen. Creating or opening a document
 * establishes it in the store, then navigates to the workspace that owns it.
 * Arriving here clears transient project state (a discarded dirty flag, a stale
 * error/message) so the start screen is a clean slate.
 */
export function WelcomeRoute() {
  const navigate = useNavigate();
  const status = useWorkspaceStore((state) => state.status);
  const error = useWorkspaceStore((state) => state.error);
  const createNewCreasePattern = useWorkspaceStore((state) => state.createNewCreasePattern);
  const openProject = useWorkspaceStore((state) => state.openProject);

  useEffect(() => {
    const state = useWorkspaceStore.getState();
    useWorkspaceStore.setState({
      dirty: false,
      error: null,
      projectMessage: null,
      status: state.engineReady ? 'ready' : 'loading_engine',
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
    navigate(openedProjectPath());
  }, [navigate, openProject]);

  return (
    <div className="app-layout app-layout--start">
      <StartScreen
        status={status}
        errorMessage={error?.message ?? null}
        onCreateCreasePattern={() => void handleCreateCreasePattern()}
        onCreateDesign={() => void handleCreateDesign()}
        onOpenFile={() => void handleOpenFile()}
      />
    </div>
  );
}
