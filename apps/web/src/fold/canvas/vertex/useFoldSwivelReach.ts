import { useEffect, useMemo, useState } from 'react';
import { reportError } from '../../../monitoring';
import { canonicalJson } from '../../document/foldDigest';
import type { FoldSessionSurface } from '../../session/useFoldSession';
import type { FoldToolState } from '../../tools/foldToolState';
import {
  SWIVEL_REACH_ASKING,
  swivelReachAsk,
  swivelReachView,
  type FoldSwivelReach,
  type FoldSwivelReachView,
} from '../../tools/vertex/swivelReach';
import type { FoldPickIndex } from '../foldPicking';

/**
 * A swivel's reach from where its creases meet (`tools/vertex/swivelReach`):
 * once that point is clicked, every edge and line either pane offers is
 * asked of the worker in one call, and the answer kept for the state, the
 * point and the folder's way — what the canvas lights and previews at the
 * next two clicks, and what the window says when nothing can swing. Asked
 * again only when one of those changes, never as the pointer moves. A swivel
 * on a folded edge is asked open first: its kind is chosen only once it is
 * previewed, when the reach offers nothing more.
 *
 * Null for any other tool, before the meeting point, and for a target named
 * by two points; asking until the worker answers.
 */
export function useFoldSwivelReach(
  session: Pick<FoldSessionSurface, 'withCursor'>,
  stateKey: string | null,
  index: FoldPickIndex | null,
  tools: Pick<FoldToolState, 'tool' | 'swivelTarget' | 'picks' | 'vertexDirection'>,
  enabled: boolean
): FoldSwivelReachView | null {
  const { withCursor } = session;
  const { tool, swivelTarget, picks, vertexDirection } = tools;
  const meet = picks[0];
  const ask = useMemo(
    () =>
      enabled && index && meet
        ? swivelReachAsk(index, { tool, swivelTarget, picks: [meet], vertexDirection })
        : null,
    [enabled, index, tool, swivelTarget, meet, vertexDirection]
  );
  const key = ask && stateKey ? `${stateKey}|${canonicalJson(ask.at)}|${ask.direction}` : null;
  const [answer, setAnswer] = useState<{ key: string; reach: FoldSwivelReach } | null>(null);
  useEffect(() => {
    if (key === null || !ask || answer?.key === key) return undefined;
    let current = true;
    void withCursor((engine, at) => engine.swivelReach(at, ask)).then(
      (reply) => {
        if (current && reply.status === 'answered') setAnswer({ key, reach: reply.value });
      },
      (error: unknown) => reportError(error, { surface: 'fold:swivel-reach' })
    );
    return () => {
      current = false;
    };
    // The ask is read through its key: the same point on the same state is not asked again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withCursor, key, answer?.key]);
  const reach = answer && answer.key === key ? answer.reach : null;
  return useMemo(() => (key === null ? null : reach ? swivelReachView(reach) : SWIVEL_REACH_ASKING), [key, reach]);
}
