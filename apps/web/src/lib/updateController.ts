import {
  ANALYTICS_EVENTS,
  UPDATE_PENDING_MS_BUCKETS,
  bucketCount,
  track,
} from '../analytics';
import type { UpdateFailureReason, UpdateFailureStage, UpdateTrigger } from '../analytics/events';
import { reportError } from '../monitoring';
import {
  checkForUpdate,
  discardPendingUpdate,
  downloadUpdate,
  installUpdateAndRelaunch,
  readUpdateEnvironment,
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
 * `signature` is the one that matters: the plugin verifies the downloaded
 * payload against the public key compiled into this binary, so a failure there
 * is either a corrupted object or a key mismatch — and a key mismatch is
 * fleet-wide, affecting every install at once.
 */
export function classifyUpdateError(error: unknown): UpdateFailureReason {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.includes('signature') || message.includes('minisign')) return 'signature';
  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('timeout') ||
    message.includes('connect') ||
    message.includes('dns')
  ) {
    return 'network';
  }
  return 'unknown';
}

function reportFailure(
  stage: UpdateFailureStage,
  reason: UpdateFailureReason,
  error: unknown,
  trigger: UpdateTrigger
): void {
  const installKind = useUpdateStore.getState().installKind;
  track(ANALYTICS_EVENTS.appUpdateFailed, { stage, reason, install_kind: installKind, trigger });
  // A signature failure is the only automatic failure worth a crash report: it
  // is never routine, and it is the single fleet-wide signal that the release
  // was signed with the wrong key. Network failures are expected and silent.
  if (reason === 'signature') {
    reportError(error, { surface: `updater:${stage}` });
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
  try {
    const environment = await readUpdateEnvironment();
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
      reportFailure('check', 'stale_manifest', new Error('stale manifest'), trigger);
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
    reportFailure('check', classifyUpdateError(error), error, trigger);
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
    reportFailure('download', classifyUpdateError(error), error, trigger);
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
    reportFailure('install', classifyUpdateError(error), error, 'manual');
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
