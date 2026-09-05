/**
 * The ReferenceFinder client the rest of the app depends on.
 *
 * Callers ask in sheet coordinates and get back {@link ExtractedSolution}s —
 * folds, not JSON — memoized by database, query settings and target. The
 * transport underneath is abstracted as {@link ReferenceFinderTransport} so the
 * same client runs on a worker (`createWorkerReferenceFinderClient`), on
 * captured fixtures (`replayClient.ts`), or on anything a test hands it.
 *
 * Batches are how the CP-wide analysis and the planner's stuck handler ask:
 * many lines, one at a time (the worker is a strict FIFO anyway), with progress
 * and an `AbortSignal`. A query cannot be interrupted, so an abort takes effect
 * after the query in flight and the batch resolves with what it has — partial
 * findings are kept, never thrown away.
 */
import type { WasmErrorEnvelope } from '../../../engine/types';
import {
  getReferenceFinderClient,
  type ReferenceFinderInstance,
} from '../../../store/workspaceStore/referenceFinderRuntime';
import {
  coordinateKey,
  createReferenceFinderCache,
  solutionCacheKey,
  type ReferenceFinderCache,
} from './cache';
import { extractSolution, type ExtractedSolution, type ReferenceFinderQuery } from './extractor';
import {
  DEFAULT_DATABASE_SETTINGS,
  DEFAULT_QUERY_SETTINGS,
  databaseKey,
  querySettingsKey,
  type ReferenceFinderDatabaseSettings,
  type ReferenceFinderQuerySettings,
} from './protocol';
import type { RawSolution, RfPoint } from './solution';

/** What a client needs from whatever answers queries: the core's raw solutions. */
export interface ReferenceFinderTransport {
  solvePoint(x: number, y: number, query: ReferenceFinderQuerySettings): Promise<RawSolution[]>;
  solveLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    query: ReferenceFinderQuerySettings
  ): Promise<RawSolution[]>;
}

export interface ReferenceFinderSolveOptions {
  /**
   * Cache key for the target. For lines this should be the planner's canonical
   * line key (computed in Rust, shared by every segment of one infinite line);
   * without it the client keys on the exact coordinates given, which only hits
   * when the same two points are asked again.
   */
  key?: string;
}

export interface ReferenceFinderLineRequest {
  a: RfPoint;
  b: RfPoint;
  /** See {@link ReferenceFinderSolveOptions.key}. Echoed in the result. */
  key?: string;
}

export type ReferenceFinderBatchResult =
  | { key: string; a: RfPoint; b: RfPoint; solutions: ExtractedSolution[] }
  | { key: string; a: RfPoint; b: RfPoint; error: WasmErrorEnvelope };

export interface ReferenceFinderBatchOutcome {
  /** One entry per request, in request order, for the requests that ran. */
  results: ReferenceFinderBatchResult[];
  /** The signal fired; `results` covers the requests answered before it did. */
  aborted: boolean;
  /** How many results came from the cache without a query. */
  fromCache: number;
}

export interface ReferenceFinderClient {
  readonly databaseKey: string;
  readonly database: ReferenceFinderDatabaseSettings;
  readonly query: ReferenceFinderQuerySettings;
  solvePoint(point: RfPoint, options?: ReferenceFinderSolveOptions): Promise<ExtractedSolution[]>;
  solveLine(a: RfPoint, b: RfPoint, options?: ReferenceFinderSolveOptions): Promise<ExtractedSolution[]>;
  batchLines(
    lines: readonly ReferenceFinderLineRequest[],
    onProgress?: (done: number, total: number) => void,
    signal?: AbortSignal
  ): Promise<ReferenceFinderBatchOutcome>;
}

export interface ReferenceFinderClientOptions {
  transport: ReferenceFinderTransport;
  database?: ReferenceFinderDatabaseSettings;
  query?: ReferenceFinderQuerySettings;
  /** Share one cache across clients with the same database and query settings. */
  cache?: ReferenceFinderCache;
}

