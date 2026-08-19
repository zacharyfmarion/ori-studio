import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { STORAGE_KEYS, readString, storageKey, writeString } from '../lib/storage';
import type { UpdateInstallKind } from '../platform/updateService';

/**
 * How updates reach the user.
 *
 * `notify` exists because Tauri has no delta updates: every release is a full
 * download, and someone on metered or hotel wifi needs to stop that without
 * also losing the notice. `off` exists because this app works entirely offline
 * and already has an analytics opt-out — a background network call every four
 * hours should be refusable.
 */
export type UpdateDelivery = 'automatic' | 'notify' | 'off';

/**
 * Where an update is in its life.
 *
 * `ready` is the state this whole feature exists to reach: downloaded, verified
 * by the plugin against the compiled-in public key, and installable without
 * another network round trip. Only in `ready` may the UI say "Relaunch".
 */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'unsupported'
  | 'failed';

const DELIVERY_KEY = storageKey(STORAGE_KEYS.updateDelivery);
const SKIPPED_KEY = storageKey(STORAGE_KEYS.updateSkippedVersion);
const HIGHEST_SEEN_KEY = storageKey(STORAGE_KEYS.updateHighestSeenVersion);

function readDelivery(): UpdateDelivery {
  const raw = readString(DELIVERY_KEY);
  return raw === 'notify' || raw === 'off' ? raw : 'automatic';
}

interface UpdateState {
  status: UpdateStatus;
  /** The offered version, or null when there is nothing on offer. */
  version: string | null;
  installKind: UpdateInstallKind | null;
  /** 0-1 while downloading, null when the download is silent or not running. */
  downloadProgress: number | null;
  /** Set when the user asked for this download, which is what makes progress visible. */
  downloadWasRequested: boolean;
  /** When the update became installable, for the pending-time metric. */
  readyAt: number | null;
  lastCheckedAt: number | null;
  delivery: UpdateDelivery;
  skippedVersion: string | null;
  /** Highest version ever offered; a lower one is refused. See STORAGE_KEYS. */
  highestSeenVersion: string | null;
  /** Suppressed for this run only, so a relaunch brings the card back. */
  snoozed: boolean;

  setChecking: () => void;
  setCheckFailed: () => void;
  setNoUpdate: (checkedAt: number) => void;
  setAvailable: (version: string, installKind: UpdateInstallKind, checkedAt: number) => void;
  setUnsupported: (version: string, installKind: UpdateInstallKind, checkedAt: number) => void;
  setDownloading: (requested: boolean) => void;
  setDownloadProgress: (progress: number) => void;
  setReady: (readyAt: number) => void;
  setInstalling: () => void;
  setFailed: () => void;
  /** Forget the offer entirely — used when a release is revoked mid-flight. */
  clearUpdate: () => void;
  setDelivery: (delivery: UpdateDelivery) => void;
  skipCurrentVersion: () => void;
  snoozeForSession: () => void;
}

