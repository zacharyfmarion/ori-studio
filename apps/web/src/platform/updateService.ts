import { isDesktopRuntime } from './runtime';

/**
 * Which bundle format this build was installed from. Mirrors `InstallKind` in
 * `apps/tauri/src-tauri/src/updater.rs`; the strings are the analytics enum and
 * must stay in step with it.
 */
export type UpdateInstallKind = 'app' | 'nsis' | 'appimage' | 'other';

export type UpdateEnvironment = {
  installKind: UpdateInstallKind;
  /**
   * False on a Linux package install. Such a build can only be updated through
   * `pkexec` — a root-password prompt every release — so it is offered a
   * download link instead of an in-place update.
   */
  selfUpdateSupported: boolean;
};

export type AvailableUpdate = {
  version: string;
  /** Release notes, as published. English only; see the plan's i18n note. */
  notes?: string;
  publishedAt?: string;
};

/** The web build must never pull the Tauri updater into its bundle. */
function assertDesktop(): void {
  if (!isDesktopRuntime()) {
    throw new Error('the updater is desktop-only');
  }
}

/**
 * The `Update` handle from the last successful {@link checkForUpdate}.
 *
 * Held at module scope rather than in the store because it is a `Resource` with
 * a Rust-side handle — it is not serializable, and putting it in Zustand would
 * invite it being structurally cloned or compared. The store holds the version
 * string; this holds the thing you can actually install.
 */
let pendingUpdate: { version: string; handle: unknown } | null = null;

/** Test seam: the store's reducers are pure, so only this module needs resetting. */
export function resetUpdateServiceForTest(): void {
  pendingUpdate = null;
}

export async function readUpdateEnvironment(): Promise<UpdateEnvironment> {
  assertDesktop();
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<UpdateEnvironment>('update_environment');
}

/**
 * Ask the endpoint whether a newer version exists.
 *
 * Note this verifies *nothing*: the plugin checks the signature at the end of
 * {@link downloadUpdate}, on the completed payload. A manifest signed with the
 * wrong key looks perfectly healthy here.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  assertDesktop();
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) {
    pendingUpdate = null;
    return null;
  }
  pendingUpdate = { version: update.version, handle: update };
  return { version: update.version, notes: update.body, publishedAt: update.date };
}

/**
 * Download and verify, without installing.
 *
 * Deliberately not `downloadAndInstall`. The whole affordance rests on there
 * being a state where the update is on disk, verified, and waiting — so that
 * "Relaunch to update" is a true statement rather than the start of a download.
 */
export async function downloadUpdate(version: string): Promise<void> {
  assertDesktop();
  if (pendingUpdate?.version !== version) {
    throw new Error(`no pending update for ${version}`);
  }
  const update = pendingUpdate.handle as { download: () => Promise<void> };
  await update.download();
}

/**
 * Install the downloaded update and restart into it.
 *
 * On Windows this exits the process rather than returning, which is why the
 * unsaved-work guard has to run *before* this call and cannot live in a
 * window-close handler.
 */
export async function installUpdateAndRelaunch(version: string): Promise<void> {
  assertDesktop();
  if (pendingUpdate?.version !== version) {
    throw new Error(`no pending update for ${version}`);
  }
  const update = pendingUpdate.handle as { install: () => Promise<void> };
  await update.install();
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

/** Drop a staged update, so a revoked release cannot be relaunched into. */
export async function discardPendingUpdate(): Promise<void> {
  const update = pendingUpdate?.handle as { close?: () => Promise<void> } | undefined;
  pendingUpdate = null;
  try {
    await update?.close?.();
  } catch {
    // The handle is being thrown away; a failure to close it changes nothing.
  }
}
