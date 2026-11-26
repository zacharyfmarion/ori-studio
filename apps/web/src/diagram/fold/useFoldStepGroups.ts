import { useEffect, useMemo, useState } from 'react';
import type { FoldPathEntry } from '../../fold/sequence/foldSequencePath';
import type { FoldSession } from '../../fold/session/foldSession';
import { foldPathGroups, type FoldPathMerges } from './foldStepMergeSession';

/**
 * What the shown path offers to merge, kept current as it replays
 * (`foldPathGroups`): told once its steps have landed, and again when one
 * changes. The last answer stands while the next is told, so the browser's
 * cards do not part and merge again as each step lands; a run it names that
 * no longer matches the path is not drawn as one (`foldBrowserCards`).
 */
export function useFoldStepGroups(
  session: FoldSession,
  sequence: string,
  entries: readonly FoldPathEntry[]
): FoldPathMerges | null {
  const path = useMemo(() => entries.flatMap((entry) => (entry.node ? [entry.node] : [])), [entries]);
  const [told, setTold] = useState<FoldPathMerges | null>(null);
  useEffect(() => {
    let live = true;
    void foldPathGroups(session, sequence, path, () => live).then((merges) => {
      if (live && merges) setTold(merges);
    });
    return () => {
      live = false;
    };
  }, [session, sequence, path]);
  return told;
}
