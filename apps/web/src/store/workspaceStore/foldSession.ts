import type { StoreApi } from 'zustand';
import { trackFoldEngineCrashed } from '../../analytics/trackFoldEngine';
import {
  createFoldSession,
  type FoldSession,
  type FoldSessionDocumentSource,
  type FoldSessionRuntime,
} from '../../fold/session/foldSession';
import {
  askFoldSequenceClient,
  createFoldPreviewChannel,
  foldSequenceClientGeneration,
  foldSequenceEngineSource,
  onFoldSequenceClientLost,
  releaseFoldSequenceClient,
  retainFoldSequenceClient,
} from './foldSequenceRuntime';
import { shownFoldSequence } from './foldState';
import { useWorkspaceStore } from './store';
import type { WorkspaceState } from './types';

// The Fold session as the app runs it (`fold/session/foldSession.ts`): the
// shown sequence from the workspace store's Fold slice, the engine in the Fold
// worker (`foldSequenceRuntime`), errors to the error toast through the
// store's `error`, as the worker-failure sink sends them, and each crash of
// the engine, with what came of it, to analytics.

/** The shown sequence, the reader's place and the load, as the slice holds them. */
export function foldSessionDocumentSource(store: StoreApi<WorkspaceState>): FoldSessionDocumentSource {
  return {
    read: () => {
      const state = store.getState();
      return { loadId: state.foldLoadId, held: shownFoldSequence(state), reader: state.foldReader };
    },
    subscribe: (listener) =>
      store.subscribe((state, previous) => {
        if (
          state.foldSequences !== previous.foldSequences ||
          state.foldReader !== previous.foldReader ||
          state.foldLoadId !== previous.foldLoadId
        ) {
          listener();
        }
      }),
    commit: (draft, loadId) => store.getState().commitFoldStep(draft, { loadId }),
  };
}

/** The Fold worker, reference-counted, as the session drives it. */
export const foldSequenceSessionRuntime: FoldSessionRuntime = {
  retain: () => {
    retainFoldSequenceClient();
  },
  release: releaseFoldSequenceClient,
  generation: foldSequenceClientGeneration,
  onLost: onFoldSequenceClientLost,
  ask: askFoldSequenceClient,
  createChannel: createFoldPreviewChannel,
  source: foldSequenceEngineSource,
};

/**
 * How long the worker and its states outlive the last Fold surface: ten
 * minutes. Long enough to lay out a Diagram page, or fix a crease in Edit,
 * and come back to the step on screen without a replay. Measured on a
 * 67-step model in a dev build: coming back replayed every step, about 3 s
 * before the step on screen was drawn again (0.2–0.3 s kept), while keeping
 * them costs about 2.4 MB of wasm heap and no CPU — the idle worker receives
 * no messages. The web offers no cheap memory-pressure signal, and the timer
 * runs while the page is hidden, so a hidden tab lets go when it runs out (a
 * frozen one runs nothing at all).
 */
export const FOLD_SESSION_LINGER_MS = 10 * 60 * 1000;

let session: FoldSession | null = null;

/**
 * The app's one Fold session, made on first use. It listens to the store from
 * then on, but starts the worker and replays only while a Fold surface holds
 * it (`useFoldSession`), and for {@link FOLD_SESSION_LINGER_MS} after.
 */
export function foldSession(): FoldSession {
  session ??= createFoldSession({
    document: foldSessionDocumentSource(useWorkspaceStore),
    runtime: foldSequenceSessionRuntime,
    reportError: (error) => useWorkspaceStore.setState({ error }),
    onEngineCrash: trackFoldEngineCrashed,
    linger: FOLD_SESSION_LINGER_MS,
  });
  return session;
}