export const useUpdateStore = create<UpdateState>()(
  devtools(
    (set, get) => ({
      status: 'idle',
      version: null,
      installKind: null,
      downloadProgress: null,
      downloadWasRequested: false,
      readyAt: null,
      lastCheckedAt: null,
      delivery: readDelivery(),
      skippedVersion: readString(SKIPPED_KEY),
      highestSeenVersion: readString(HIGHEST_SEEN_KEY),
      snoozed: false,

      setChecking: () => set({ status: 'checking' }),

      // A failed check leaves any already-staged update alone: losing the
      // network must not retract a "Relaunch to update" the user can still act
      // on, since the payload is already on disk.
      setCheckFailed: () =>
        set((state) => (state.status === 'checking' ? { status: 'failed' } : {})),

      setNoUpdate: (checkedAt) =>
        set({ status: 'idle', version: null, downloadProgress: null, lastCheckedAt: checkedAt }),

      setAvailable: (version, installKind, checkedAt) => {
        const { highestSeenVersion } = get();
        if (highestSeenVersion !== version) {
          writeString(HIGHEST_SEEN_KEY, version);
        }
        set({
          status: 'available',
          version,
          installKind,
          lastCheckedAt: checkedAt,
          highestSeenVersion: version,
          downloadProgress: null,
          // A newer offer retires an older skip, so skipping one release is not
          // a standing opt-out.
          skippedVersion: get().skippedVersion === version ? version : null,
          snoozed: false,
        });
        if (get().skippedVersion === null) {
          writeString(SKIPPED_KEY, '');
        }
      },

      setUnsupported: (version, installKind, checkedAt) =>
        set({
          status: 'unsupported',
          version,
          installKind,
          lastCheckedAt: checkedAt,
          downloadProgress: null,
        }),

      setDownloading: (requested) =>
        set({ status: 'downloading', downloadWasRequested: requested, downloadProgress: 0 }),

      setDownloadProgress: (progress) => set({ downloadProgress: progress }),

      setReady: (readyAt) => set({ status: 'ready', downloadProgress: null, readyAt }),

      setInstalling: () => set({ status: 'installing' }),

      setFailed: () => set({ status: 'failed', downloadProgress: null }),

      clearUpdate: () =>
        set({
          status: 'idle',
          version: null,
          downloadProgress: null,
          downloadWasRequested: false,
          readyAt: null,
        }),

      setDelivery: (delivery) => {
        writeString(DELIVERY_KEY, delivery);
        set({ delivery });
      },

      skipCurrentVersion: () => {
        const { version } = get();
        if (!version) return;
        writeString(SKIPPED_KEY, version);
        set({ skippedVersion: version });
      },

      snoozeForSession: () => set({ snoozed: true }),
    }),
    { name: 'UpdateStore' },
  ),
);

/**
 * Dev-only handle for driving the card by hand.
 *
 * Every state this UI has is reachable only through a real release: an update
 * must exist, be downloaded, and verify. That makes the card almost impossible
 * to look at while building it, and impossible to show someone without cutting
 * a release first. Stripped from production builds by the `import.meta.env.DEV`
 * guard — Rollup removes the whole block.
 *
 *   __oriUpdate.ready('0.3.0')   // the state the feature exists for
 *   __oriUpdate.available('0.3.0')
 *   __oriUpdate.unsupported('0.3.0')  // a .deb install
 *   __oriUpdate.downloading('0.3.0')  // as if the user asked for it
 *   __oriUpdate.reset()
 */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const seed = (patch: Partial<ReturnType<typeof useUpdateStore.getState>>) => {
    useUpdateStore.setState({ skippedVersion: null, snoozed: false, ...patch });
  };
  (window as unknown as Record<string, unknown>).__oriUpdate = {
    ready: (version = '0.3.0') =>
      seed({ status: 'ready', version, installKind: 'app', readyAt: Date.now() }),
    available: (version = '0.3.0') => seed({ status: 'available', version, installKind: 'app' }),
    unsupported: (version = '0.3.0') =>
      seed({ status: 'unsupported', version, installKind: 'other' }),
    downloading: (version = '0.3.0') =>
      seed({ status: 'downloading', version, installKind: 'app', downloadWasRequested: true }),
    reset: () => seed({ status: 'idle', version: null, readyAt: null }),
    store: useUpdateStore,
  };
}

/**
 * Whether the card should be on screen.
 *
 * Kept beside the store rather than inlined in the component because it is the
 * feature's central claim — the chip says "Relaunch to update", so it may only
 * appear when that sentence is true. A silent automatic download renders
 * nothing; one the user asked for shows progress.
 */
export function shouldShowUpdateCard(state: {
  status: UpdateStatus;
  version: string | null;
  skippedVersion: string | null;
  snoozed: boolean;
  downloadWasRequested: boolean;
}): boolean {
  if (!state.version) return false;
  if (state.snoozed) return false;
  if (state.skippedVersion === state.version) return false;
  switch (state.status) {
    case 'ready':
    case 'installing':
    case 'available':
    case 'unsupported':
      return true;
    case 'downloading':
      return state.downloadWasRequested;
    default:
      return false;
  }
}
