/**
 * A ReferenceFinder transport that answers from captured module output.
 *
 * The fixtures under `__fixtures__/` were produced by `capture.mjs` driving the
 * real core, so tests exercise the extractor and client against genuine wire
 * shapes without a worker, a wasm build, or a two-second database build. A
 * query the fixtures do not cover is a typed miss, never an invented answer.
 */
import type { ReferenceFinderTransport, ReferenceFinderClient, ReferenceFinderClientOptions } from './client';
import { createReferenceFinderClient } from './client';
import type { ReferenceFinderDatabaseSettings, ReferenceFinderQuerySettings } from './protocol';
import { databaseKey, querySettingsKey } from './protocol';
import type { RawSolution, RfPoint } from './solution';

/** One captured query: the settings it ran under, the target, and the answer verbatim. */
export interface ReferenceFinderReplayFixture {
  database: ReferenceFinderDatabaseSettings;
  search: ReferenceFinderQuerySettings;
  query: { kind: 'point'; point: RfPoint } | { kind: 'line'; a: RfPoint; b: RfPoint };
  solutions: RawSolution[];
  note?: string;
}

export interface ReplayCall {
  kind: 'point' | 'line';
  coordinates: number[];
  query: ReferenceFinderQuerySettings;
}

export interface ReferenceFinderReplayTransport extends ReferenceFinderTransport {
  /** Every query received, in order. */
  readonly calls: ReplayCall[];
}

export class ReferenceFinderReplayMiss extends Error {
  readonly code = 'reference_finder_replay_miss';

  constructor(message: string) {
    super(message);
    this.name = 'ReferenceFinderReplayMiss';
  }
}

const COORDINATE_TOLERANCE = 1e-9;

function same(a: number, b: number): boolean {
  return Math.abs(a - b) <= COORDINATE_TOLERANCE;
}

/**
 * Serve `fixtures`. Every fixture must share one database and one set of
 * query settings — a transport stands in for one worker, and a worker holds
 * one database.
 */
export function createReplayTransport(
  fixtures: readonly ReferenceFinderReplayFixture[]
): ReferenceFinderReplayTransport {
  if (fixtures.length === 0) {
    throw new RangeError('a replay transport needs at least one fixture');
  }
  const dbKey = databaseKey(fixtures[0].database);
  const searchKey = querySettingsKey(fixtures[0].search);
  for (const fixture of fixtures) {
    if (databaseKey(fixture.database) !== dbKey) {
      throw new RangeError('replay fixtures were captured against different databases');
    }
    if (querySettingsKey(fixture.search) !== searchKey) {
      throw new RangeError('replay fixtures were captured with different query settings');
    }
  }
  const calls: ReplayCall[] = [];

  const miss = (call: ReplayCall): never => {
    throw new ReferenceFinderReplayMiss(
      `no fixture for ${call.kind} query ${JSON.stringify(call.coordinates)} at ${querySettingsKey(call.query)}`
    );
  };

  return {
    calls,
    async solvePoint(x, y, query) {
      const call: ReplayCall = { kind: 'point', coordinates: [x, y], query };
      calls.push(call);
      if (querySettingsKey(query) !== searchKey) return miss(call);
      const fixture = fixtures.find(
        (candidate) =>
          candidate.query.kind === 'point' &&
          same(candidate.query.point[0], x) &&
          same(candidate.query.point[1], y)
      );
      return fixture ? structuredClone(fixture.solutions) : miss(call);
    },
    async solveLine(x1, y1, x2, y2, query) {
      const call: ReplayCall = { kind: 'line', coordinates: [x1, y1, x2, y2], query };
      calls.push(call);
      if (querySettingsKey(query) !== searchKey) return miss(call);
      const fixture = fixtures.find((candidate) => {
        if (candidate.query.kind !== 'line') return false;
        const { a, b } = candidate.query;
        const forward = same(a[0], x1) && same(a[1], y1) && same(b[0], x2) && same(b[1], y2);
        const reverse = same(a[0], x2) && same(a[1], y2) && same(b[0], x1) && same(b[1], y1);
        return forward || reverse;
      });
      return fixture ? structuredClone(fixture.solutions) : miss(call);
    },
  };
}

/** A full client over a replay transport, using the fixtures' own settings. */
export function createReplayReferenceFinderClient(
  fixtures: readonly ReferenceFinderReplayFixture[],
  options: Pick<ReferenceFinderClientOptions, 'cache'> = {}
): ReferenceFinderClient & { readonly transport: ReferenceFinderReplayTransport } {
  const transport = createReplayTransport(fixtures);
  const client = createReferenceFinderClient({
    ...options,
    transport,
    database: fixtures[0].database,
    query: fixtures[0].search,
  });
  return { ...client, transport };
}
