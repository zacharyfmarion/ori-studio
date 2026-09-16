import { describe, expect, it } from 'vitest';
import { createReferenceFinderCache } from './cache';
import { createReferenceFinderClient, type ReferenceFinderTransport } from './client';
import { DEFAULT_QUERY_SETTINGS, databaseKey } from './protocol';
import {
  ReferenceFinderReplayMiss,
  createReplayReferenceFinderClient,
  createReplayTransport,
  type ReferenceFinderReplayFixture,
} from './replayClient';
import lineExactJson from './__fixtures__/line-exact.json';
import markJson from './__fixtures__/mark.json';
import linePinchJson from './__fixtures__/line-pinch.json';
import lineApproximateJson from './__fixtures__/line-approximate.json';

const lineExact = lineExactJson as unknown as ReferenceFinderReplayFixture;
const mark = markJson as unknown as ReferenceFinderReplayFixture;
const linePinch = linePinchJson as unknown as ReferenceFinderReplayFixture;
const lineApproximate = lineApproximateJson as unknown as ReferenceFinderReplayFixture;
const all = [lineExact, mark, linePinch, lineApproximate];

function lineQuery(fixture: ReferenceFinderReplayFixture) {
  if (fixture.query.kind !== 'line') throw new Error('not a line fixture');
  return fixture.query;
}

describe('replay transport', () => {
  it('serves the captured solutions for a matching query, in either direction', async () => {
    const transport = createReplayTransport(all);
    const { a, b } = lineQuery(lineExact);
    const forward = await transport.solveLine(a[0], a[1], b[0], b[1], DEFAULT_QUERY_SETTINGS);
    const reverse = await transport.solveLine(b[0], b[1], a[0], a[1], DEFAULT_QUERY_SETTINGS);
    expect(forward).toEqual(lineExact.solutions);
    expect(reverse).toEqual(lineExact.solutions);
    // A copy, so a caller mutating its answer cannot corrupt the fixture.
    expect(forward).not.toBe(lineExact.solutions);
    expect(transport.calls).toHaveLength(2);
  });

  it('misses with a typed error for a query it has not captured', async () => {
    const transport = createReplayTransport(all);
    await expect(transport.solvePoint(0.123, 0.456, DEFAULT_QUERY_SETTINGS)).rejects.toBeInstanceOf(
      ReferenceFinderReplayMiss
    );
    await expect(
      transport.solvePoint(1 / 3, 1 / 3, { ...DEFAULT_QUERY_SETTINGS, count: 1 })
    ).rejects.toMatchObject({ code: 'reference_finder_replay_miss' });
  });

  it('refuses fixtures from different databases or query settings', () => {
    expect(() =>
      createReplayTransport([lineExact, { ...mark, database: { ...mark.database, maxRank: 5 } }])
    ).toThrow(/different databases/);
    expect(() =>
      createReplayTransport([lineExact, { ...mark, search: { ...mark.search, count: 3 } }])
    ).toThrow(/different query settings/);
    expect(() => createReplayTransport([])).toThrow(RangeError);
  });
});

