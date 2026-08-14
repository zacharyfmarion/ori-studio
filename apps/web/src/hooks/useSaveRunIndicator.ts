import { useEffect, useState } from 'react';
import { SAVE_LONG_RUN_MS } from '../lib/saveProgressTiming';
import { useWorkspaceStore } from '../store/workspaceStore';

/** What a surface needs to indicate a save that is taking a noticeable while. */
export interface SaveRunIndicator {
  /** A save has settled its target and is now serializing or writing. */
  saving: boolean;
  /** The file being written, for naming it in the indicator. */
  name: string | null;
  /** The run has outlasted {@link SAVE_LONG_RUN_MS}. */
  longRun: boolean;
}

/**
 * The save-run state machine, away from whichever surface renders it — the same
 * split `useFoldRunIndicator` makes, and for the same reason.
 *
 * `saveRun` is set only once the save target is settled, so anything driven by
 * this is structurally incapable of appearing underneath the OS save dialog.
 */
export function useSaveRunIndicator(): SaveRunIndicator {
  const saveRun = useWorkspaceStore((state) => state.saveRun);
  const startedAt = saveRun?.startedAt ?? null;

  const [longRun, setLongRun] = useState(false);
  useEffect(() => {
    if (startedAt === null) {
      setLongRun(false);
      return;
    }
    const remaining = startedAt + SAVE_LONG_RUN_MS - Date.now();
    if (remaining <= 0) {
      setLongRun(true);
      return;
    }
    const timer = setTimeout(() => setLongRun(true), remaining);
    return () => clearTimeout(timer);
  }, [startedAt]);

  return { saving: saveRun !== null, name: saveRun?.name ?? null, longRun };
}
