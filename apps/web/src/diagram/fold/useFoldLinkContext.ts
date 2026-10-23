import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { loadedFold, prefetchFold, useLoadedFold } from '../../workspaces/foldGateway';
import type { FoldSession } from '../../fold/session/foldSession';
import type { FoldSessionSnapshot } from '../../fold/session/foldSessionState';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { FoldLinkContext, FoldLinkReplay } from './foldStepLink';

/**
 * What a Diagram step linked to a Fold step is told against (plan D17): the
 * project's sequences as the store holds them, and the Fold session's replay
 * of the one it shows. Store-bound: the app's one session (`foldSession`).
 *
 * The session is Fold's code (`foldGateway`): loaded once the diagram has a
 * link the replay can tell, and until then there is no replay to read — an
 * unheld session replays nothing either, so every such link reads `unknown`
 * until it lands, as it did while the engine started.
 */

/** The session's replay as a link reads it; null while nothing holds the session. */
function replayOf(snapshot: FoldSessionSnapshot): FoldLinkReplay | null {
  if (!snapshot.live) return null;
  return { sequenceId: snapshot.sequence?.id ?? null, sheet: snapshot.sheet, nodes: snapshot.nodes };
}

/**
 * The context as it stands now, for a surface that builds its verbs at the
 * moment it needs them (a context menu opening).
 */
export function foldLinkContextNow(): FoldLinkContext {
  const session = loadedFold()?.foldSession() ?? null;
  return {
    sequences: useWorkspaceStore.getState().foldSequences,
    replay: session ? replayOf(session.store.getState()) : null,
  };
}

const NO_SUBSCRIPTION = () => () => undefined;

/** One field of the session's snapshot, kept current; `none` while there is no session. */
function useSessionField<T>(session: FoldSession | null, select: (snapshot: FoldSessionSnapshot) => T, none: T): T {
  return useSyncExternalStore(session ? session.store.subscribe : NO_SUBSCRIPTION, () =>
    session ? select(session.store.getState()) : none
  );
}

/**
 * The context, kept current — and, while `wants` (the diagram has a Fold
 * link to tell), the session held, so the engine replays the shown sequence
 * and every link can be told: an unheld session replays nothing, and every
 * link reads `unknown`.
 */
export function useFoldLinkContext(wants: boolean): FoldLinkContext {
  const session = useLoadedFold()?.foldSession() ?? null;
  useEffect(() => {
    if (wants) prefetchFold();
  }, [wants]);
  useEffect(() => (wants && session ? session.retain() : undefined), [session, wants]);
  const sequences = useWorkspaceStore((state) => state.foldSequences);
  const live = useSessionField(session, (snapshot) => snapshot.live, false);
  const sequenceId = useSessionField(session, (snapshot) => snapshot.sequence?.id ?? null, null);
  const sheet = useSessionField(session, (snapshot) => snapshot.sheet, null);
  const nodes = useSessionField(session, (snapshot) => snapshot.nodes, null);
  return useMemo(
    () => ({ sequences, replay: live && sheet && nodes ? { sequenceId, sheet, nodes } : null }),
    [sequences, live, sequenceId, sheet, nodes]
  );
}
