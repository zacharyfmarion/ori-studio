import { useWorkspaceStore } from '../workspaceStore';

let boot: Promise<void> | null = null;

/**
 * Boot the engine once per page.
 *
 * Two callers race for it now — the start screen warming the editor on intent, and `App`
 * mounting — and `initEngine` resets the workspace to a blank tree whenever no crease
 * pattern is open, so a second run could wipe a design started in between.
 */
export function ensureEngineBooted(): Promise<void> {
  boot ??= useWorkspaceStore.getState().initEngine();
  return boot;
}
