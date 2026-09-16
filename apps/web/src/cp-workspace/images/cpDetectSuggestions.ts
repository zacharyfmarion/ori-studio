import { track } from '../../analytics';
import { ANALYTICS_EVENTS, bucketCount, cpDetectScoreBucket } from '../../analytics/events';
import { reportError } from '../../monitoring';
import { cpDetectAvailableHere } from '../../lib/workspaceCapabilities';
import { useSettingsStore } from '../../store/settingsStore';
import { getCpDetectClient, whileCpDetectClientAlive } from '../../store/workspaceStore/cpDetectRuntime';
import { useCpDetectSuggestionStore } from './cpDetectSuggestionStore';

/**
 * Shorter side, in source pixels, below which an image is never scored: the
 * detector cannot work on it either, so an offer would lead nowhere.
 */
export const CP_DETECT_SUGGESTION_MIN_SIDE = 256;

/** Elapsed-time ladder for `cp detect image scored`, in ms. */
const SCORE_MS_BUCKETS = [50, 100, 250, 500, 1000] as const;

export interface AddedCanvasImage {
  id: string;
  /** A copy no larger than the gate's working size; null when the import could not draw one. */
  preview: ImageData | null;
  naturalWidth: number;
  naturalHeight: number;
}

interface SuggestionDeps {
  available: () => boolean;
  enabled: () => boolean;
  score: (preview: ImageData) => Promise<{ score: number; likely: boolean }>;
  now: () => number;
}

const defaultDeps: SuggestionDeps = {
  available: cpDetectAvailableHere,
  enabled: () => useSettingsStore.getState().cpDetectSuggestions,
  score: async (preview) => {
    const client = await getCpDetectClient();
    return whileCpDetectClientAlive(client.creasePatternLikelihood(preview));
  },
  now: () => performance.now(),
};

let reportedFailure = false;

/**
 * Score an image just added to the canvas and, if it looks like a crease
 * pattern, record the offer the pill will show.
 *
 * Never throws and never surfaces anything to the user: a reference image must
 * not produce an error because a *suggestion* failed. The first failure of a
 * session is reported to monitoring, the rest are dropped.
 */
export async function noteAddedCanvasImage(
  image: AddedCanvasImage,
  deps: SuggestionDeps = defaultDeps
): Promise<void> {
  if (!deps.available() || !deps.enabled() || !image.preview) return;
  if (Math.min(image.naturalWidth, image.naturalHeight) < CP_DETECT_SUGGESTION_MIN_SIDE) return;
  const started = deps.now();
  let verdict: { score: number; likely: boolean };
  try {
    verdict = await deps.score(image.preview);
  } catch (error) {
    if (!reportedFailure) {
      reportedFailure = true;
      reportError(error instanceof Error ? error : new Error(String(error)), {
        surface: 'cp-detect-suggestion',
        handled: true,
      });
    }
    return;
  }
  // The denominator for the offer's acceptance rate, and the field false-positive
  // rate by proxy: bucketed score and verdict only, nothing about the image.
  track(ANALYTICS_EVENTS.cpDetectImageScored, {
    verdict: verdict.likely ? 'likely' : 'unlikely',
    score_bucket: cpDetectScoreBucket(verdict.score),
    ms_bucket: bucketCount(deps.now() - started, SCORE_MS_BUCKETS),
  });
  useCpDetectSuggestionStore.getState().recordSuggestion(image.id, verdict.score, verdict.likely);
  if (verdict.likely) {
    track(ANALYTICS_EVENTS.cpDetectSuggested, { score_bucket: cpDetectScoreBucket(verdict.score) });
  }
}

let warmed = false;

/**
 * Start the detect worker while an image is still being dragged over the
 * canvas, so the gate answers with the drop rather than a cold start later.
 * Once per session, and never at app start: most sessions never need it.
 */
export function warmCpDetectClient(deps: Pick<SuggestionDeps, 'available' | 'enabled'> = defaultDeps): void {
  if (warmed || !deps.available() || !deps.enabled()) return;
  warmed = true;
  void getCpDetectClient().catch(() => {
    // A failure here is a failure the next scoring call reports.
  });
}

/** Test seam. */
export function resetCpDetectSuggestionModule(): void {
  reportedFailure = false;
  warmed = false;
}
