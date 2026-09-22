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

/**
 * Why the shell's check failed. Mirrors `UpdateCheckErrorKind` in
 * `apps/tauri/src-tauri/src/updater.rs` and is a subset of the analytics
 * `UpdateFailureReason`; the strings are that enum and must stay in step.
 *
 * Named in the shell because only it can: the updater plugin reports every
 * transport failure as the same "error sending request" string, and the cause
 * — a DNS miss, a refused connection, a rejected certificate, a proxy that
 * would not carry the request — lives in the Rust error's source chain.
 */
export type UpdateCheckErrorKind =
  | 'dns'
  | 'connect'
  | 'tls'
  | 'proxy'
  | 'timeout'
  | 'network'
  | 'http_status'
  | 'parse'
  | 'no_platform_entry'
  | 'signature'
  | 'unsupported'
  | 'unknown';

const UPDATE_CHECK_ERROR_KINDS: ReadonlySet<string> = new Set<UpdateCheckErrorKind>([
  'dns',
  'connect',
  'tls',
  'proxy',
  'timeout',
  'network',
  'http_status',
  'parse',
  'no_platform_entry',
  'signature',
  'unsupported',
  'unknown',
]);

function isUpdateCheckErrorKind(value: unknown): value is UpdateCheckErrorKind {
  return typeof value === 'string' && UPDATE_CHECK_ERROR_KINDS.has(value);
}

/**
 * How long a check may take before it is reported as `timeout`.
 *
 * The manifest is 2.4 KB; thirty seconds is generous on any network that works
 * at all. Without a budget the plugin waits on the socket indefinitely, and a
 * check that never finishes is the one failure that reports nothing.
 */
export const UPDATE_CHECK_TIMEOUT_MS = 30_000;

/** A check the shell ran and classified. `kind` is what analytics counts. */
export class UpdateCheckError extends Error {
  readonly kind: UpdateCheckErrorKind;

  constructor(kind: UpdateCheckErrorKind, message: string) {
    super(message);
    this.name = 'UpdateCheckError';
    this.kind = kind;
  }
}

/**
 * The rejection `update_check` produces, as `invoke` hands it over: an object
 * carrying the `kind` the shell chose and the cause chain as `message`.
 * Anything else — a kind this build does not know, the plugin's bare string —
 * becomes a plain Error, so the classifier reads the message rather than
 * trusting a value from outside the enum.
 */
function toCheckError(rejection: unknown): Error {
  if (rejection instanceof Error) return rejection;
  if (typeof rejection === 'object' && rejection !== null) {
    const { kind, message } = rejection as { kind?: unknown; message?: unknown };
    const text = typeof message === 'string' ? message : String(kind ?? rejection);
    return isUpdateCheckErrorKind(kind) ? new UpdateCheckError(kind, text) : new Error(text);
  }
  return new Error(String(rejection));
}

/** The plugin's own metadata shape, which its `Update` class is built from. */
type NativeUpdateMetadata = {
  rid: number;
  currentVersion: string;
  version: string;
  date?: string | null;
  body?: string | null;
  rawJson: Record<string, unknown>;
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
 * The check runs in the shell (`update_check`), which runs the plugin's own
 * check and classifies a failure from the Rust error chain; the offered update
 * comes back in the plugin's metadata shape and is wrapped in the plugin's
 * `Update` class, so download and install are still the plugin's.
 *
 * Note this verifies *nothing*: the plugin checks the signature at the end of
 * {@link downloadUpdate}, on the completed payload. A manifest signed with the
 * wrong key looks perfectly healthy here.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  assertDesktop();
  const { invoke } = await import('@tauri-apps/api/core');
  let metadata: NativeUpdateMetadata | null;
  try {
    metadata = await invoke<NativeUpdateMetadata | null>('update_check', {
      timeoutMs: UPDATE_CHECK_TIMEOUT_MS,
    });
  } catch (rejection) {
    throw toCheckError(rejection);
  }
  if (!metadata) {
    pendingUpdate = null;
    return null;
  }
  const { Update } = await import('@tauri-apps/plugin-updater');
  const update = new Update({
    ...metadata,
    // The shell serializes an absent value as null; the plugin's type says undefined.
    date: metadata.date ?? undefined,
    body: metadata.body ?? undefined,
  });
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
