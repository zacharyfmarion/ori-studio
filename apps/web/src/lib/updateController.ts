import {
  ANALYTICS_EVENTS,
  UPDATE_PENDING_MS_BUCKETS,
  bucketCount,
  track,
} from '../analytics';
import type { UpdateFailureReason, UpdateFailureStage, UpdateTrigger } from '../analytics/events';
import { reportError } from '../monitoring';
import {
  UpdateCheckError,
  checkForUpdate,
  discardPendingUpdate,
  downloadUpdate,
  installUpdateAndRelaunch,
  readUpdateEnvironment,
  type UpdateEnvironment,
  type UpdateInstallKind,
} from '../platform/updateService';
import { useUpdateStore } from '../store/updateStore';

/**
 * Compares two dotted version strings numerically.
 *
 * Returns >0 when `a` is newer. Only the numeric prefix of each component is
 * read, so a pre-release suffix sorts with its release — good enough for the one
 * question asked of it (is this offer older than something already seen), and it
 * deliberately never throws on a shape it does not recognize.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Classifies a thrown updater error into the analytics enum.
 *
 * A check failure arrives already classified: the shell ran the check and read
 * the cause off the Rust error chain, which is the only place a transport
 * failure says what it was — the plugin's message for every one of them is
 * "error sending request for url (…)", which is how half the Windows fleet
 * spent a month filed under `unknown`. Everything else, the plugin's own
 * download and install commands, arrives as that message, matched here against
 * the phrases the plugin actually emits (`tauri-plugin-updater` 2.10's
 * `error.rs`, reqwest 0.13's `Display`), most specific first.
 *
 * `signature` is the one that matters: the plugin verifies the downloaded
 * payload against the public key compiled into this binary, so a failure there
 * is either a corrupted object or a key mismatch — and a key mismatch is
 * fleet-wide, affecting every install at once.
 */
export function classifyUpdateError(error: unknown): UpdateFailureReason {
  if (error instanceof UpdateCheckError) return error.kind;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (
    message.includes('signature') ||
    message.includes('minisign') ||
    // base64's decode errors; the only base64 the plugin decodes is the signature.
    message.includes('invalid symbol') ||
    message.includes('invalid last symbol') ||
    message.includes('invalid padding') ||
    message.includes('invalid input length')
  ) {
    return 'signature';
  }
  if (message.includes('not found in the response') || message.includes('fallback platforms')) {
    return 'no_platform_entry';
  }
  // The plugin's non-2xx path says "Could not fetch a valid release JSON" — it
  // contains "fetch", so it is tested before the transport keywords.
  if (message.includes('could not fetch a valid release') || message.includes('failed with status')) {
    return 'http_status';
  }
  if (
    message.includes('error decoding response body') ||
    message.includes('missing field') ||
    message.includes('invalid value') ||
    message.includes('invalid type') ||
    message.includes('unexpected character') ||
    message.includes('field was not set')
  ) {
    return 'parse';
  }
  if (message.includes('timed out') || message.includes('timeout')) return 'timeout';
  if (
    message.includes('error sending request') ||
    message.includes('error following redirect') ||
    message.includes('body error') ||
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('connect') ||
    message.includes('dns')
  ) {
    return 'network';
  }
  return 'unknown';
}

/**
 * The reasons that say the *published release* is wrong rather than one
 * machine's network. Each is fleet-wide and none is routine, so each is worth
 * a crash report with the message attached. The transport classes are expected
 * — this app works offline — and stay out of Sentry.
 */
const FLEET_WIDE_REASONS: ReadonlySet<UpdateFailureReason> = new Set<UpdateFailureReason>([
  'signature',
  'parse',
  'no_platform_entry',
  'http_status',
  'stale_manifest',
]);

function reportFailure(
  stage: UpdateFailureStage,
  reason: UpdateFailureReason,
  error: unknown,
  trigger: UpdateTrigger,
  installKind: UpdateInstallKind | null
): void {
  track(ANALYTICS_EVENTS.appUpdateFailed, { stage, reason, install_kind: installKind, trigger });
  if (FLEET_WIDE_REASONS.has(reason)) {
    reportError(error, { surface: `updater:${stage}`, tags: { reason } });
  }
}

/**
 * What a check settled on.
 *
 * `'skipped'` means the check never ran — delivery is off, or a download is
 * already in flight. It is distinct from `'none'` because only `'none'` licenses
 * saying "you're up to date"; reporting that after a check that did not happen
 * would be a claim about the world made from no evidence.
 */
export type UpdateCheckOutcome = 'skipped' | 'none' | 'available' | 'unsupported' | 'failed';

/**
 * Run one update check, and start the download when policy allows.
 *
 * Failures are deliberately silent for automatic checks — this app works
 * offline, and a toast every four hours on a train is worse than no updater at
 * all. The caller surfaces manual failures, which is what the returned outcome
 * is for: it reports what the check settled on, including `'skipped'` for the
 * early returns, so a caller can tell "nothing to report" from "nothing found"
 * instead of inferring it from store state the check never touched.
 *
 * It resolves rather than rejects even when the check fails. Every caller is an
 * event handler or a timer that must not throw, and each one previously carried
 * its own `.catch(() => {})` saying so.
 */
