import App from '../App';
import { handleFileDrop } from '../commands/fileDropController';
import { installWorkspaceErrorFacts } from '../components/errors/workspaceErrorFacts';
import { TooltipProvider } from '../components/ui/Tooltip';
import { WorkspaceShell } from '../components/WorkspaceShell';
import i18n from '../i18n';
import { humanizeError } from '../lib/toastMessages';
import { createPickedFileService, type OpenTextFileResult } from '../platform/fileService';
import { useLayoutStore } from '../store/layoutStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { ensureEngineBooted } from '../store/workspaceStore/engineBoot';
import { currentWorkspacePath } from './landing';
import { DESIGN_PATH, EDIT_PATH } from './paths';
import { ShareRoute } from './ShareRoute';
import type { StartOutcome } from './workspaceGateway';

/**
 * The workspace, as `workspaceGateway.ts` loads it: everything the landing page does not
 * need, behind one `import()`. Nothing outside the gateway imports this module.
 */

installWorkspaceErrorFacts();

export { App, ensureEngineBooted, ShareRoute };

export function WorkspaceShellRoute() {
  return (
    <TooltipProvider>
      <WorkspaceShell />
    </TooltipProvider>
  );
}

/**
 * Run a start action once the engine is up, and say where it leaves the start screen.
 *
 * The start screen used to keep its buttons disabled until the engine had booted; now a
 * press waits here instead. An error counts only if the action raised it — the store can
 * still hold one from an earlier attempt.
 */
async function runFromStart(
  action: () => Promise<boolean>,
  destination: () => string
): Promise<StartOutcome> {
  await ensureEngineBooted();
  const before = useWorkspaceStore.getState();
  if (!before.engineReady) {
    return before.error
      ? { kind: 'error', message: humanizeError(before.error, i18n.t) }
      : { kind: 'stay' };
  }
  const proceeded = await action();
  const after = useWorkspaceStore.getState();
  if (after.status === 'error' && after.error && after.error !== before.error) {
    return { kind: 'error', message: humanizeError(after.error, i18n.t) };
  }
  return proceeded ? { kind: 'navigate', path: destination() } : { kind: 'stay' };
}

export function createCreasePatternFromStart(): Promise<StartOutcome> {
  return runFromStart(async () => {
    await useWorkspaceStore.getState().createNewCreasePattern();
    return true;
  }, () => EDIT_PATH);
}

/** Into the Design workspace's method chooser, not a blank tree. */
export function createDesignFromStart(): Promise<StartOutcome> {
  return runFromStart(async () => {
    useWorkspaceStore.getState().startNewDesign();
    return true;
  }, () => DESIGN_PATH);
}

export function openProjectFromStart(picked: Promise<OpenTextFileResult | null>): Promise<StartOutcome> {
  return runFromStart(
    () => useWorkspaceStore.getState().openProject(createPickedFileService(picked)),
    currentWorkspacePath
  );
}

/** The drop controller navigates when it opens something, so this never does. */
export function dropOnStart(files: File[]): Promise<StartOutcome> {
  return runFromStart(async () => {
    await handleFileDrop({ files, policy: 'open-only' });
    return false;
  }, currentWorkspacePath);
}

/**
 * Arriving at the start screen clears transient project state — a discarded dirty flag, a
 * stale error or message — so it is a clean slate. Only once the workspace has loaded: before
 * that there is nothing to clear.
 */
export function resetForStartScreen(): void {
  const { engineReady } = useWorkspaceStore.getState();
  useWorkspaceStore.setState({
    dirty: false,
    error: null,
    projectMessage: null,
    status: engineReady ? 'ready' : 'loading_engine',
  });
  useLayoutStore.getState().setActiveWorkspace('design');
}
