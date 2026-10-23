import { lazyModule } from '../lib/lazyModule';
import type { OpenTextFileResult } from '../platform/fileService';
import type * as WorkspaceEntry from './workspaceEntry';

/**
 * The one door into the workspace.
 *
 * The landing page and the site pages render without the editor: its code (the stores, the
 * engines' clients, Dockview, Lexical, regl — about 70% of the app) loads through here the
 * first time something needs it. The workspace routes need it to render; the start screen
 * asks for it on the first sign of intent, and awaits it when a start action runs.
 *
 * One `import()` for all of it, so the workspace is one chunk rather than a scatter of
 * route-sized ones that would each have to be warmed for offline use.
 */

type Workspace = typeof WorkspaceEntry;

/** What a start action asks of the page once it has run. */
export type StartOutcome =
  | { kind: 'navigate'; path: string }
  | { kind: 'error'; message: string }
  | { kind: 'stay' };

const workspace = lazyModule<Workspace>(() => import('./workspaceEntry'));

/** Load the workspace; a failed load (offline, say) is not remembered, so the next click retries. */
export function loadWorkspace(): Promise<Workspace> {
  return workspace.load();
}

/** The workspace if it has loaded, without asking for it. */
export function loadedWorkspace(): Workspace | null {
  return workspace.loaded();
}

export function useLoadedWorkspace(): Workspace | null {
  return workspace.useLoaded();
}

/**
 * Load the workspace and boot the engine ahead of a start action — on hover, focus or a
 * press of one, or a file dragged onto the page. Never on page load: evaluating the
 * workspace is the long main-thread task this whole split exists to keep off first paint.
 */
export function prefetchWorkspace(): void {
  void loadWorkspace()
    .then((workspace) => workspace.ensureEngineBooted())
    .catch(() => undefined);
}

export const startActions = {
  createCreasePattern: () => loadWorkspace().then((workspace) => workspace.createCreasePatternFromStart()),
  createDesign: () => loadWorkspace().then((workspace) => workspace.createDesignFromStart()),
  openPicked: (picked: Promise<OpenTextFileResult | null>) =>
    loadWorkspace().then((workspace) => workspace.openProjectFromStart(picked)),
  dropFiles: (files: File[]) => loadWorkspace().then((workspace) => workspace.dropOnStart(files)),
};

export function resetWorkspaceForTest(): void {
  workspace.resetForTest();
}