export async function runUpdateCheck(trigger: UpdateTrigger): Promise<UpdateCheckOutcome> {
  const store = useUpdateStore.getState();
  if (store.delivery === 'off' && trigger === 'automatic') return 'skipped';
  if (store.status === 'downloading' || store.status === 'installing') return 'skipped';

  store.setChecking();
  // Read before the check so a failure can say which bundle format failed. The
  // store's `installKind` is set only once an update is offered, which is why
  // every check failure used to carry an empty one.
  let environment: UpdateEnvironment | null = null;
  try {
    environment = await readUpdateEnvironment();
    const update = await checkForUpdate();
    const checkedAt = Date.now();

    if (!update) {
      useUpdateStore.getState().setNoUpdate(checkedAt);
      track(ANALYTICS_EVENTS.appUpdateChecked, { result: 'none', trigger });
      return 'none';
    }

    // Refuse an offer older than one already seen. minisign proves a payload's
    // integrity, not its freshness, so an old-but-validly-signed release could
    // otherwise be replayed to hold the fleet back from a fix.
    const { highestSeenVersion } = useUpdateStore.getState();
    if (highestSeenVersion && compareVersions(update.version, highestSeenVersion) < 0) {
      useUpdateStore.getState().setNoUpdate(checkedAt);
      track(ANALYTICS_EVENTS.appUpdateChecked, { result: 'error', trigger });
      reportFailure(
        'check',
        'stale_manifest',
        new Error('stale manifest'),
        trigger,
        environment.installKind
      );
      return 'none';
    }

    track(ANALYTICS_EVENTS.appUpdateChecked, { result: 'available', trigger });
    track(ANALYTICS_EVENTS.appUpdateAvailable, {
      trigger,
      install_kind: environment.installKind,
      delivery: useUpdateStore.getState().delivery,
    });

    if (!environment.selfUpdateSupported) {
      useUpdateStore
        .getState()
        .setUnsupported(update.version, environment.installKind, checkedAt);
      return 'unsupported';
    }

    useUpdateStore.getState().setAvailable(update.version, environment.installKind, checkedAt);

    if (useUpdateStore.getState().delivery === 'automatic') {
      await startUpdateDownload('automatic');
    }
    return 'available';
  } catch (error) {
    useUpdateStore.getState().setCheckFailed(Date.now());
    track(ANALYTICS_EVENTS.appUpdateChecked, { result: 'error', trigger });
    reportFailure(
      'check',
      classifyUpdateError(error),
      error,
      trigger,
      environment?.installKind ?? null
    );
    return 'failed';
  }
}

/** Download the offered update. Silent when automatic; visible when requested. */
export async function startUpdateDownload(trigger: UpdateTrigger): Promise<void> {
  const { version, installKind } = useUpdateStore.getState();
  if (!version) return;

  useUpdateStore.getState().setDownloading(trigger === 'manual');
  track(ANALYTICS_EVENTS.appUpdateDownloadStarted, { trigger, install_kind: installKind });

  try {
    await downloadUpdate(version);
    useUpdateStore.getState().setReady(Date.now());
    track(ANALYTICS_EVENTS.appUpdateDownloaded, { trigger, install_kind: installKind });
  } catch (error) {
    useUpdateStore.getState().setFailed();
    reportFailure('download', classifyUpdateError(error), error, trigger, installKind);
    if (trigger === 'manual') throw error;
  }
}

/**
 * Install and restart.
 *
 * The caller must already have dealt with unsaved work: on Windows this exits
 * the process rather than returning, so nothing after it is guaranteed to run
 * and no close handler fires.
 */
export async function relaunchIntoUpdate(): Promise<void> {
  const { version, installKind, readyAt } = useUpdateStore.getState();
  if (!version) return;

  useUpdateStore.getState().setInstalling();
  track(ANALYTICS_EVENTS.appUpdateRelaunched, {
    install_kind: installKind,
    // How long the chip sat there before anyone acted on it — the measure of
    // whether the affordance actually communicates.
    pending_ms_bucket: bucketCount(readyAt ? Date.now() - readyAt : 0, UPDATE_PENDING_MS_BUCKETS),
  });

  try {
    await installUpdateAndRelaunch(version);
  } catch (error) {
    useUpdateStore.getState().setFailed();
    reportFailure('install', classifyUpdateError(error), error, 'manual', installKind);
    throw error;
  }
}

/**
 * Drop a staged update because the offer has gone away.
 *
 * Un-arming a release stops it being *offered*; it does nothing about the copies
 * already downloaded and waiting on disk, which — given an update can sit for
 * days — is most of the exposed population. Without this, a kill switch is a
 * kill suggestion.
 */
export async function revokeStagedUpdate(): Promise<void> {
  const { status } = useUpdateStore.getState();
  if (status !== 'ready' && status !== 'available') return;
  await discardPendingUpdate();
  useUpdateStore.getState().clearUpdate();
  track(ANALYTICS_EVENTS.appUpdateDismissed, { scope: 'revoked' });
}
