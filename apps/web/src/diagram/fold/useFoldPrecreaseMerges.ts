import { useEffect, useMemo, useState } from 'react';
import type { FoldPathEntry } from '../../fold/sequence/foldSequencePath';
import type { FoldSession } from '../../fold/session/foldSession';
import {
  precreaseMergeCandidates,
  resolvePrecreaseMerges,
  type FoldPrecreaseMerge,
} from './foldPrecreaseMerge';
import { knownPrecreaseMirror, precreasePairKey, precreasePairMirrors } from './foldPrecreaseMirrors';

/**
 * The precreases and mirror images that merge along the shown path, kept
 * current as it replays (`foldPrecreaseMerge.ts`): every Repeat of
 * precreases at once, and each pair once its three states have landed and
 * the session has told it (`precreasePairMirrors`) — at once for a pair told
 * before, by the same states. What the From Fold… browser draws as one card,
 * and whether it offers to.
 */
export function useFoldPrecreaseMerges(
  session: FoldSession,
  sequence: string,
  entries: readonly FoldPathEntry[]
): readonly FoldPrecreaseMerge[] {
  const path = useMemo(() => entries.flatMap((entry) => (entry.node ? [entry.node] : [])), [entries]);
  const candidates = useMemo(() => precreaseMergeCandidates(path), [path]);
  // Each pair by its states — the one before it is the entry before its first — none until all three have landed.
  const keys = useMemo(
    () =>
      candidates.pairs.map(([first, second]) => {
        const at = entries.findIndex((entry) => entry.id === first);
        const [before, own, next] = [entries[at - 1], entries[at], entries[at + 1]];
        return at > 0 && next?.id === second
          ? precreasePairKey(before?.session.fingerprint ?? null, own?.session.fingerprint ?? null, next.session.fingerprint)
          : null;
      }),
    [candidates, entries]
  );
  const [verdicts, setVerdicts] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  useEffect(() => {
    let live = true;
    candidates.pairs.forEach((pair, index) => {
      const key = keys[index];
      if (!key || knownPrecreaseMirror(key) !== undefined) return;
      void precreasePairMirrors(session, sequence, pair).then((mirrors) => {
        if (live) setVerdicts((was) => new Map(was).set(key, mirrors));
      });
    });
    return () => {
      live = false;
    };
  }, [session, sequence, candidates, keys]);
  return useMemo(
    () =>
      resolvePrecreaseMerges(
        candidates,
        (pair) => {
          const key = keys[candidates.pairs.indexOf(pair)];
          return !!key && (verdicts.get(key) ?? knownPrecreaseMirror(key)) === true;
        },
        path.map((node) => node.id)
      ),
    [candidates, keys, verdicts, path]
  );
}