export function createReferenceFinderClient(options: ReferenceFinderClientOptions): ReferenceFinderClient {
  const database = options.database ?? DEFAULT_DATABASE_SETTINGS;
  const query = options.query ?? DEFAULT_QUERY_SETTINGS;
  const cache = options.cache ?? createReferenceFinderCache();
  const dbKey = databaseKey(database);
  const qKey = querySettingsKey(query);
  const sheet = { width: database.width, height: database.height };
  const { transport } = options;

  const cacheKeyFor = (targetKey: string) => solutionCacheKey(dbKey, qKey, targetKey);

  async function solveLineUncached(a: RfPoint, b: RfPoint): Promise<ExtractedSolution[]> {
    const raw = await transport.solveLine(a[0], a[1], b[0], b[1], query);
    const target: ReferenceFinderQuery = { kind: 'line', a, b };
    return raw.map((solution) => extractSolution(solution, target, sheet));
  }

  async function solveLine(
    a: RfPoint,
    b: RfPoint,
    options?: ReferenceFinderSolveOptions
  ): Promise<ExtractedSolution[]> {
    const key = cacheKeyFor(options?.key ?? coordinateKey('line', a, b));
    const hit = cache.get(key);
    if (hit) return hit;
    const solutions = await solveLineUncached(a, b);
    cache.set(key, solutions);
    return solutions;
  }

  return {
    databaseKey: dbKey,
    database,
    query,

    async solvePoint(point, options) {
      const key = cacheKeyFor(options?.key ?? coordinateKey('point', point));
      const hit = cache.get(key);
      if (hit) return hit;
      const raw = await transport.solvePoint(point[0], point[1], query);
      const target: ReferenceFinderQuery = { kind: 'point', point };
      const solutions = raw.map((solution) => extractSolution(solution, target, sheet));
      cache.set(key, solutions);
      return solutions;
    },

    solveLine,

    async batchLines(lines, onProgress, signal) {
      const results: ReferenceFinderBatchResult[] = [];
      let fromCache = 0;
      const total = lines.length;
      onProgress?.(0, total);
      for (const request of lines) {
        if (signal?.aborted) {
          return { results, aborted: true, fromCache };
        }
        const targetKey = request.key ?? coordinateKey('line', request.a, request.b);
        const key = cacheKeyFor(targetKey);
        const hit = cache.get(key);
        if (hit) {
          fromCache += 1;
          results.push({ key: targetKey, a: request.a, b: request.b, solutions: hit });
        } else {
          try {
            const solutions = await solveLineUncached(request.a, request.b);
            cache.set(key, solutions);
            results.push({ key: targetKey, a: request.a, b: request.b, solutions });
          } catch (error) {
            // One line the core refuses (or the extractor rejects) must not
            // lose the rest of an analysis; the caller sees it per line.
            results.push({
              key: targetKey,
              a: request.a,
              b: request.b,
              error: toEnvelope(error),
            });
          }
        }
        onProgress?.(results.length, total);
      }
      return { results, aborted: false, fromCache };
    },
  };
}

function toEnvelope(error: unknown): WasmErrorEnvelope {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return { code: (error as { code: string }).code, message: String((error as { message: unknown }).message) };
  }
  return {
    code: 'reference_finder',
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * A client over the runtime's worker for `instance`. The worker is spawned on
 * the first query (or on `ready()` through the runtime) and lives by the
 * runtime's rules; release it with `releaseReferenceFinderClient(instance)`.
 */
export function createWorkerReferenceFinderClient(
  instance: ReferenceFinderInstance,
  options: Omit<ReferenceFinderClientOptions, 'transport'> = {}
): ReferenceFinderClient {
  const database = options.database ?? DEFAULT_DATABASE_SETTINGS;
  const transport: ReferenceFinderTransport = {
    solvePoint: (x, y, query) => getReferenceFinderClient(instance, database).solvePoint(x, y, query),
    solveLine: (x1, y1, x2, y2, query) =>
      getReferenceFinderClient(instance, database).solveLine(x1, y1, x2, y2, query),
  };
  return createReferenceFinderClient({ ...options, database, transport });
}
