// `prepareFoldModel` must stay roughly linear in mesh size.
//
// It was O(faces x vertices): `triangulateQuad` calls `smallestAngleOf` twice
// per quad, and that recomputed `degenerateCrossThreshold` -> `boundingDiagonal`,
// a full O(V) scan allocating a normalised point per vertex. An 80x80 Miura took
// 1191ms, of which a CPU profile attributed 413ms to `boundingDiagonal` alone
// plus 122ms of GC. Hoisting the invariant out of the loop took it to 46ms.
//
// Nothing gated that. The three fixture tests which happened to fail were
// failing on vitest's 5s *timeout*, which is an accident rather than a
// regression test -- and raising that timeout so the suite could run on CI
// removed even the accident. This asserts the property directly.
//
// It compares a RATIO rather than a wall-clock budget, because absolute times
// vary several-fold across dev machines and CI runners while the shape of the
// curve does not:
//
//   miura-32x32   2048 faces / 1089 verts
//   miura-80x80  12800 faces / 6561 verts    6.25x the faces, 6.02x the vertices
//
// so linear predicts ~6x and O(faces x vertices) predicts ~38x. Measured: 27x
// before the fix, 2.6x after (sub-linear, because fixed costs dominate the small
// case). A threshold of 12 sits an order of magnitude clear of both.
import { describe, expect, it } from 'vitest';
import { prepareFoldModel } from '../src/prepare.js';
import { FIXTURES } from '../bench/fixtures.js';

const MAX_RATIO = 12;
const RUNS = 3;

/** Best of N, so a GC pause or a noisy neighbour cannot fail the build. */
function fastestPrepareMs(fixtureName: string): number {
  const fixture = FIXTURES.find((entry) => entry.name === fixtureName);
  if (!fixture) throw new Error(`missing fixture ${fixtureName}`);
  let best = Infinity;
  for (let run = 0; run < RUNS; run += 1) {
    const fold = fixture.build();
    const started = performance.now();
    prepareFoldModel(fold, { triangulate: true });
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

describe('prepareFoldModel scaling', () => {
  it('stays far below quadratic between 2k and 12.8k faces', () => {
    // Warm up so JIT compilation lands on the baseline rather than the measured
    // case, which would flatter the ratio.
    fastestPrepareMs('miura-16x16');

    const small = fastestPrepareMs('miura-32x32');
    const large = fastestPrepareMs('miura-80x80');
    const ratio = large / small;

    expect(
      ratio,
      `prepareFoldModel scaling regressed: 80x80 took ${ratio.toFixed(1)}x the ` +
        `32x32 time (${small.toFixed(1)}ms -> ${large.toFixed(1)}ms). Linear is ` +
        `~6x for this pair and O(faces x vertices) is ~38x, so this is the ` +
        `per-face O(V) work coming back -- check for a whole-mesh scan inside a ` +
        `per-face or per-quad loop.`
    ).toBeLessThan(MAX_RATIO);
  });
});