describe('replay client', () => {
  it('extracts and returns folds for a point and a line', async () => {
    const client = createReplayReferenceFinderClient(all);
    expect(client.databaseKey).toBe(databaseKey(lineExact.database));
    if (mark.query.kind !== 'point') throw new Error('not a point fixture');
    const points = await client.solvePoint(mark.query.point);
    expect(points).toHaveLength(5);
    expect(points[0].exact).toBe(true);
    const { a, b } = lineQuery(linePinch);
    const lines = await client.solveLine(a, b);
    expect(lines[0].exact).toBe(true);
    expect(lines[0].steps.some((s) => s.pinch)).toBe(true);
  });

  it('caches by target key: the second ask never reaches the transport', async () => {
    const client = createReplayReferenceFinderClient(all);
    const { a, b } = lineQuery(lineExact);
    const first = await client.solveLine(a, b, { key: 'line-key-1' });
    const second = await client.solveLine(a, b, { key: 'line-key-1' });
    expect(second).toBe(first);
    expect(client.transport.calls).toHaveLength(1);
    // A different key for the same coordinates is a different question.
    await client.solveLine(a, b, { key: 'line-key-2' });
    expect(client.transport.calls).toHaveLength(2);
  });

  it('falls back to a coordinate key when none is given', async () => {
    const client = createReplayReferenceFinderClient(all);
    const { a, b } = lineQuery(lineExact);
    await client.solveLine(a, b);
    await client.solveLine([a[0] + 1e-12, a[1]], b);
    expect(client.transport.calls).toHaveLength(1);
  });

  it('shares a cache between clients with the same settings', async () => {
    const cache = createReferenceFinderCache();
    const one = createReplayReferenceFinderClient(all, { cache });
    const two = createReplayReferenceFinderClient(all, { cache });
    const { a, b } = lineQuery(lineExact);
    await one.solveLine(a, b, { key: 'k' });
    await two.solveLine(a, b, { key: 'k' });
    expect(one.transport.calls).toHaveLength(1);
    expect(two.transport.calls).toHaveLength(0);
  });

  it('runs a batch with progress, per-line errors and cache hits', async () => {
    const client = createReplayReferenceFinderClient(all);
    const exact = lineQuery(lineExact);
    const approximate = lineQuery(lineApproximate);
    await client.solveLine(exact.a, exact.b, { key: 'exact' });
    const progress: Array<[number, number]> = [];
    const outcome = await client.batchLines(
      [
        { a: exact.a, b: exact.b, key: 'exact' },
        { a: [0.11, 0.22], b: [0.33, 0.44], key: 'unknown' },
        { a: approximate.a, b: approximate.b, key: 'approx' },
      ],
      (done, total) => progress.push([done, total])
    );
    expect(outcome.aborted).toBe(false);
    expect(outcome.fromCache).toBe(1);
    expect(outcome.results.map((r) => r.key)).toEqual(['exact', 'unknown', 'approx']);
    expect('solutions' in outcome.results[0] && outcome.results[0].solutions[0].exact).toBe(true);
    expect('error' in outcome.results[1] && outcome.results[1].error.code).toBe(
      'reference_finder_replay_miss'
    );
    expect('solutions' in outcome.results[2] && outcome.results[2].solutions.every((s) => !s.exact)).toBe(
      true
    );
    expect(progress).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    // Only the two uncached lines reached the transport.
    expect(client.transport.calls.filter((c) => c.kind === 'line')).toHaveLength(3);
  });

  it('stops a batch after the query in flight when the signal fires, keeping results', async () => {
    const client = createReplayReferenceFinderClient(all);
    const exact = lineQuery(lineExact);
    const pinch = lineQuery(linePinch);
    const controller = new AbortController();
    const outcome = await client.batchLines(
      [
        { a: exact.a, b: exact.b, key: 'exact' },
        { a: pinch.a, b: pinch.b, key: 'pinch' },
      ],
      (done) => {
        if (done === 1) controller.abort();
      },
      controller.signal
    );
    expect(outcome.aborted).toBe(true);
    expect(outcome.results.map((r) => r.key)).toEqual(['exact']);
  });

  it('propagates a transport failure from a single solve as a rejection', async () => {
    const failing: ReferenceFinderTransport = {
      solvePoint: async () => {
        throw { code: 'reference_finder', message: 'x coordinate should lie between 0 and 1' };
      },
      solveLine: async () => [],
    };
    const client = createReferenceFinderClient({ transport: failing });
    await expect(client.solvePoint([1.5, 0.5])).rejects.toMatchObject({
      code: 'reference_finder',
    });
    expect(await client.solveLine([0, 0], [1, 1])).toEqual([]);
  });
});
