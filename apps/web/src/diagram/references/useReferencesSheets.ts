import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { reportError } from '../../monitoring';
import { decodeCachedPlan, type ReferencesCachedPlan } from '../../cp-workspace/references/referencesPlanCache';
import {
  referencesPlanCacheListing,
  referencesPlanCacheVersion,
  subscribeReferencesPlanCache,
} from '../../cp-workspace/references/referencesPlanCacheStore';
import { referencesRevisionKey } from '../../cp-workspace/references/useReferencesView';
import { paperFallbackRect, precreaseInputFromTransport, type SheetAnalysis } from '../../cp-workspace/references/sheetFrames';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  getPrecreaseClient,
  releasePrecreaseClient,
  retainPrecreaseClient,
} from '../../store/workspaceStore/precreaseRuntime';
import { plannedPatterns, type BrowserPattern } from './referencesBrowserPlans';

/** Where the planned patterns stand. */
export type BrowserPatternsState =
  | { status: 'no-pattern' }
  | { status: 'finding' }
  | { status: 'failed' }
  | { status: 'ready'; patterns: BrowserPattern[] };

export interface ReferencesSheets {
  geometry: CpGeometryTransport | null;
  /** The creases' revision: what the analysis and a plan's record are of. */
  revision: string;
  /** References' sheets, once the worker has found them; undefined while it looks, null when it could not. */
  analysis: SheetAnalysis | null | undefined;
  /** The patterns with a plan that fits them now (`plannedPatterns`). */
  patterns: BrowserPatternsState;
}

/**
 * The Edit document's sheets as References has them, and the ones with a plan
 * that still fits their creases — what the References browser lists (D20) and
 * a References step's ways are drawn from (D23).
 *
 * The sheets come from the precrease worker (`sheetFrames`), held while a
 * user of this hook is mounted, and are kept for the creases' revision: the
 * same creases asked again answer at once. The patterns are listed again
 * whenever the plan cache says it changed. Not `enabled`, it asks nothing and
 * holds no worker: its sheets are then whatever was found last for these creases.
 */
export function useReferencesSheets(enabled = true): ReferencesSheets {
  const document = useWorkspaceStore((store) => store.oristudioCpDocument);
  const geometry = document?.geometry ?? null;
  const revision = referencesRevisionKey(document);

  useEffect(() => {
    if (!enabled) return undefined;
    retainPrecreaseClient();
    return releasePrecreaseClient;
  }, [enabled]);
  const [frames, setFrames] = useState<{ revision: string; analysis: SheetAnalysis | null } | null>(null);
  useEffect(() => {
    if (!enabled || !geometry || lastFrames?.revision === revision) return undefined;
    let live = true;
    const input = precreaseInputFromTransport(geometry);
    getPrecreaseClient()
      .sheetFrames(input.segments, input.colors, paperFallbackRect())
      .then((analysis) => {
        lastFrames = { revision, analysis };
        if (live) setFrames({ revision, analysis });
      })
      .catch((error: unknown) => {
        reportError(error, { surface: 'diagram:references-browser' });
        if (live) setFrames({ revision, analysis: null });
      });
    return () => {
      live = false;
    };
    // The analysis is of the creases, which the revision names: a new transport
    // for a selection-only change asks nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, enabled]);
  const analysis =
    frames?.revision === revision
      ? frames.analysis
      : lastFrames?.revision === revision
        ? lastFrames.analysis
        : undefined;

  const cacheVersion = useSyncExternalStore(subscribeReferencesPlanCache, referencesPlanCacheVersion);
  const loadSerial = document?.loadSerial ?? null;
  const patterns = useMemo((): BrowserPatternsState => {
    if (!document || !geometry) return { status: 'no-pattern' };
    if (analysis === undefined) return { status: 'finding' };
    if (analysis === null) return { status: 'failed' };
    const listing = loadSerial === null ? [] : referencesPlanCacheListing(loadSerial);
    return { status: 'ready', patterns: plannedPatterns(analysis, listing, precreaseInputFromTransport(geometry)) };
    // `cacheVersion` is when the listing can have changed: read again then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, geometry, analysis, loadSerial, cacheVersion]);

  return { geometry, revision, analysis, patterns };
}

/**
 * A pattern's cached plan, unpacked once: null while it is unpacked or when
 * `pattern` is null, `{ plan: null }` for one this build cannot read. The
 * last one unpacked is kept, so a second reader of it (the Step pane beside
 * Pose) unpacks nothing.
 */
export function useDecodedPlan(pattern: BrowserPattern | null): { id: string; plan: ReferencesCachedPlan | null } | null {
  const id = pattern?.id ?? null;
  const payload = pattern?.listing.payload ?? null;
  const [decoded, setDecoded] = useState<{ id: string; plan: ReferencesCachedPlan | null } | null>(() =>
    id !== null && lastDecoded?.id === id ? lastDecoded : null
  );
  useEffect(() => {
    if (id === null || payload === null) return undefined;
    if (lastDecoded?.id === id) {
      setDecoded(lastDecoded);
      return undefined;
    }
    let live = true;
    void decodeCachedPlan(payload).then((plan) => {
      lastDecoded = { id, plan };
      if (live) setDecoded(lastDecoded);
    });
    return () => {
      live = false;
    };
  }, [id, payload]);
  return decoded?.id === id ? decoded : null;
}

/**
 * The last analysis of the creases, by their revision: a reader mounted again
 * on the same creases lists its patterns at once rather than asking the worker
 * again.
 */
let lastFrames: { revision: string; analysis: SheetAnalysis | null } | null = null;

/** The last plan unpacked, by its cache key id: a plan is the same plan for the same key. */
let lastDecoded: { id: string; plan: ReferencesCachedPlan | null } | null = null;
