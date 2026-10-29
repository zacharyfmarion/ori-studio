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

/** What `update_check` returns: the plugin's own metadata shape. */
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
 * The offer from the last successful {@link checkForUpdate}, and its payload
 * once {@link downloadUpdate} has fetched and verified it.
 *
 * Both are handles into the shell's resource table — the update the plugin
 * found, and the verified bytes — so they live at module scope rather than in
 * the store: they are not serializable, and the store holds the version string.
 */
let pendingUpdate: { version: string; rid: number; payloadRid: number | null } | null = null;

/** Test seam: the store's reducers are pure, so only this module needs resetting. */
export function resetUpdateServiceForTest(): void {
  pendingUpdate = null;
}

/** Release shell-side handles; a failure to close one changes nothing. */
async function closeResources(...rids: Array<number | null>): Promise<void> {
  const { Resource } = await import('@tauri-apps/api/core');
  await Promise.all(
    rids
      .filter((rid): rid is number => rid !== null)
      .map((rid) => new Resource(rid).close().catch(() => {}))
  );
}

/** Whether `version` is downloaded, verified and waiting to be installed. */
export function isUpdateStaged(version: string): boolean {
  return pendingUpdate?.version === version && pendingUpdate.payloadRid !== null;
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
 * check and classifies a failure from the Rust error chain.
 *
 * An offer of the version already staged keeps the staged payload: the release
 * has not changed, so neither has what was verified, and fetching it again
 * every four hours is how one machine downloaded the same 50 MB forty times.
 *
 * Note this verifies *nothing*: the payload's signature is checked at the end
 * of {@link downloadUpdate}. A manifest signed with the wrong key looks
 * perfectly healthy here.
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
  const offer = metadata && {
    version: metadata.version,
    // The shell serializes an absent value as null.
    notes: metadata.body ?? undefined,
    publishedAt: metadata.date ?? undefined,
  };
  if (metadata && isUpdateStaged(metadata.version)) {
    await closeResources(metadata.rid);
    return offer;
  }
  const previous = pendingUpdate;
  pendingUpdate = metadata && { version: metadata.version, rid: metadata.rid, payloadRid: null };
  if (previous) await closeResources(previous.rid, previous.payloadRid);
  return offer;
}

/**
 * Download and verify, without installing.
 *
 * Deliberately not download-and-install. The whole affordance rests on there
 * being a state where the update is verified and waiting — so that "Relaunch to
 * update" is a true statement rather than the start of a download.
 *
 * The shell's `update_download` rather than the plugin's: it resumes a dropped
 * connection where the plugin's starts over, and it says why it failed.
 */
export async function downloadUpdate(version: string): Promise<void> {
  assertDesktop();
  const pending = pendingUpdate;
  if (pending?.version !== version) {
    throw new Error(`no pending update for ${version}`);
  }
  if (pending.payloadRid !== null) return;
  const { invoke } = await import('@tauri-apps/api/core');
  let payloadRid: number;
  try {
    payloadRid = await invoke<number>('update_download', { rid: pending.rid });
  } catch (rejection) {
    throw toCheckError(rejection);
  }
  if (pendingUpdate !== pending) {
    // A newer offer replaced this one while it downloaded.
    await closeResources(payloadRid);
    throw new Error(`the offer for ${version} was replaced while it downloaded`);
  }
  pending.payloadRid = payloadRid;
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
  const pending = pendingUpdate;
  if (pending?.version !== version || pending.payloadRid === null) {
    throw new Error(`no downloaded update for ${version}`);
  }
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    await invoke('update_install', { updateRid: pending.rid, payloadRid: pending.payloadRid });
  } catch (rejection) {
    throw toCheckError(rejection);
  }
  pending.payloadRid = null;
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

/** Drop a staged update, so a revoked release cannot be relaunched into. */
export async function discardPendingUpdate(): Promise<void> {
  const pending = pendingUpdate;
  pendingUpdate = null;
  if (pending) await closeResources(pending.rid, pending.payloadRid);
}
