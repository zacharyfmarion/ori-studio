/**
 * Loading a lesson's target pattern.
 *
 * A target is `.cp` or `.fold` text. Rather than parse it here — the engine is the only
 * thing that reads the format — it is loaded into a *transient* kernel handle,
 * read as geometry, and freed. Documents behind distinct handles are
 * independent (asserted by `concurrent_handles_are_isolated` in the engine), so
 * this never disturbs the live editor or practice documents.
 *
 * Results are memoized per target: a lesson's target is fixed content, so the
 * round trip happens once per session no matter how often a step re-renders.
 */
import { decodeCpGeometryToSnapshot } from '../../engine/oristudioCpGeometry';
import type { OristudioCpModel } from '../../engine/oristudioCpTypes';
import { getOristudioCpClient } from '../../store/workspaceStore/oristudioCpRuntime';
import { lessonTarget } from '../targets';
import type { LessonTarget } from '../types';

const cache = new Map<string, Promise<OristudioCpModel>>();

async function loadTargetGeometry(target: LessonTarget): Promise<OristudioCpModel> {
  const api = await getOristudioCpClient();
  const handle =
    target.format === 'fold'
      ? await api.loadFoldFile(target.text)
      : await api.loadCp(target.text, 'lesson-target');
  try {
    const transport = await api.documentGeometry(handle);
    return decodeCpGeometryToSnapshot(transport).crease_pattern;
  } finally {
    await api.freeDocument(handle).catch(() => undefined);
  }
}

/**
 * The geometry of a lesson target, by id. Rejects for an unknown id — that is a
 * content bug, and `lessonTargetsResolve` in the lesson tests catches it before
 * a user ever can.
 */
export function targetGeometry(targetId: string): Promise<OristudioCpModel> {
  const cached = cache.get(targetId);
  if (cached) return cached;

  const target = lessonTarget(targetId);
  if (!target) {
    return Promise.reject(new Error(`Unknown lesson target: ${targetId}`));
  }

  const pending = loadTargetGeometry(target).catch((error: unknown) => {
    // Don't cache a failure; a transient worker hiccup should be retryable.
    cache.delete(targetId);
    throw error;
  });
  cache.set(targetId, pending);
  return pending;
}

/** Test seam. */
export function clearTargetGeometryCache(): void {
  cache.clear();
}
