import { useSyncExternalStore } from 'react';
import { importOrReload } from '../lib/importOrReload';
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

let loading: Promise<Workspace> | null = null;
let loaded: Workspace | null = null;
const listeners = new Set<() => void>();

export function loadWorkspace(): Promise<Workspace> {
  if (loading) return loading;
  const pending = importOrReload(() => import('./workspaceEntry')).then((workspace) => {
    loaded = workspace;
    for (const listener of listeners) listener();
    return workspace;
  });
  // A failed load (offline, say) must not be remembered: the next click should retry.
  pending.catch(() => {
    if (loading === pending) loading = null;
  });
  loading = pending;
  return pending;
}

/** The workspace if it has loaded, without asking for it. */
export function loadedWorkspace(): Workspace | null {
  return loaded;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLoadedWorkspace(): Workspace | null {
  return useSyncExternalStore(subscribe, loadedWorkspace, () => null);
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
  loading = null;
  loaded = null;
  listeners.clear();
}
